// Shared engine for the /ai routes: the match funnel, scoring, résumé-aware
// prompts, parsing/fallback helpers. Route handlers live in the sibling modules
// (matches.ts, insights.ts, research.ts, chat.ts, compass.ts, source.ts) and
// import what they need from here, so ai.ts stays a thin router.
import { sb, must, j } from '@/db'
import { cacheGet, cacheSet } from '@/lib/cache'
import { now } from '@/lib/util'
import { claudeText, claudeJson, claudeTextWithSearch, streamClaude, extractJson, hasClaude, MODELS } from '@/lib/claude'
import { type MatchJob, type MatchStudent, type AiMatch } from '@/lib/matching'
import type { ResumeProfile } from '@/lib/resume'
import { ensureResumeProfile, ensureCvText, asResumeProfile, retrieveCandidateJobs, retrieveJobsByVector } from '@/lib/enrich'
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
export function matchReadiness(viewer: any): MatchReadiness {
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
export async function candidateJobs(viewer: any, rp: ResumeProfile | null): Promise<any[]> {
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

/* ---------- loaders ---------- */
export async function studentRow(id: string): Promise<any | null> {
  const r = must(await sb.from('profiles').select('*').eq('id', id).maybeSingle()) as any
  if (!r) return null
  // The matcher reads r.resume_profile (parsed from the CV). A résumé can live in two
  // places: the legacy profile column (set during onboarding) or the resume_profiles
  // table (the Résumés tab). If the column is empty, pull the active resume_profiles
  // entry in so the readiness gate doesn't falsely report "no résumé".
  if (!r.resume_profile) {
    const { data: rp } = (await sb.from('resume_profiles').select('*').eq('student_id', id).eq('active', true).maybeSingle()) as any
    if (rp) r.resume_profile = asResumeProfile(rp)
  }
  // Last resort: extract text from an uploaded CV file so cv_text is populated and the
  // gate recognises a résumé that was uploaded but not yet parsed.
  if (!r.resume_profile && !r.cv_text?.trim() && r.cv_url) {
    await ensureCvText(r)
  }
  return r
}
export function toMatchStudent(r: any, rp: ResumeProfile | null): MatchStudent {
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
export const firstNameOf = (full?: string | null): string => (full ?? '').trim().split(/\s+/)[0] || ''

/** A warm, personalised, CV-AWARE system prompt for the career chat. The
 *  assistant addresses the student by name and reasons from their actual résumé
 *  so its advice is concrete rather than generic. */
export function chatSystem(row: any, rp: ResumeProfile | null, matchInfo = ''): string {
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
export async function matchContext(uid: string): Promise<string> {
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
export async function getMatch(studentId: string, job: MatchJob, opts: MatchOpts = {}, ctx: MatchCtx = {}): Promise<AiMatch | null> {
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
export async function visibleJobs(viewer: any): Promise<any[]> {
  const rows = must(await sb.from('job_listings').select('*').eq('status', 'active')) as any[]
  const gates = await schoolGates(rows.map((r) => r.company_id))
  return rows.filter((r) => jobVisibleTo(r, viewer, gates))
}

/** Build a MatchJob from an already-loaded job row (avoids a per-job re-query). */
export function rowToMatchJob(r: any): MatchJob & { company_id: string; description: string; location: string } {
  return { id: r.id, title: r.title, description: r.description, type: r.type, listing_type: r.listing_type, tags: j.parse(r.tags, []), country: r.country, remote: r.remote === 1, pay: r.pay, company_id: r.company_id, location: r.location, duration: r.duration, responsibilities: j.parse(r.responsibilities, []), qualifications: j.parse(r.qualifications, []), benefits: j.parse(r.benefits, []) }
}

/** All cached match rows for a student in ONE query → job_id -> {payload,stale}. */
export async function cacheMap(studentId: string): Promise<Map<string, any>> {
  const rows = (must(await sb.from('ai_match_cache').select('job_id, payload, stale, resume_id').eq('student_id', studentId)) as any[]) ?? []
  return new Map(rows.map((r) => [r.job_id, r]))
}

/** Turn what the outcome-tracking worker learned (migration 0014) into concrete,
 *  honest nudges for the student. Only emits a nudge when there's something real to
 *  say — a confirmed hire, detected progress, or a worker-recommended next step — so
 *  we never invent noise. Empty until the worker writes signals / the migration runs. */
export async function outcomeNudges(uid: string): Promise<{ title: string; message: string; status: string }[]> {
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

// ---- Company / research prompts + helpers ----
const COMPANY_STREAM_SYSTEM =
  'You are a warm, encouraging career guide researching a company for an early-career African/global student, grounded in CURRENT web results. ' +
  'Write in friendly, supportive Markdown — like a mentor who did the homework for them. Be specific and cite what you actually found, but stay honest and balanced: surface REAL risks (layoffs, funding trouble, poor reviews, visa limits) when the evidence shows them, framed constructively. Do not write a brochure; do not sugar-coat.\n\n' +
  'Use EXACTLY these section headings, in this order, each 2–4 sentences:\n' +
  '## What they do\n## What it’s like to work there\n## Why it could be a fit for you\n## Honest red flags\n## Smart questions to ask\n(then 3 short bullet questions)\n## Bottom line\n(one or two honest, encouraging sentences)\n\n' +
  'Search the web first, then write.'

const RESEARCH_ASK_SYSTEM =
  `You are a warm, supportive career guide answering a student's question about a specific company/role, using current web results. ` +
  `Be friendly and genuinely helpful — like a mentor who has their back — but stay honest: don't sugar-coat, and if the truthful answer is unfavourable, say so kindly and suggest a constructive next step. Keep it to 2-4 sentences.`
const researchAskUser = (company: string, role: string | undefined, question: string) =>
  `Company: ${company}. Role: ${role ?? 'a role'}. Question: ${question}`

// ---- Career Compass ----
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

/** Label what the student told us they care about (shown as chips). Purely
 *  descriptive now — there's no deterministic engine to re-weight. */
export function deriveSignals(answers: string[]): string[] {
  const t = answers.join(' \n ').toLowerCase()
  const signals: string[] = []
  if (/remote|anywhere|relocat|\blocation\b|visa|from home|hybrid|on[- ]?site/.test(t)) signals.push('work-style / location')
  if (/learn|grow|develop|build my|improve|master|upskill|new skill/.test(t)) signals.push('skill growth')
  if (/impact|mission|purpose|social|climate|health|education|community|sustainab|africa/.test(t)) signals.push('mission / impact')
  if (/startup|small team|fast[- ]?paced|ownership|autonomy/.test(t)) signals.push('startup ownership')
  if (/pay|salary|money|compensation|stipend|well[- ]?paid/.test(t)) signals.push('compensation')
  return signals
}

const SOURCE_RERANK_K = 24 // candidates that reach the LLM score
const SOURCE_SHOW = 8

/** Build a lightweight job object (no scoring) for sourcing results. */
export function rowJobLite(r: any) {
  return { id: r.id, title: r.title, location: r.location, listing_type: r.listing_type, pay: r.pay, company_id: r.company_id, apply_url: r.apply_url, original_company_name: r.original_company_name, original_company_logo_url: r.original_company_logo_url, country: r.country, remote: r.remote === 1, tags: j.parse(r.tags, []) }
}
export function parseList(text: string | null): string[] {
  if (!text) return []
  return text.split('\n').map((l) => l.replace(/^[-*\d.\s]+/, '').trim()).filter((l) => l.length > 4).slice(0, 6)
}
/** Parse a JSON array from a model reply, tolerating ```json fences / prose. */
export function parseJsonArray<T = any>(text: string | null): T[] | null {
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

// Re-export the bits feature routers need from the lib layer so they import
// everything AI from one place.
export { ensureResumeProfile, asResumeProfile, retrieveCandidateJobs, loadJob, companyName, loadStudent, claudeText, claudeTextWithSearch, streamClaude, extractJson, hasClaude, MODELS, COMPANY_STREAM_SYSTEM, RESEARCH_ASK_SYSTEM, researchAskUser, COMPASS_Q, interviewSystem, SOURCE_RERANK_K, SOURCE_SHOW, canChat, canCoach }
