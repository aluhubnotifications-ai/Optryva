import { Router } from '@/lib/http'
import { sb, must, j } from '@/db'
import { requireAuth } from '@/lib/auth'
import { getUsageSummary } from '@/lib/usage'
import { now } from '@/lib/util'
import { claudeText, claudeJson, claudeTextWithSearch, streamClaude, extractJson, hasClaude, MODELS } from '@/lib/claude'
import { type MatchJob, type MatchStudent, type AiMatch } from '@/lib/matching'
import type { ResumeProfile } from '@/lib/resume'
import { ensureResumeProfile, asResumeProfile, retrieveCandidateJobs, retrieveJobsByVector } from '@/lib/enrich'
import { rerank, studentEmbedText, jobEmbedText, embedOne } from '@/lib/embeddings'
import { extractFeatures } from '@/lib/features'
import { loadRanker, rankerProb } from '@/lib/ranker'
import { loadDistill, distillScore } from '@/lib/distill'
import { buildScoringSystem, SCORE_SCHEMA, type LlmScore } from '@/lib/rubric'
import { jobVisibleTo, schoolGates } from '@/lib/visibility'

/* ---------- calibration (the honesty feedback loop, cached 5 min) ---------- */
// Just the rubric addendum now — there is no deterministic engine to re-weight.
let calCache: { at: number; addendum: string | null } | null = null
async function calibration(): Promise<{ addendum: string | null }> {
  if (calCache && Date.now() - calCache.at < 300_000) return calCache
  let addendum: string | null = null
  try {
    const r = (await sb.from('ai_calibration').select('rubric_addendum').eq('id', 'singleton').maybeSingle()).data as any
    if (r) addendum = r.rubric_addendum ?? null
  } catch { /* table not migrated yet — run on defaults */ }
  calCache = { at: Date.now(), addendum }
  return calCache
}
const clampInt = (n: any, lo = 0, hi = 99) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)))

// Stamped into every cached score. Bump this whenever the rubric, the scoring
// model, or the cap logic changes — old cached scores then auto-miss and get
// re-scored under the new engine instead of being served stale. (v2: Sonnet
// scorer + honest breakdown + smooth caps.)
const ENGINE_VERSION = 'v2-sonnet-2026-06'

// ---- Match funnel: turn up to 1M live jobs into the few the LLM actually scores.
const RETRIEVE_K = 600 // Stage 1 — ANN candidates pulled from Postgres per student.
const SCORE_K = 40 // Stage 3 — final set the LLM scores, after the rerank narrows.

const parsePrefTypes = (viewer: any): string[] => j.parse<string[]>(viewer?.pref_listing_types, [])
const parsePrefCountries = (viewer: any): string[] => j.parse<string[]>(viewer?.pref_countries, [])

/** Can we run the funnel for this student yet? The retrieval funnel ranks the whole
 *  catalog by similarity to the student's embedding — built from their résumé and
 *  preferences. With NEITHER there's nothing to rank against, so the "top 40" would
 *  be arbitrary. We refuse to run and tell the client what's missing instead.
 *    - résumé: a parsed CV (cv_text) or a structured resume_profile.
 *    - preferences: any signal that shapes retrieval — wanted types/countries, or
 *      profile signals (skills, desired roles, industries). */
type MatchReadiness = { ready: boolean; missing: ('resume' | 'preferences')[] }
function matchReadiness(viewer: any): MatchReadiness {
  const hasResume = !!((viewer?.cv_text ?? '').trim() || viewer?.resume_profile)
  const hasPreferences =
    parsePrefTypes(viewer).length > 0 ||
    parsePrefCountries(viewer).length > 0 ||
    j.parse<string[]>(viewer?.skills, []).length > 0 ||
    j.parse<string[]>(viewer?.desired_roles, []).length > 0 ||
    j.parse<string[]>(viewer?.preferred_industries, []).length > 0
  const missing: ('resume' | 'preferences')[] = []
  if (!hasResume) missing.push('resume')
  if (!hasPreferences) missing.push('preferences')
  return { ready: missing.length === 0, missing }
}

/** Does this job pass the student's stated preferences? An empty preference means
 *  "no restriction". A job in a listing type or country the student doesn't want
 *  is NOT a weak match — it's out of scope, so we never spend a Claude call on it.
 *  Remote roles always clear the country gate (location is irrelevant remote). */
function prefAllowsJob(job: any, prefTypes: string[], prefCountries: string[]): boolean {
  if (prefTypes.length && !prefTypes.includes(job.listing_type)) return false
  if (prefCountries.length && job.remote !== 1 && !prefCountries.includes(job.country)) return false
  return true
}

// Unambiguous senior-role markers (avoid 'lead'/'manager' — "Lead Generation",
// "Community Manager" are common entry roles) and an explicit years requirement.
const SENIOR_TITLE = /\b(senior|sr|staff|principal|director|chief|vp|head\s+of|architect)\b/i
const YEARS_REQ = /(\d{1,2})\s*\+?\s*(?:years|yrs)\b/i

/** A cheap, conservative qualification guardrail run BEFORE the LLM (LinkedIn's
 *  lesson: embeddings alone surface "completely off-target" roles). Only fires on
 *  a seniority mismatch we can defend — an entry-level / <1yr candidate against an
 *  explicitly senior, non-internship role — so it trims absurd matches without
 *  hurting recall. Skipped when there's no parsed résumé (we can't judge level). */
function isOffTarget(job: any, rp: ResumeProfile | null): boolean {
  if (!rp) return false
  const junior = rp.seniority === 'student' || rp.seniority === 'entry' || rp.total_years < 1
  if (!junior) return false
  if (job.listing_type === 'Internship' || job.listing_type === 'Fellowship') return false // open to all levels
  if (SENIOR_TITLE.test(job.title ?? '')) return true
  const text = `${(j.parse<string[]>(job.qualifications, [])).join('\n')}\n${job.description ?? ''}`
  const m = text.match(YEARS_REQ)
  return m ? Number(m[1]) >= 5 : false
}

/** The match FUNNEL. Reduces the whole live-jobs corpus to the ~SCORE_K best
 *  candidates the LLM will score — cheaply and at scale:
 *    0+1) Postgres hard-filters by the student's preferences (type/country) AND
 *         ranks by vector similarity, returning the top RETRIEVE_K (one indexed
 *         query — this is what makes 1M jobs tractable; we never load them all).
 *    2)   a cross-encoder rerank sharpens that down to the best SCORE_K.
 *    3)   the caller LLM-scores only those.
 *  Visibility gates (school/year/privacy) that can't live in SQL are applied in JS
 *  over the small candidate set. Degrades gracefully: no embeddings/RPC → an
 *  in-memory scan (fine for a small catalog); no reranker → similarity order. */
async function candidateJobs(viewer: any, rp: ResumeProfile | null): Promise<any[]> {
  const prefTypes = parsePrefTypes(viewer)
  const prefCountries = parsePrefCountries(viewer)

  const ann = await retrieveCandidateJobs(viewer.id, prefTypes, prefCountries, RETRIEVE_K)
  const sim = new Map<string, number>()
  let rows: any[]
  if (ann) {
    for (const a of ann) if (a.similarity != null) sim.set(a.job_id, a.similarity)
    const ids = ann.map((a) => a.job_id)
    rows = ids.length ? (must(await sb.from('job_listings').select('*').in('id', ids)) as any[]) : []
  } else {
    rows = await visibleJobs(viewer) // fallback: in-memory scan (small catalog only)
  }

  // Visibility + preference hard gates over the (now small) candidate set.
  const gates = await schoolGates(rows.map((r) => r.company_id))
  rows = rows.filter((r) => jobVisibleTo(r, viewer, gates) && prefAllowsJob(r, prefTypes, prefCountries) && !isOffTarget(r, rp))
  const bySim = (xs: any[]) => [...xs].sort((a, b) => (sim.get(b.id) ?? 0) - (sim.get(a.id) ?? 0))
  if (rows.length <= SCORE_K) return bySim(rows)

  // Stage 2a — learned ranker (Phase 2). When an ACTIVE model exists it orders the
  // candidates from cheap pre-LLM features (trained on OUR engagement), choosing
  // which get an LLM call. Falls through to Voyage rerank when there's no model yet.
  const ranker = await loadRanker()
  if (ranker) {
    const student = {
      skills: j.parse<string[]>(viewer.skills, []), seniority: rp?.seniority ?? null,
      totalYears: rp?.total_years ?? 0, country: viewer.location,
      cvLen: (viewer.cv_text ?? '').length, desiredRoles: j.parse<string[]>(viewer.desired_roles, []),
    }
    return rows
      .map((r) => ({
        r,
        p: rankerProb(ranker, extractFeatures({
          predScore: null, breakdown: null, cosine: sim.get(r.id) ?? null, student,
          job: { tags: j.parse<string[]>(r.tags, []), listing_type: r.listing_type, country: r.country, remote: r.remote === 1, createdAt: r.created_at, title: r.title, type: r.type },
        })),
      }))
      .sort((a, b) => b.p - a.p)
      .slice(0, SCORE_K)
      .map((s) => s.r)
  }

  // Stage 2b — cross-encoder rerank to the final LLM set (fallback until a ranker trains).
  const query = studentEmbedText({
    major: viewer.major, skills: j.parse(viewer.skills, []), desired_roles: j.parse(viewer.desired_roles, []),
    preferred_industries: j.parse(viewer.preferred_industries, []), cv_text: viewer.cv_text, resume_summary: rp?.summary ?? null,
  })
  const docs = rows.map((r) => jobEmbedText({ title: r.title, type: r.type, listing_type: r.listing_type, tags: j.parse(r.tags, []), description: r.description }))
  const order = await rerank(query, docs, SCORE_K)
  return order ? order.map((i) => rows[i]) : bySim(rows).slice(0, SCORE_K)
}

export const ai = Router()
ai.use(requireAuth)

// AI usage metering — per-model token totals + estimated credits for the caller.
ai.get('/usage', async (req, res) => {
  res.json(await getUsageSummary(req.user!.id))
})

/* ---------- loaders ---------- */
async function studentRow(id: string): Promise<any | null> {
  return must(await sb.from('profiles').select('*').eq('id', id).maybeSingle()) as any
}
function toMatchStudent(r: any, rp: ResumeProfile | null): MatchStudent {
  return {
    id: r.id, cv_text: r.cv_text, skills: j.parse(r.skills, []), desired_roles: j.parse(r.desired_roles, []),
    preferred_industries: j.parse(r.preferred_industries, []), work_type: r.work_type, location_pref: r.location_pref,
    location: r.location, major: r.major, resume_profile: rp ?? asResumeProfile(r.resume_profile),
  }
}
async function loadStudent(id: string): Promise<MatchStudent | null> {
  const r = await studentRow(id)
  return r ? toMatchStudent(r, null) : null
}
async function loadJob(id: string): Promise<(MatchJob & { company_id: string; description: string; location: string }) | null> {
  const r = must(await sb.from('job_listings').select('*').eq('id', id).maybeSingle()) as any
  if (!r) return null
  return { id: r.id, title: r.title, description: r.description, type: r.type, listing_type: r.listing_type, tags: j.parse(r.tags, []), country: r.country, remote: r.remote === 1, pay: r.pay, company_id: r.company_id, location: r.location, duration: r.duration, responsibilities: j.parse(r.responsibilities, []), qualifications: j.parse(r.qualifications, []), benefits: j.parse(r.benefits, []) }
}
async function companyName(companyId: string): Promise<string> {
  const r = must(await sb.from('profiles').select('company_name, full_name').eq('id', companyId).maybeSingle()) as any
  return r?.company_name || r?.full_name || 'this company'
}
const firstNameOf = (full?: string | null): string => (full ?? '').trim().split(/\s+/)[0] || ''

/** A warm, personalised, CV-AWARE system prompt for the career chat. The
 *  assistant addresses the student by name and reasons from their actual résumé
 *  so its advice is concrete rather than generic. */
function chatSystem(row: any, rp: ResumeProfile | null, matchInfo = ''): string {
  const name = firstNameOf(row?.full_name)
  const major = row?.major ? ` who is studying ${row.major}` : ''
  const cv = rp
    ? `\n\nWhat you already know about ${name || 'them'} from their résumé (use it — be specific, reference their real skills/projects):\n` +
      `• Seniority: ${rp.seniority}, ~${rp.total_years ?? 0} year(s) of experience.\n` +
      `• Skills: ${(rp.skills ?? []).map((s) => s.name).join(', ') || '—'}.\n` +
      `• Projects: ${(rp.projects ?? []).map((p) => p.name + (p.impact ? ` (${p.impact})` : '')).join('; ') || '—'}.\n` +
      `• Domains: ${(rp.domains ?? []).join(', ') || '—'}. Likely gaps: ${(rp.gaps ?? []).join(', ') || '—'}.`
    : (row?.cv_text ?? '').trim()
      ? `\n\n${name || 'They'} uploaded this résumé — read it and ground your advice in it:\n${String(row.cv_text).slice(0, 4000)}`
      : `\n\n${name || 'They'} hasn't uploaded a résumé yet. Warmly encourage them to add one so you can give sharper, personalised help.`
  return (
    `You are ${name ? `${name}'s` : 'a'} friendly, encouraging, and HONEST personal career assistant for a student${major}. ` +
    `Talk like a supportive human mentor — warm, conversational, and on their side${name ? `; address them as ${name}` : ''}. ` +
    `Help with CV, jobs, skills, and interviews. Give direct, truthful advice — be kind but never flatter or over-promise; if something's a real weakness, say so gently and give the next step. ` +
    `You may use markdown tables, lists, and code blocks.` +
    cv +
    matchInfo
  )
}

/** A compact summary of the student's REAL, already-scored job matches (from the
 *  cache only — no new scoring, so it's instant and rate-limit-safe) to feed the
 *  chat. Lets the assistant answer "what am I a good fit for?" with real roles. */
async function matchContext(uid: string): Promise<string> {
  const cm = await cacheMap(uid)
  const matches: AiMatch[] = []
  for (const r of cm.values()) {
    try { if (r?.payload) matches.push(JSON.parse(r.payload)) } catch { /* skip bad row */ }
  }
  if (!matches.length) return '\n\nThey have NO computed job matches yet — if they ask about matches, warmly point them to Opportunities or the Insights tab so the matcher can score roles for them.'
  const ids = matches.map((m) => m.job_id)
  const jobs = (must(await sb.from('job_listings').select('id,title,listing_type').in('id', ids)) as any[]) ?? []
  const jById = new Map(jobs.map((x) => [x.id, x]))
  const ranked = matches.filter((m) => jById.has(m.job_id)).sort((a, b) => b.score - a.score)
  if (!ranked.length) return ''
  const top = ranked.slice(0, 6).map((m) => `${jById.get(m.job_id).title} (${jById.get(m.job_id).listing_type}, ${m.score}% fit)`)
  const strengthCount = new Map<string, number>()
  const gapCount = new Map<string, number>()
  for (const m of ranked) {
    for (const s of m.matched_skills ?? []) strengthCount.set(s, (strengthCount.get(s) ?? 0) + 1)
    for (const g of m.mismatch_flags ?? []) gapCount.set(g, (gapCount.get(g) ?? 0) + 1)
  }
  const top2 = (mp: Map<string, number>) => Array.from(mp.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n]) => n).join(', ')
  const avg = Math.round(ranked.reduce((a, b) => a + b.score, 0) / ranked.length)
  return (
    `\n\nTHEIR REAL JOB MATCHES (already scored by the matcher — reference these specifically; do NOT invent other roles or scores):\n` +
    `• ${ranked.length} scored roles, average fit ${avg}%.\n` +
    `• Strongest matches: ${top.join('; ')}.\n` +
    `• Skills helping them match: ${top2(strengthCount) || '—'}.\n` +
    `• Common gaps flagged across roles: ${top2(gapCount) || '—'}.`
  )
}

/* ---------- §8.1 AI Job Matcher (honest rubric, structured + cached) ---------- */
async function claudeScore(student: MatchStudent, job: MatchJob, rp: ResumeProfile | null): Promise<LlmScore | null> {
  // Structured evidence (cited) when parsed; otherwise the raw CV, or an explicit
  // "unverified" marker so the model can't reward a candidate it can't see.
  const evidence = rp
    ? `PARSED RÉSUMÉ (evidence) — seniority: ${rp.seniority}, ~${rp.total_years}y experience.\n` +
      `Skills with evidence: ${(rp.skills ?? []).map((s) => `${s.name}${s.level ? ` (${s.level})` : ''}${s.evidence ? ` ["${s.evidence}"]` : ''}`).join('; ') || '—'}\n` +
      `Projects: ${(rp.projects ?? []).map((p) => p.name + (p.impact ? ` — ${p.impact}` : '')).join('; ') || '—'}\n` +
      `Domains: ${(rp.domains ?? []).join(', ') || '—'}. Likely gaps noted at parse time: ${(rp.gaps ?? []).join(', ') || '—'}.`
    : student.cv_text
      ? `RÉSUMÉ TEXT:\n${student.cv_text}`
      : 'NO RÉSUMÉ ON FILE — treat competence as UNVERIFIED and cap the score accordingly.'

  // Give the model the FULL posting — description, responsibilities, qualifications,
  // benefits, plus the logistics (location/remote/pay/duration) — so the score
  // reflects everything on the job form, not just title + tags.
  const bullets = (label: string, items?: string[]) =>
    items && items.length ? `\n${label}:\n${items.map((x) => `• ${x}`).join('\n')}` : ''
  const jobBlock =
    `${job.title} (${job.type}, ${job.listing_type}${job.duration ? `, ${job.duration}` : ''}).\n` +
    `Location: ${job.location ?? '—'}${job.remote ? ' · remote OK' : ''}. Compensation: ${job.pay || '—'}.\n` +
    `Core requirements / skills: ${job.tags.join(', ') || '—'}.\n` +
    `Description: ${job.description || '—'}` +
    bullets('Responsibilities', job.responsibilities) +
    bullets('Qualifications', job.qualifications) +
    bullets('Benefits', job.benefits)
  const { addendum } = await calibration()

  const parsed = await claudeJson<LlmScore>({
    model: MODELS.match,
    maxTokens: 800,
    temperature: 0, // stable, repeatable scores — same résumé+job → same number
    system: buildScoringSystem(jobBlock, addendum),
    schema: SCORE_SCHEMA,
    user:
      `CANDIDATE\nField of study: ${student.major ?? '—'}\nStated target roles: ${(student.desired_roles ?? []).join(', ') || '—'}\n` +
      `Self-reported skills (these are CLAIMS — credit only where the résumé evidences them): ${(student.skills ?? []).join(', ') || '—'}\n\n${evidence}`,
  })
  if (!parsed || typeof parsed.score !== 'number') return null
  return {
    score: Math.max(1, Math.min(99, Math.round(parsed.score))),
    confidence: (['low', 'medium', 'high'] as const).includes(parsed.confidence) ? parsed.confidence : 'low',
    breakdown: {
      skills: clampInt(parsed.breakdown?.skills, 0, 100),
      experience: clampInt(parsed.breakdown?.experience, 0, 100),
      location: clampInt(parsed.breakdown?.location, 0, 100),
      compensation: clampInt(parsed.breakdown?.compensation, 0, 100),
    },
    matched_skills: parsed.matched_skills ?? [],
    reasons: parsed.reasons ?? [],
    flags: parsed.flags ?? [],
    tip: parsed.tip ?? '',
  }
}

interface MatchOpts { cache?: boolean }
// Per-request preloaded context so loops over many jobs don't re-fetch the same
// student row / résumé / cache row N times. `cached` of `null` means "known
// miss, don't query"; `undefined` means "look it up yourself".
interface MatchCtx { row?: any; rp?: ResumeProfile | null; cached?: any | null }

/** Apply the honest caps to a raw LLM score → final AiMatch. Claude is the only
 *  source of the number; no deterministic component. */
function finalize(cs: LlmScore, student: MatchStudent, job: MatchJob, rp: ResumeProfile | null): AiMatch {
  // Competence ceiling, ramped smoothly (no hard cliffs): we can only score as
  // high as the evidence lets us trust. No CV → unverifiable (cap 50). Raw CV
  // text → ramp 55→92 as it gets more substantial. A parsed, evidence-linked
  // résumé profile → ramp 75→99. The ceiling moves with evidence, not a single
  // arbitrary character threshold.
  const cvLen = (student.cv_text ?? '').length
  const cap =
    cvLen === 0 ? 50
    : !rp ? Math.round(55 + (Math.min(cvLen, 1500) / 1500) * 37)
    : Math.round(75 + (Math.min(Math.max(cvLen - 300, 0), 1200) / 1200) * 24)
  let score = cs.score
  if (cs.confidence === 'low') score = Math.min(score, 60)
  else if (cs.confidence === 'medium') score = Math.min(score, 88)
  score = Math.min(cap, Math.round(score))
  return {
    student_id: student.id,
    job_id: job.id,
    score,
    breakdown: cs.breakdown,
    matched_skills: cs.matched_skills,
    reasons: cs.reasons.slice(0, 3),
    mismatch_flags: cs.flags.slice(0, 3),
    tip: cs.tip,
    created_at: new Date().toISOString(),
  }
}

/** When Claude can't score (no key / transient error) but a distilled model exists,
 *  return a clearly-labelled ESTIMATE instead of nothing — so a hiccup doesn't empty
 *  a student's matches. Never cached (the real score should replace it next time). */
async function distilledFallback(student: MatchStudent, job: MatchJob, rp: ResumeProfile | null): Promise<AiMatch | null> {
  const model = await loadDistill()
  if (!model) return null
  const feats = extractFeatures({
    predScore: null, breakdown: null, cosine: null,
    student: { skills: student.skills ?? [], seniority: rp?.seniority ?? null, totalYears: rp?.total_years ?? 0, country: student.location, cvLen: (student.cv_text ?? '').length, desiredRoles: student.desired_roles ?? [] },
    job: { tags: job.tags ?? [], listing_type: job.listing_type, country: job.country, remote: job.remote, createdAt: null, title: job.title, type: job.type },
  })
  const lc = (student.skills ?? []).map((s) => s.toLowerCase())
  return {
    student_id: student.id, job_id: job.id, score: distillScore(model, feats),
    breakdown: { skills: 0, experience: 0, location: 0, compensation: 0 },
    matched_skills: (job.tags ?? []).filter((t) => lc.includes(t.toLowerCase())).slice(0, 6),
    reasons: ['Estimated match — the AI scorer was briefly unavailable, so this is a fast approximation.'],
    mismatch_flags: [], tip: 'This is an estimate; reopen later for the full, evidence-backed score.',
    created_at: new Date().toISOString(),
  }
}

/** Honest Claude score for one (student, job), with a distilled estimate as a
 *  fallback when Claude is unavailable. Returns null only when neither is available. */
async function getMatch(studentId: string, job: MatchJob, opts: MatchOpts = {}, ctx: MatchCtx = {}): Promise<AiMatch | null> {
  const useCache = opts.cache !== false
  if (useCache) {
    let cached = ctx.cached
    if (cached === undefined) {
      cached = (await sb.from('ai_match_cache').select('payload, stale').eq('student_id', studentId).eq('job_id', job.id).maybeSingle()).data as any
    }
    if (cached && cached.stale === 0) {
      const p = JSON.parse(cached.payload)
      // Only trust a cached score computed by the CURRENT engine; otherwise fall
      // through and re-score (handles rubric/model/cap changes automatically).
      if (p.v === ENGINE_VERSION) return p
    }
  }

  const row = ctx.row ?? (await studentRow(studentId))
  const rp = ctx.row ? (ctx.rp ?? null) : await ensureResumeProfile(row)
  const student = toMatchStudent(row, rp)
  const cs = await claudeScore(student, job, rp)
  const result = cs ? finalize(cs, student, job, rp) : await distilledFallback(student, job, rp)
  if (!result) return null

  // Cache only REAL Claude scores — never the distilled estimate, so the genuine
  // score replaces it as soon as Claude is back.
  if (useCache && cs) {
    must(await sb.from('ai_match_cache').upsert(
      { student_id: studentId, job_id: job.id, payload: JSON.stringify({ ...result, v: ENGINE_VERSION }), stale: 0, created_at: now() },
      { onConflict: 'student_id,job_id' },
    ))
  }
  return result
}

/** Active jobs visible to a student — same gates as /jobs (year/school +
 *  school-domain/privacy), so restricted listings are never scored or surfaced. */
async function visibleJobs(viewer: any): Promise<any[]> {
  const rows = must(await sb.from('job_listings').select('*').eq('status', 'active')) as any[]
  const gates = await schoolGates(rows.map((r) => r.company_id))
  return rows.filter((r) => jobVisibleTo(r, viewer, gates))
}

/** Build a MatchJob from an already-loaded job row (avoids a per-job re-query). */
function rowToMatchJob(r: any): MatchJob & { company_id: string; description: string; location: string } {
  return { id: r.id, title: r.title, description: r.description, type: r.type, listing_type: r.listing_type, tags: j.parse(r.tags, []), country: r.country, remote: r.remote === 1, pay: r.pay, company_id: r.company_id, location: r.location, duration: r.duration, responsibilities: j.parse(r.responsibilities, []), qualifications: j.parse(r.qualifications, []), benefits: j.parse(r.benefits, []) }
}

/** All cached match rows for a student in ONE query → job_id -> {payload,stale}. */
async function cacheMap(studentId: string): Promise<Map<string, any>> {
  const rows = (must(await sb.from('ai_match_cache').select('job_id, payload, stale').eq('student_id', studentId)) as any[]) ?? []
  return new Map(rows.map((r) => [r.job_id, r]))
}

ai.get('/match/:jobId', async (req, res) => {
  const r = must(await sb.from('job_listings').select('*').eq('id', req.params.jobId).maybeSingle()) as any
  if (!r) return res.status(404).json({ error: 'not_found' })
  // Don't score (or even reveal a match for) a job the viewer can't see.
  const viewer = await studentRow(req.user!.id)
  const gates = await schoolGates([r.company_id])
  if (!jobVisibleTo(r, viewer, gates)) return res.status(404).json({ error: 'not_found' })
  const m = await getMatch(req.user!.id, rowToMatchJob(r))
  if (!m) return res.status(503).json({ error: 'ai_unavailable' })
  res.json(m)
})

ai.get('/matches', async (req, res) => {
  const uid = req.user!.id
  const viewer = await studentRow(uid)
  const ready = matchReadiness(viewer)
  if (!ready.ready) return res.status(409).json({ error: 'profile_incomplete', missing: ready.missing })
  const rp = await ensureResumeProfile(viewer)
  const [visible, cm] = await Promise.all([candidateJobs(viewer, rp), cacheMap(uid)])
  // Parallel: cached jobs return instantly; uncached ones score concurrently.
  // Jobs Claude couldn't score (no key / error) are simply omitted.
  const out = await Promise.all(
    visible.map((r) => getMatch(uid, rowToMatchJob(r), {}, { row: viewer, rp, cached: cm.get(r.id) ?? null })),
  )
  res.json(out.filter(Boolean))
})

/* Streaming matches: scores roles one-by-one and emits live progress so the UI
 * can show "scoring X of N: <title>" with a real percentage — and keep updating
 * even if the user switches tabs (the stream drives a global store, not a view).
 * Frames: {meta:{total}} · {progress:{done,total,title}, match} per job · {done:true}. */
ai.post('/matches/stream', async (req, res) => {
  if (!hasClaude()) return res.status(503).json({ error: 'ai_unavailable' })
  const uid = req.user!.id
  const viewer = await studentRow(uid)
  const ready = matchReadiness(viewer)
  const rp = ready.ready ? await ensureResumeProfile(viewer) : null
  const [visible, cm] = ready.ready
    ? await Promise.all([candidateJobs(viewer, rp), cacheMap(uid)])
    : [[] as any[], new Map<string, AiMatch>()]
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`))
      try {
        if (!ready.ready) { send({ notReady: { missing: ready.missing } }); send({ done: true }); return }
        const total = visible.length
        send({ meta: { total } })
        let done = 0
        // Sequential so progress is granular AND we don't burst past the Haiku
        // rate limit; cached roles return instantly.
        for (const r of visible) {
          const job = rowToMatchJob(r)
          let m: AiMatch | null = null
          try { m = await getMatch(uid, job, {}, { row: viewer, rp, cached: cm.get(r.id) ?? null }) } catch { m = null }
          done++
          send({ progress: { done, total, title: job.title }, match: m })
        }
        send({ done: true })
      } catch {
        send({ error: true })
      } finally {
        controller.close()
      }
    },
  })
  res.sse(stream)
})

/** Turn what the outcome-tracking worker learned (migration 0014) into concrete,
 *  honest nudges for the student. Only emits a nudge when there's something real to
 *  say — a confirmed hire, detected progress, or a worker-recommended next step — so
 *  we never invent noise. Empty until the worker writes signals / the migration runs. */
async function outcomeNudges(uid: string): Promise<{ title: string; message: string; status: string }[]> {
  let rows: any[] = []
  try { rows = ((await sb.from('match_outcomes').select('job_id, status, signals').eq('student_id', uid)).data as any[]) ?? [] } catch { return [] }
  if (!rows.length) return []
  const jobs = (must(await sb.from('job_listings').select('id, title').in('id', rows.map((r) => r.job_id))) as any[]) ?? []
  const titleOf = new Map<string, string>(jobs.map((jr) => [jr.id, jr.title]))
  const out: { title: string; message: string; status: string }[] = []
  for (const r of rows) {
    const title = titleOf.get(r.job_id) ?? 'a role you applied to'
    const sig = (r.signals ?? {}) as any
    const next = typeof sig.recommended === 'string' ? sig.recommended : typeof sig.next === 'string' ? sig.next : null
    if (r.status === 'likely_hired') out.push({ status: r.status, title, message: `It looks like things moved forward with ${title} — congrats! Keep your profile updated so we can find your next step.` })
    else if (r.status === 'profile_updated') out.push({ status: r.status, title, message: next ? `You're making progress since applying to ${title}. Next: ${next}.` : `Nice progress since you applied to ${title} — keep building on it.` })
    else if (r.status === 'monitoring' && next) out.push({ status: r.status, title, message: `While ${title} reviews applicants, ${next}.` })
  }
  return out.slice(0, 4)
}

/* ---------- §8.2 Insights — one engine, aggregated (skill gaps, demand, do-next) ---------- */
ai.get('/insights', async (req, res) => {
  const uid = req.user!.id
  const viewer = await studentRow(uid)
  const ready = matchReadiness(viewer)
  if (!ready.ready) return res.status(409).json({ error: 'profile_incomplete', missing: ready.missing })
  const rp = await ensureResumeProfile(viewer)
  const [visible, cm] = await Promise.all([candidateJobs(viewer, rp), cacheMap(uid)])
  const scoredRows = await Promise.all(
    visible.map(async (r) => {
      const job = rowToMatchJob(r)
      const m = await getMatch(uid, job, {}, { row: viewer, rp, cached: cm.get(r.id) ?? null })
      return m ? { job, m } : null
    }),
  )
  const rows = scoredRows.filter((x): x is { job: any; m: AiMatch } => !!x)
  rows.sort((a, b) => b.m.score - a.m.score)

  const scores = rows.map((r) => r.m.score)
  const readiness = scores.length ? Math.round(scores.slice(0, 5).reduce((a, b) => a + b, 0) / Math.min(5, scores.length)) : 0
  const distribution = {
    excellent: scores.filter((s) => s >= 85).length,
    strong: scores.filter((s) => s >= 70 && s < 85).length,
    stretch: scores.filter((s) => s >= 50 && s < 70).length,
    weak: scores.filter((s) => s < 50).length,
  }

  const gapCount = new Map<string, number>()
  const strengthCount = new Map<string, number>()
  const demandCount = new Map<string, number>()
  for (const { job, m } of rows) {
    for (const tag of job.tags ?? []) demandCount.set(tag, (demandCount.get(tag) ?? 0) + 1)
    for (const s of m.matched_skills) strengthCount.set(s, (strengthCount.get(s) ?? 0) + 1)
    for (const tag of (job.tags ?? []).filter((t: string) => !m.matched_skills.includes(t))) gapCount.set(tag, (gapCount.get(tag) ?? 0) + 1)
  }
  const rank = (mp: Map<string, number>, n: number) => Array.from(mp.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }))
  const gaps = rank(gapCount, 8)
  const strengths = rank(strengthCount, 8)
  const demand = rank(demandCount, 10)

  const topMatches = rows.slice(0, 5).map(({ job, m }) => ({ job_id: job.id, title: job.title, company_id: job.company_id, listing_type: job.listing_type, location: job.location, score: m.score }))
  const nudges = await outcomeNudges(uid)

  // Career-trajectory ("reachable roles"): stretch matches the student is only a few
  // LEARNABLE skills away from — forward-looking, not just current fit. From the
  // already-scored rows, so no extra LLM calls.
  const reachableAll = rows
    .filter(({ m }) => m.score >= 52 && m.score < 80)
    .map(({ job, m }) => ({ job, score: m.score, missing: (job.tags ?? []).filter((t: string) => !m.matched_skills.includes(t)) }))
    .filter((r) => r.missing.length >= 1 && r.missing.length <= 3)
  const reachable = reachableAll
    .sort((a, b) => a.missing.length - b.missing.length || b.score - a.score)
    .slice(0, 6)
    .map((r) => ({ job_id: r.job.id, title: r.job.title, company_id: r.job.company_id, listing_type: r.job.listing_type, location: r.job.location, score: r.score, missing: r.missing, bridge: `Add ${r.missing.join(' & ')} to qualify.` }))
  // Highest-leverage skills: which single skill unlocks the most reachable roles.
  const unlockMap = new Map<string, string[]>()
  for (const r of reachableAll) for (const s of r.missing) (unlockMap.get(s) ?? unlockMap.set(s, []).get(s)!).push(r.job.title)
  const unlocks = Array.from(unlockMap.entries())
    .map(([skill, titles]) => ({ skill, count: titles.length, roles: titles.slice(0, 4) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  // Honest template fallback (also the no-key path).
  const noCv = !(viewer?.cv_text ?? '').trim()
  const fallbackDoNext: string[] = []
  if (noCv) fallbackDoNext.push('Upload your CV — without it every match is capped at 60.')
  if (gaps[0]) fallbackDoNext.push(`Learn ${gaps[0].name} — it’s asked for in ${gaps[0].count} of your matched roles.`)
  if (gaps[1]) fallbackDoNext.push(`Build a small project using ${gaps[1].name} to close your second-biggest gap.`)
  if (topMatches[0]) fallbackDoNext.push(`Apply to your strongest match: ${topMatches[0].title} (${topMatches[0].score}% fit).`)
  if ((j.parse<string[]>(viewer?.skills, []) ?? []).length < 4) fallbackDoNext.push('Add a few more skills to your profile so the matcher can find more roles for you.')

  // AI-generated, personalised next steps grounded in the student's REAL match data.
  let doNext = fallbackDoNext
  if (hasClaude() && rows.length) {
    const name = firstNameOf(viewer?.full_name)
    const ai = await claudeText({
      model: MODELS.score,
      maxTokens: 400,
      system:
        `You are ${name ? `${name}'s ` : 'a '}honest, encouraging career coach. From the student's REAL match data below, write 3-5 specific, motivating next actions — each short, imperative, and concrete (reference their actual gaps/roles, not generic advice). ${noCv ? 'They have NOT uploaded a CV — make the first action uploading it. ' : ''}Reply ONLY a JSON array of strings.`,
      user:
        `Readiness: ${readiness}/100 across ${rows.length} roles.\n` +
        `Top skill gaps (skill : #roles wanting it): ${gaps.slice(0, 5).map((g) => `${g.name}:${g.count}`).join(', ') || '—'}.\n` +
        `Evident strengths: ${strengths.slice(0, 5).map((s) => s.name).join(', ') || '—'}.\n` +
        `Strongest matches: ${topMatches.slice(0, 3).map((t) => `${t.title} (${t.score}%)`).join('; ') || '—'}.\n` +
        `Post-application signals (from tracking their real outcomes — reference if present): ${nudges.map((n) => n.message).join(' | ') || '—'}.\n` +
        `Roles within reach (a few skills away — great for "do next"): ${reachable.slice(0, 3).map((r) => `${r.title} (needs ${r.missing.join(', ')})`).join('; ') || '—'}.\n` +
        `Highest-leverage skill to learn (unlocks the most reachable roles): ${unlocks[0] ? `${unlocks[0].skill} → ${unlocks[0].count} roles` : '—'}.\n` +
        `Résumé summary: ${rp?.summary ?? '—'}.`,
    })
    const list = (parseJsonArray<string>(ai)?.filter((x) => typeof x === 'string' && x.trim())) ?? parseList(ai)
    if (list.length) doNext = list.slice(0, 5)
  }

  res.json({ readiness, total: rows.length, distribution, gaps, strengths, demand, topMatches, doNext, outcomeNudges: nudges, reachable, unlocks })
})

/* ---------- §8.3 Company research ---------- */
ai.post('/company', async (req, res) => {
  const { company, role } = req.body ?? {}
  if (hasClaude()) {
    const text = await claudeTextWithSearch({
      model: MODELS.research,
      maxTokens: 900,
      system:
        'You are a warm, encouraging career guide researching a company for an early-career African/global student, using current web results. Write in a friendly, supportive voice that helps them feel prepared and excited — like a mentor who did the homework for them. ' +
        'Be genuinely helpful and specific (cite what you actually found), but stay honest and balanced — surface REAL risks (layoffs, funding trouble, poor reviews, visa limits) when the evidence shows them, framed constructively; do not write a brochure and do not sugar-coat. ' +
        'Reply ONLY with JSON: {"overview","culture","opportunity","red_flags","questions":["..","..",".."],"verdict"}.',
      user: `Company: ${company}. Role: ${role ?? 'an early-career role'}. Search for recent, specific information before answering.`,
    })
    const parsed = extractJson<any>(text)
    if (parsed) return res.json(parsed)
    return res.status(503).json({ error: 'ai_unavailable' })
  }
  // No API key configured — hardcoded safety net only.
  res.json({
    overview: `${company} is a fast-growing company building products with real traction. It invests in early-career talent.`,
    culture: `Interns report genuine ownership and supportive mentorship in an outcomes-focused environment.`,
    opportunity: `For an ambitious early-career candidate, ${company} offers strong learning velocity and a global team.`,
    red_flags: `As with any high-growth company, scope shifts quickly and processes are still maturing — clarify expectations up front.`,
    questions: [`What does success look like in the first 90 days of ${role ?? 'this role'}?`, 'How is mentorship structured for early-career hires?', "What's the team's approach to work-life balance?"],
    verdict: `A strong fit for a self-driven learner who wants real impact early — go for it.`,
  })
})

// Streamed company research — markdown, live web-grounded, rendered token-by-token
// so the student sees progress instead of waiting ~1min for a blocking call (and
// no brittle JSON parse to fail). max_uses bounds the web search so it stays snappy.
const COMPANY_STREAM_SYSTEM =
  'You are a warm, encouraging career guide researching a company for an early-career African/global student, grounded in CURRENT web results. ' +
  'Write in friendly, supportive Markdown — like a mentor who did the homework for them. Be specific and cite what you actually found, but stay honest and balanced: surface REAL risks (layoffs, funding trouble, poor reviews, visa limits) when the evidence shows them, framed constructively. Do not write a brochure; do not sugar-coat.\n\n' +
  'Use EXACTLY these section headings, in this order, each 2–4 sentences:\n' +
  '## What they do\n## What it’s like to work there\n## Why it could be a fit for you\n## Honest red flags\n## Smart questions to ask\n(then 3 short bullet questions)\n## Bottom line\n(one or two honest, encouraging sentences)\n\n' +
  'Search the web first, then write.'

ai.post('/company/stream', async (req, res) => {
  if (!hasClaude()) return res.status(503).json({ error: 'ai_unavailable' })
  const { company, role } = req.body ?? {}
  const stream = streamClaude({
    model: MODELS.research,
    maxTokens: 900,
    system: COMPANY_STREAM_SYSTEM,
    user: `Company: ${company}. Role: ${role ?? 'an early-career role'}. Search for recent, specific information before writing.`,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }],
    meta: { company }, // flush headers immediately so the client connection opens during the search phase
  })
  if (!stream) return res.status(503).json({ error: 'ai_unavailable' })
  res.sse(stream)
})

/* ---------- §8.4 Chat (CV-aware, personalised) ---------- */
ai.post('/chat', async (req, res) => {
  const { message } = req.body ?? {}
  const row = await studentRow(req.user!.id)
  if (hasClaude()) {
    const [rp, matchInfo] = await Promise.all([ensureResumeProfile(row), matchContext(req.user!.id)])
    const text = await claudeText({
      model: MODELS.chat,
      maxTokens: 1200,
      thinking: true,
      system: chatSystem(row, rp, matchInfo),
      user: message ?? '',
    })
    if (text) return res.json({ text })
    return res.status(503).json({ error: 'ai_unavailable' })
  }
  res.json({ text: canChat(message ?? '') }) // no key: safety net
})

/* Streaming chat — same CV-aware + match-aware prompt, rendered token-by-token. */
ai.post('/chat/stream', async (req, res) => {
  if (!hasClaude()) return res.status(503).json({ error: 'ai_unavailable' })
  const { message } = req.body ?? {}
  const row = await studentRow(req.user!.id)
  const [rp, matchInfo] = await Promise.all([ensureResumeProfile(row), matchContext(req.user!.id)])
  const stream = streamClaude({
    model: MODELS.chat,
    maxTokens: 1200,
    system: chatSystem(row, rp, matchInfo),
    user: message ?? '',
  })
  if (!stream) return res.status(503).json({ error: 'ai_unavailable' })
  res.sse(stream)
})

/* ---------- §8.5 Application Coach ---------- */
ai.post('/coach', async (req, res) => {
  const job = await loadJob(req.body?.job_id)
  const row = await studentRow(req.user!.id)
  if (!job || !row) return res.status(404).json({ error: 'not_found' })
  const rp = asResumeProfile(row.resume_profile)
  const student = toMatchStudent(row, rp)
  const evidence = rp ? `Parsed skills: ${(rp.skills ?? []).map((s) => s.name).join(', ')}. Projects: ${(rp.projects ?? []).map((p) => p.name).join(', ')}.` : student.cv_text ?? ''
  if (hasClaude()) {
    const text = await claudeText({
      model: MODELS.coach,
      maxTokens: 1100,
      thinking: true,
      system:
        'You are an honest application coach. Produce JSON: {"draft":"<180-word first-person paragraph","critique":{"strengths":[],"weaknesses":[],"missing":[],"verdict":"ship as-is|refine|rewrite"},"final":"refined paragraph"}. Never invent qualifications the candidate does not have; give a candid critique (real weaknesses, not token ones); ban clichés ("passionate about","leverage").',
      user: `STUDENT: ${student.major ?? ''}, skills ${(student.skills ?? []).join(', ')}. ${evidence}\nJOB: ${job.title} — ${job.description}`,
    })
    const parsed = extractJson<any>(text)
    if (parsed?.draft && parsed?.final) return res.json(parsed)
    return res.status(503).json({ error: 'ai_unavailable' })
  }
  res.json(canCoach(student, job)) // no key: safety net
})

/* ---------- CV Tips ---------- */
ai.post('/cv-tips', async (req, res) => {
  const row = await studentRow(req.user!.id)
  const rp = await ensureResumeProfile(row) // extracts + parses an uploaded résumé if needed
  const ctx = rp
    ? `Their résumé shows seniority ${rp.seniority}, skills ${(rp.skills ?? []).map((s) => s.name).join(', ')}, gaps ${(rp.gaps ?? []).join(', ')}. Summary: ${rp.summary ?? '—'}.`
    : (row?.cv_text ?? '').trim()
      ? `Their résumé text:\n${String(row.cv_text).slice(0, 3000)}`
      : 'No résumé on file yet — give general but actionable tips and encourage them to upload one.'
  if (hasClaude()) {
    const text = await claudeText({ model: MODELS.chat, maxTokens: 500, system: 'Give 5-6 concise, personalized CV improvement tips. Reply ONLY JSON array of strings.', user: ctx })
    const parsed = extractJson<string[]>(text ? `{"x":${text}}` : null) as any
    const tips = Array.isArray(parsed) ? parsed : parseList(text)
    if (tips.length) return res.json(tips)
    return res.status(503).json({ error: 'ai_unavailable' })
  }
  res.json([ // no key: safety net
    'Lead each bullet with a strong verb and a measurable result.',
    'Move your most relevant project to the top of the page.',
    'Add the specific tools/frameworks recruiters search for.',
    'Cut anything older than your most recent, most relevant work.',
    'Keep it to one page — every line should earn its place.',
    'Add links: GitHub, portfolio, and LinkedIn in the header.',
  ])
})

/* ---------- §8.6 Career Compass ---------- */
const COMPASS_Q = [
  'To start: what kind of problem or impact do you most want to work on?',
  'What environment helps you do your best work — big team, small startup, remote, on-site?',
  "Tell me about a project or moment you're genuinely proud of.",
  'Which skills do you most want to build over the next year?',
  'Any real-life constraints I should factor in — location, language, schedule?',
]
const interviewSystem = (name: string, idx: number) =>
  `You are a warm, friendly Career Compass guide in conversation with ${name || 'a student'} — sound like a real person who genuinely cares, never like a form or interrogation. ` +
  `In ONE short message (max ~30 words): warmly and specifically acknowledge their most recent answer${name ? `, occasionally using their name (${name}) naturally — don't overuse it` : ''}, then ask the next question conversationally. ` +
  `The next question MUST cover this exact topic: "${COMPASS_Q[idx]}". Reply with ONLY that message — no preamble, no quotes.`

ai.post('/compass/interview', async (req, res) => {
  const answers: string[] = req.body?.answers ?? []
  const idx = answers.length
  const row = await studentRow(req.user!.id)
  const name = firstNameOf(row?.full_name)
  if (idx >= COMPASS_Q.length) return res.json({ done: true, message: `Perfect${name ? `, ${name}` : ''} — I've got a clear picture of you now. Give me a moment to pull together the directions that fit you best…` })
  // Hardcoded conversational fallback (used when Claude is unavailable / errors).
  const reacts = ['That really helps me understand you.', 'Love that.', 'Great — noted.', 'Thanks for sharing that.']
  const lead = idx === 0
    ? `Hi${name ? ` ${name}` : ' there'}! I'm your Career Compass — think of me as a friend helping you figure out your next step, no pressure. `
    : `${reacts[(idx - 1) % reacts.length]} `
  const fallback = { done: false as const, message: lead + COMPASS_Q[idx], question: COMPASS_Q[idx] }

  // When Claude is available and we have a prior answer to react to, generate a
  // warm, contextual follow-up that uses their name. Cheap (Haiku) — once per answer.
  if (hasClaude() && idx > 0) {
    const convo = answers.map((a, i) => `Q${i + 1}: ${COMPASS_Q[i]}\nA: ${a}`).join('\n\n')
    const text = await claudeText({ model: MODELS.score, maxTokens: 150, system: interviewSystem(name, idx), user: convo })
    if (text?.trim()) return res.json({ done: false, message: text.trim(), question: COMPASS_Q[idx] })
  }
  res.json(fallback)
})

/* Streaming Career Compass question — the warm follow-up types out live. Only
 * mid-interview turns stream (the greeting + the closing line are fixed text);
 * 409 tells the client to use the plain endpoint for those. */
ai.post('/compass/interview/stream', async (req, res) => {
  if (!hasClaude()) return res.status(503).json({ error: 'ai_unavailable' })
  const answers: string[] = req.body?.answers ?? []
  const idx = answers.length
  if (idx === 0 || idx >= COMPASS_Q.length) return res.status(409).json({ error: 'no_stream' })
  const row = await studentRow(req.user!.id)
  const name = firstNameOf(row?.full_name)
  const convo = answers.map((a, i) => `Q${i + 1}: ${COMPASS_Q[i]}\nA: ${a}`).join('\n\n')
  const stream = streamClaude({
    model: MODELS.score,
    maxTokens: 150,
    meta: { done: false, question: COMPASS_Q[idx] },
    system: interviewSystem(name, idx),
    user: convo,
  })
  if (!stream) return res.status(503).json({ error: 'ai_unavailable' })
  res.sse(stream)
})

/** Label what the student told us they care about (shown as chips). Purely
 *  descriptive now — there's no deterministic engine to re-weight. */
function deriveSignals(answers: string[]): string[] {
  const t = answers.join(' \n ').toLowerCase()
  const signals: string[] = []
  if (/remote|anywhere|relocat|\blocation\b|visa|from home|hybrid|on[- ]?site/.test(t)) signals.push('work-style / location')
  if (/learn|grow|develop|build my|improve|master|upskill|new skill/.test(t)) signals.push('skill growth')
  if (/impact|mission|purpose|social|climate|health|education|community|sustainab|africa/.test(t)) signals.push('mission / impact')
  if (/startup|small team|fast[- ]?paced|ownership|autonomy/.test(t)) signals.push('startup ownership')
  if (/pay|salary|money|compensation|stipend|well[- ]?paid/.test(t)) signals.push('compensation')
  return signals
}

ai.post('/compass/recommend', async (req, res) => {
  const answers: string[] = req.body?.answers ?? []
  const uid = req.user!.id
  const viewer = await studentRow(uid)
  const rp = await ensureResumeProfile(viewer)
  const [visible, cm] = await Promise.all([candidateJobs(viewer, rp), cacheMap(uid)])
  const signals = deriveSignals(answers)

  // Rank by the honest Claude score: cached when present, else score now.
  // Jobs Claude can't score are skipped.
  const scoredAll = await Promise.all(visible.map(async (r) => {
    const job = rowToMatchJob(r)
    const m = await getMatch(uid, job, {}, { row: viewer, rp, cached: cm.get(r.id) ?? null })
    return m ? { job, m } : null
  }))
  const top = scoredAll
    .filter((x): x is { job: ReturnType<typeof rowToMatchJob>; m: AiMatch } => !!x)
    .sort((a, b) => b.m.score - a.m.score)
    .slice(0, 3)
  const name = firstNameOf(viewer?.full_name)
  // Templated narrative (also the no-key path / fallback).
  const tmplNarrative = (job: ReturnType<typeof rowToMatchJob>, m: AiMatch) => {
    const missing = job.tags.filter((t) => !m.matched_skills.includes(t))
    return {
      why: `This fits your profile${m.matched_skills.length ? ` in ${m.matched_skills.slice(0, 2).join(', ')}` : ''}${signals.length ? `, weighted toward your priorities (${signals.slice(0, 2).join(', ')})` : ''} — a strong ${job.listing_type.toLowerCase()} match.`,
      stretch: missing.length ? `You'd stretch into ${missing.slice(0, 2).join(' and ')}.` : 'You would deepen your existing strengths here.',
      actions: [`Tailor your CV to highlight ${m.matched_skills[0] ?? job.type}.`, `Build a small project using ${missing[0] ?? job.tags[0] ?? 'a core skill'}.`, 'Use AI Research, then message someone on the team.'],
    }
  }
  // AI-written, personal notes for all top picks in ONE call (grounded in the
  // real Claude scores + matched skills). Falls back to the template per field.
  let notes: any[] | null = null
  if (hasClaude() && top.length) {
    const ai = await claudeText({
      model: MODELS.score,
      maxTokens: 700,
      system:
        `You are ${name ? `${name}'s ` : 'a '}warm, honest career mentor. For each recommended role (in order), write a short personal note. ` +
        `Reply ONLY a JSON array of objects {"why":"1 warm sentence on why it genuinely fits THEM","stretch":"1 honest sentence on what they'd grow into","actions":["3 short, concrete prep actions"]}. Be specific to their skills and the role; no clichés ("passionate","leverage").`,
      user: top.map(({ job, m }, i) => `#${i + 1} ${job.title} (${job.listing_type}), fit ${m.score}%. Matches their skills: ${m.matched_skills.join(', ') || '—'}. Role wants: ${job.tags.join(', ') || '—'}.`).join('\n'),
    })
    notes = parseJsonArray(ai)
  }
  const recs = top.map(({ job, m }, i) => {
    const t = tmplNarrative(job, m)
    const n = notes?.[i]
    return {
      job: { id: job.id, title: job.title, location: job.location, company_id: job.company_id, listing_type: job.listing_type },
      score: m.score,
      why: typeof n?.why === 'string' && n.why.trim() ? n.why : t.why,
      stretch: typeof n?.stretch === 'string' && n.stretch.trim() ? n.stretch : t.stretch,
      actions: Array.isArray(n?.actions) && n.actions.length ? n.actions.slice(0, 3) : t.actions,
    }
  })
  res.json({
    intro: recs.length
      ? `Thanks for sharing all that${name ? `, ${name}` : ''} — based on our conversation, here are my top ${recs.length} directions for you, ranked by how well they fit${signals.length ? ` and weighted toward what matters to you (${signals.join(', ')})` : ''}.`
      : `I couldn't find strong matches just yet${name ? `, ${name}` : ''} — try adding a few more skills or broadening your profile, and I'll take another look.`,
    signals,
    recs,
  })
})

ai.post('/compass/prep', async (req, res) => {
  const job = await loadJob(req.body?.job_id)
  const row = await studentRow(req.user!.id)
  if (!job || !row) return res.status(404).json({ error: 'not_found' })
  const rp = asResumeProfile(row.resume_profile)
  const student = toMatchStudent(row, rp)
  const matched = job.tags.filter((t) => (student.skills ?? []).some((s) => s.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(s.toLowerCase())))
  const missing = job.tags.filter((t) => !matched.includes(t))
  // Hardcoded fallback — used verbatim when Claude is unavailable / errors, and
  // merged under any partial Claude response so every field is always present.
  const fallback = {
    fit: `You're a solid candidate for ${job.title}${matched.length ? `: your strengths in ${matched.join(', ')} are directly relevant.` : '.'}`,
    gap: missing.length ? `The main gap is ${missing.slice(0, 2).join(' and ')} — address it head-on.` : 'No major gaps — focus on storytelling.',
    skills: (missing.length ? missing : job.tags).slice(0, 4).map((t) => `Brush up on ${t}`),
    talkingPoints: [`I've worked hands-on with ${(student.skills ?? [job.type]).slice(0, 2).join(' and ')}.`, `I'm drawn to this role because it combines ${job.tags.slice(0, 2).join(' and ')}.`, `As a ${student.major ?? 'student'}, I learn fast and take ownership.`],
    questions: [`What does success look like in the first 90 days of ${job.title}?`, 'How is feedback and mentorship structured here?', `What's the team's tooling for ${job.type}?`, 'What are the biggest challenges the team faces right now?'],
    actions: [`Do a 2-hour refresher on ${missing[0] ?? job.tags[0] ?? job.type}.`, 'Rewrite your top CV bullet to show impact.', 'Prepare 2 STAR stories about ownership.'],
  }

  // Real, candid prep grounded in this candidate's actual résumé when Claude is up.
  if (hasClaude()) {
    const evidence = rp
      ? `Parsed skills: ${(rp.skills ?? []).map((s) => s.name).join(', ') || '—'}. Projects: ${(rp.projects ?? []).map((p) => p.name).join(', ') || '—'}. Seniority: ${rp.seniority}.`
      : student.cv_text ?? 'No résumé on file.'
    const text = await claudeText({
      model: MODELS.coach,
      maxTokens: 1000,
      thinking: true,
      system:
        'You are an HONEST interview-prep coach for an early-career candidate. Reply with ONLY JSON: ' +
        '{"fit":"1-2 candid sentences on how well they actually fit","gap":"the real gap stated plainly","skills":["3-4 specific things to brush up"],"talkingPoints":["3 first-person points grounded in their REAL experience"],"questions":["4 sharp questions to ask the interviewer"],"actions":["3 concrete prep actions"]}. ' +
        'Be specific to THIS candidate and role; never invent qualifications they lack; no clichés ("passionate","leverage").',
      user: `STUDENT: ${student.major ?? '—'}, self-reported skills ${(student.skills ?? []).join(', ') || '—'}. ${evidence}\nJOB: ${job.title} (${job.type}) — ${job.description}\nRequired skills: ${job.tags.join(', ') || '—'}`,
    })
    const parsed = extractJson<typeof fallback>(text)
    if (parsed?.fit && Array.isArray(parsed.skills)) return res.json({ ...fallback, ...parsed })
    return res.status(503).json({ error: 'ai_unavailable' })
  }
  res.json(fallback) // no key: safety net
})

const RESEARCH_ASK_SYSTEM =
  `You are a warm, supportive career guide answering a student's question about a specific company/role, using current web results. ` +
  `Be friendly and genuinely helpful — like a mentor who has their back — but stay honest: don't sugar-coat, and if the truthful answer is unfavourable, say so kindly and suggest a constructive next step. Keep it to 2-4 sentences.`
const researchAskUser = (company: string, role: string | undefined, question: string) =>
  `Company: ${company}. Role: ${role ?? 'a role'}. Question: ${question}`

ai.post('/research/ask', async (req, res) => {
  const { company, role, question } = req.body ?? {}
  if (hasClaude()) {
    const text = await claudeTextWithSearch({
      model: MODELS.research,
      maxTokens: 600,
      system: RESEARCH_ASK_SYSTEM,
      user: researchAskUser(company, role, question),
    })
    if (text) return res.json({ answer: text })
    return res.status(503).json({ error: 'ai_unavailable' })
  }
  // No API key configured — hardcoded safety net only.
  res.json({ answer: `Here's what I found on "${question}" for ${role ?? 'this role'} at ${company}: it's a fast-moving environment where early-career talent gets real responsibility. Raise this exact question with the hiring manager and tie your follow-up to your own goals.` })
})

/* Streaming research answer — live web-grounded, rendered token-by-token. */
ai.post('/research/ask/stream', async (req, res) => {
  if (!hasClaude()) return res.status(503).json({ error: 'ai_unavailable' })
  const { company, role, question } = req.body ?? {}
  const stream = streamClaude({
    model: MODELS.research,
    maxTokens: 600,
    system: RESEARCH_ASK_SYSTEM,
    user: researchAskUser(company, role, question),
    tools: [{ type: 'web_search_20260209', name: 'web_search' }],
  })
  if (!stream) return res.status(503).json({ error: 'ai_unavailable' })
  res.sse(stream)
})

/* ---------- AI Sourcing (describe → find) ---------- */
// Natural-language job search ("remote Python internship in Kenya"). A QUERY-driven
// funnel: embed the query → ANN-retrieve the closest jobs (hard filters in SQL) →
// Voyage-rerank by the query → Claude-score a bounded set for the honest fit %.
// Never scans/scores the whole catalog. Falls back to a keyword-bounded scan when
// embeddings are off, so it stays bounded regardless.
const SOURCE_RERANK_K = 24 // candidates that reach the LLM score
const SOURCE_SHOW = 8
ai.post('/source', async (req, res) => {
  const query: string = (req.body?.query ?? '').trim()
  const qLower = query.toLowerCase()
  const uid = req.user!.id
  const viewer = await studentRow(uid)
  const rp = await ensureResumeProfile(viewer)
  const cm = await cacheMap(uid)

  // Parse the query into hard filters (these also become the "why" chips).
  const wantRemote = /\bremote\b|anywhere/.test(qLower)
  let wantType: string | null = null
  if (/intern/.test(qLower)) wantType = 'Internship'
  else if (/full[- ]?time|new grad|permanent/.test(qLower)) wantType = 'Full-time'
  else if (/fellow/.test(qLower)) wantType = 'Fellowship'

  // Stage 1 — retrieve a bounded candidate set. Query-driven via embeddings when
  // available; otherwise a filtered scan.
  const qVec = query ? await embedOne(query, 'query') : null
  let rows: any[]
  const ann = qVec ? await retrieveJobsByVector(qVec, wantType ? [wantType] : [], [], wantRemote, 200) : null
  if (ann) {
    const ids = ann.map((a) => a.job_id)
    rows = ids.length ? (must(await sb.from('job_listings').select('*').in('id', ids)) as any[]) : []
  } else {
    rows = must(await sb.from('job_listings').select('*').eq('status', 'active')) as any[]
  }

  // Visibility gates (same as /jobs — never source a restricted listing).
  const srcGates = await schoolGates(rows.map((r) => r.company_id))
  rows = rows.filter((r) => jobVisibleTo(r, viewer, srcGates))
  const countries = Array.from(new Set(rows.map((r) => r.country)))
  const wantCountry = countries.find((c) => c !== 'Remote' && qLower.includes(c.toLowerCase())) ?? null

  // Stage 2 — narrow to the LLM set. Voyage rerank by the query when we can;
  // otherwise a cheap keyword overlap, so the scored set is always bounded.
  if (rows.length > SOURCE_RERANK_K) {
    const docs = rows.map((r) => jobEmbedText({ title: r.title, type: r.type, listing_type: r.listing_type, tags: j.parse(r.tags, []), description: r.description }))
    const order = query ? await rerank(query, docs, SOURCE_RERANK_K) : null
    if (order) {
      rows = order.map((i) => rows[i])
    } else if (query) {
      const terms = qLower.split(/\W+/).filter((t) => t.length > 2)
      const kw = (r: any) => { const hay = `${r.title} ${j.parse<string[]>(r.tags, []).join(' ')} ${r.description ?? ''}`.toLowerCase(); return terms.filter((t) => hay.includes(t)).length }
      rows = [...rows].sort((a, b) => kw(b) - kw(a)).slice(0, SOURCE_RERANK_K)
    } else {
      rows = rows.slice(0, SOURCE_RERANK_K)
    }
  }

  // Stage 3 — honest Claude score + relevance chips. The shown fit % is the real
  // match score; the query constraints only RANK and surface "why".
  const scoredAll = await Promise.all(rows.map(async (r) => {
    const why: string[] = []
    const m = await getMatch(uid, rowToMatchJob(r), {}, { row: viewer, rp, cached: cm.get(r.id) ?? null })
    if (!m) return null
    let relevance = m.score
    let fail = false
    if (wantRemote) { if (r.remote === 1) { relevance += 18; why.push('Remote ✓') } else fail = true }
    if (wantType) { if (r.listing_type === wantType) { relevance += 16; why.push(`${wantType} ✓`) } else fail = true }
    if (wantCountry) { if (r.country === wantCountry) { relevance += 16; why.push(`${wantCountry} ✓`) } else fail = true }
    if (m.matched_skills.length) { relevance += m.matched_skills.length * 4; why.push(`Uses your ${m.matched_skills.slice(0, 2).join(' & ')}`) }
    return { job: rowJobLite(r), why, score: m.score, relevance, fail }
  }))
  const scored = scoredAll.filter((r): r is NonNullable<typeof r> => !!r && !r.fail).sort((a, b) => b.relevance - a.relevance).slice(0, SOURCE_SHOW)

  res.json({ summary: scored.length ? `I found ${scored.length} matching opportunities for you, ranked by fit.` : 'No strong matches — try relaxing a constraint.', results: scored })
})

/* ---------- fallbacks ---------- */
function rowJobLite(r: any) {
  return { id: r.id, title: r.title, location: r.location, listing_type: r.listing_type, pay: r.pay, company_id: r.company_id, apply_url: r.apply_url, original_company_name: r.original_company_name, original_company_logo_url: r.original_company_logo_url, country: r.country, remote: r.remote === 1, tags: j.parse(r.tags, []) }
}
function parseList(text: string | null): string[] {
  if (!text) return []
  return text.split('\n').map((l) => l.replace(/^[-*\d.\s]+/, '').trim()).filter((l) => l.length > 4).slice(0, 6)
}
/** Parse a JSON array from a model reply, tolerating ```json fences / prose. */
function parseJsonArray<T = any>(text: string | null): T[] | null {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = (fenced ? fenced[1] : text).trim()
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start === -1 || end === -1) return null
  try {
    const p = JSON.parse(body.slice(start, end + 1))
    return Array.isArray(p) ? p : null
  } catch {
    return null
  }
}
function canChat(_m: string) {
  return "Here's how I'd approach that:\n\n1. **Sharpen your résumé** around measurable outcomes.\n2. **Target roles** that match your top skills.\n3. **Prepare stories** using the STAR format.\n\nWant me to draft a 30-day prep plan?"
}
function canCoach(student: MatchStudent, job: MatchJob) {
  const skills = (student.skills ?? []).slice(0, 3).join(', ')
  return {
    draft: `As a ${student.major ?? 'student'}, I'm excited to apply for ${job.title}. My hands-on work with ${skills} maps to what you're building, and I bring real ownership.`,
    critique: { strengths: ['Concrete skills named', 'Clear motivation'], weaknesses: ['Opening is slightly generic'], missing: ['A metric from a project'], verdict: 'refine' },
    final: `I'm a ${student.major ?? 'student'} who ships. ${job.title} pairs ${job.tags.slice(0, 2).join(' and ')} with real ownership — my favourite combination. I recently shipped a production feature used by thousands, working across ${skills}. I'd love to bring that energy to your team.`,
  }
}

ai.get('/_status', (_req, res) => res.json({ claude: hasClaude() }))
