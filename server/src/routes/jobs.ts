import { Router } from '@/lib/http'
import { sb, must, j } from '@/db'
import { requireAuth } from '@/lib/auth'
import { isAdminEmail } from '@/lib/admin'
import { rowToJob } from '@/lib/serialize'
import { uid, now, notify } from '@/lib/util'
import { embedJob } from '@/lib/enrich'
import { jobVisibleTo, schoolGates } from '@/lib/visibility'
import { cacheGet, cacheSet, cacheDeletePrefix } from '@/lib/cache'
import { mistralJsonBlocks, hasMistral, mistralText } from '@/lib/mistral'
import { getMatch, rowToMatchJob } from './ai/helpers'
import { claudeText, hasClaude } from '@/lib/claude'

export const jobs = Router()
jobs.use(requireAuth)

// Lean column set for list views — full descriptions/arrays are only needed on
// the single-job detail route. Trimming them keeps the 100+ row list payload
// small (faster transfer + parse) while cards still have everything they show.
const LIST_COLUMNS =
  'id,company_id,title,description,type,listing_type,location,country,remote,pay,currency,duration,deadline,tags,status,apply_url,allowed_years,allowed_schools,students_only,posted_by_role,original_company_name,original_company_logo_url,assignment,created_at'

// The responsibilities/benefits/qualifications columns are optional (added by a
// later migration). Detect their presence so create/update still work before the
// migration is run — and pick them up automatically once it is.
let hasContentCols = false
async function contentColsExist(): Promise<boolean> {
  if (hasContentCols) return true
  const { error } = await sb.from('job_listings').select('responsibilities').limit(1)
  hasContentCols = !error
  return hasContentCols
}

// students_only (migration 0011) may not exist yet; detect once so create/update
// don't fail on a stale schema.
let hasStudentsOnly = false
async function studentsOnlyColExists(): Promise<boolean> {
  if (hasStudentsOnly) return true
  const { error } = await sb.from('job_listings').select('students_only').limit(1)
  hasStudentsOnly = !error
  return hasStudentsOnly
}

// job_opens (migration 0012) records unique people who clicked through to an
// external listing's apply link. Detect the table so the feature degrades
// gracefully before the migration is applied.
let hasJobOpens = false
async function jobOpensExist(): Promise<boolean> {
  if (hasJobOpens) return true
  const { error } = await sb.from('job_opens').select('job_id').limit(1)
  hasJobOpens = !error
  return hasJobOpens
}

// match_outcomes (migration 0014) — the outcome-tracking loop. Detect once so the
// intent write degrades gracefully before the migration is applied.
let hasOutcomes = false
async function outcomesExist(): Promise<boolean> {
  if (hasOutcomes) return true
  const { error } = await sb.from('match_outcomes').select('student_id').limit(1)
  hasOutcomes = !error
  return hasOutcomes
}

const OUTCOME_CHECK_DAYS = 14

/** Record an intent-to-apply for outcome tracking: snapshot the score we gave and
 *  schedule the first background check ~14 days out. Idempotent per (student, job)
 *  so repeat clicks don't reset the monitoring clock. Best-effort & fast. */
async function recordIntent(studentId: string, jobId: string): Promise<void> {
  if (!(await outcomesExist())) return
  let score: number | null = null
  try {
    const c = (await sb.from('ai_match_cache').select('payload').eq('student_id', studentId).eq('job_id', jobId).maybeSingle()).data as any
    if (c?.payload) score = JSON.parse(c.payload).score ?? null
  } catch { /* no cached score — leave null */ }
  const ts = now()
  const checkAt = new Date(Date.now() + OUTCOME_CHECK_DAYS * 86_400_000).toISOString()
  await sb.from('match_outcomes').upsert(
    {
      student_id: studentId, job_id: jobId, source: 'external_link', score_at_intent: score,
      first_intent_at: ts, status: 'monitoring', check_at: checkAt, check_count: 0, created_at: ts, updated_at: ts,
    },
    { onConflict: 'student_id,job_id', ignoreDuplicates: true }, // first intent wins; keep its clock
  )
}

// Opens-per-job for the authed company's own listings. The Listings/Analytics
// views show this instead of "applicants" for EXTERNAL roles, whose applications
// never reach Optryva. Declared before "/:id" so it isn't shadowed by it.
jobs.get('/opens/mine', async (req, res) => {
  const counts: Record<string, number> = {}
  if (!(await jobOpensExist())) return res.json(counts)
  const owned = must(await sb.from('job_listings').select('id').eq('company_id', req.user!.id)) as any[]
  const ids = owned.map((r) => r.id)
  if (ids.length === 0) return res.json(counts)
  const rows = must(await sb.from('job_opens').select('job_id').in('job_id', ids)) as any[]
  for (const r of rows) counts[r.job_id] = (counts[r.job_id] ?? 0) + 1
  res.json(counts)
})

// Record that the current user opened a listing's external apply link. Idempotent
// per (job, user) so the count reflects unique people, not repeat clicks.
jobs.post('/:id/open', async (req, res) => {
  if (!(await jobOpensExist())) return res.json({ ok: false })
  await sb
    .from('job_opens')
    .upsert(
      { job_id: req.params.id, user_id: req.user!.id, created_at: now() },
      { onConflict: 'job_id,user_id', ignoreDuplicates: true },
    )
  // Also open an outcome-tracking record (intent-to-apply). Don't block the
  // response on it — the click should feel instant.
  recordIntent(req.user!.id, req.params.id).catch(() => {})
  res.json({ ok: true })
})

jobs.get('/', async (req, res) => {
  const viewer = must(await sb.from('profiles').select('*').eq('id', req.user!.id).maybeSingle()) as any
  // Optional `ids` lets callers fetch only the jobs they reference (e.g. the
  // Applications page only needs the listings its applications point to,
  // instead of the entire directory). Scope both the query and the cache key.
  const idsRaw = req.query.ids as string | undefined
  const ids = idsRaw ? idsRaw.split(',').filter(Boolean) : null
  const scopeKey = ids ? `ids:${ids.join(',')}` : 'active'
  // The dashboard, nav badges, and the Jobs page all hit this; the full active
  // set changes rarely, so cache the visibility-filtered result per viewer.
  const cacheKey = `jobs:${scopeKey}:${req.user!.id}`
  const cached = cacheGet<any[]>(cacheKey)
  if (cached) return res.json(cached)
  let q = sb.from('job_listings').select(LIST_COLUMNS).eq('status', 'active')
  if (ids) q = q.in('id', ids)
  const rows = must(await q.order('created_at', { ascending: false })) as any[]
  const gates = await schoolGates(rows.map((r) => r.company_id))
  const visible = rows.filter((r) => jobVisibleTo(r, viewer, gates))
  // Attach the posting entity's display name + avatar once (single batched
  // query) so clients never have to scan the whole directory to label a job.
  const companyIds = [...new Set(visible.map((r) => r.company_id))]
  if (companyIds.length) {
    const comps = must(
      await sb.from('profiles').select('id,company_name,avatar_url,full_name').in('id', companyIds),
    ) as any[]
    const cmap = new Map(comps.map((c) => [c.id, c]))
    for (const r of visible) {
      const c = cmap.get(r.company_id)
      r.company_name = c ? c.company_name ?? c.full_name ?? undefined : undefined
      r.company_avatar_url = c?.avatar_url ?? undefined
    }
  }
  const payload = visible.map(rowToJob)
  cacheSet(cacheKey, payload, 20_000)
  res.json(payload)
})

jobs.get('/company/:companyId', async (req, res) => {
  const rows = must(await sb.from('job_listings').select(LIST_COLUMNS).eq('company_id', req.params.companyId).order('created_at', { ascending: false })) as any[]
  // The owner manages all of its listings (incl. drafts/closed); everyone else
  // only sees what the domain/privacy/year/school gates allow.
  if (req.user!.id === req.params.companyId) return res.json(rows.map(rowToJob))
  const viewer = must(await sb.from('profiles').select('*').eq('id', req.user!.id).maybeSingle()) as any
  const gates = await schoolGates([req.params.companyId])
  res.json(rows.filter((r) => jobVisibleTo(r, viewer, gates)).map(rowToJob))
})

// ---------------------------------------------------------------------------
// Employer Smart Shortlist (Optryva AI Smart, Phase 5).
// Surfaces the candidates for a posted job = applicants UNION students already
// matched to it. An applicant who never browsed the role (no cached score) is
// STILL shown — we score them on the fly via getMatch. Each candidate is enriched
// with profile + applied status, and Mistral produces an employer-facing decision
// aid (fit verdict + decision note) so the employer can decide who to interview.
// Degrades gracefully: with no Mistral key we return the (still explainable)
// match scores/reasons; with no scorer at all the applicant is still listed.
// ---------------------------------------------------------------------------
const SHORTLIST_STATUS = ['pending', 'reviewed', 'shortlisted', 'hired', 'rejected']
const SHORTLIST_VERSION = 1

// Build the full Smart Shortlist payload for a job.
// - `force` re-scores EVERY applicant (employer "Rescore"); otherwise getMatch
//   reuses each applicant's cached score, so only NEW applicants (no cache entry)
//   are scored on the fly and written to ai_match_cache — never re-scoring the rest.
async function buildShortlist(job: any, force: boolean): Promise<any> {
  const jobId = job.id
  const jobMatch = rowToMatchJob(job)

  // Pool = applicants to this job ONLY. Matched-but-not-applied browsers are
  // excluded so the shortlist count always matches the "Applicants" count and the
  // screen never shows a candidate the employer hasn't actually received.
  const appRows = (must(await sb.from('applications').select('*').eq('job_id', jobId).in('status', SHORTLIST_STATUS)) as any[]) ?? []
  const appByStudent = new Map(appRows.map((a) => [a.student_id, a]))
  const studentIds = appRows.map((a) => a.student_id)

  if (!studentIds.length) {
    return { job_id: jobId, mistral: hasMistral(), summary: null, candidates: [], scored: 0, total: 0, note: 'No applicants for this role yet.' }
  }

  // Resolve a match for every candidate. With force=false, getMatch returns the
  // cached score when one exists (fresh + current engine), so only applicants
  // without a cached match are scored now — and that new score is cached. With
  // force=true, getMatch ignores the cache and re-scores everyone.
  const opts = force ? { cache: false as const } : { cache: true as const }
  const resolved = await Promise.all(
    studentIds.map(async (sid) => {
      let m: any = null
      try { m = await getMatch(sid, jobMatch, opts) } catch { m = null }
      // Even if scoring is fully unavailable, still surface the candidate — but
      // flag it so the UI never shows a fabricated fit number as if it were real.
      const scoreUnavailable = !m
      if (!m) m = { score: 0, matched_skills: [], reasons: [], mismatch_flags: [], breakdown: null }
      // Backfill the application's match_score so the review page shows the real
      // fit (fixes "student match is empty" when the applied job was outside the
      // student's top-40 and no match was snapshotted at apply time).
      if (m && !scoreUnavailable) {
        const app = appByStudent.get(sid)
        if (app && app.match_score == null) {
          const reasons: string[] = Array.isArray(m.reasons) ? m.reasons : []
          const rationale = reasons.length ? reasons.join(' ') : null
          try { await sb.from('applications').update({ match_score: m.score ?? null, match_rationale: rationale }).eq('id', app.id) } catch { /* best-effort */ }
        }
      }
      return { student_id: sid, m, scoreUnavailable }
    }),
  )
  const parsed = (resolved.filter(Boolean) as any[]).sort((a: any, b: any) => (b.m.score ?? 0) - (a.m.score ?? 0))

  const profRows = (must(await sb.from('profiles').select('id, full_name, avatar_url, major, location, skills').in('id', studentIds)) as any[]) ?? []
  const profById = new Map(profRows.map((p) => [p.id, p]))
  // The candidate's CURRENT active résumé, to detect post-apply edits.
  const curRows = (must(await sb.from('resume_profiles').select('id, student_id').eq('active', 1).in('student_id', studentIds)) as any[]) ?? []
  const curResumeByStudent = new Map(curRows.map((r) => [r.student_id, r.id]))

  const candidates = parsed.map((x: any) => {
    const p = profById.get(x.student_id) ?? {}
    const app = appByStudent.get(x.student_id)
    const matchedResumeId = app?.resume_id ?? null
    const curResumeId = curResumeByStudent.get(x.student_id) ?? null
    const snapshot: any = app?.resume_snapshot ? j.parse(app.resume_snapshot, null) : null
    return {
      student_id: x.student_id,
      resume_id: matchedResumeId,
      name: p.full_name ?? 'Candidate',
      avatar_url: p.avatar_url ?? null,
      major: p.major ?? null,
      location: p.location ?? null,
      skills: j.parse(p.skills, []),
      applied: !!app,
      application_id: app?.id ?? null,
      application_status: app?.status ?? null,
      score: x.m.score ?? 0,
      score_unavailable: x.scoreUnavailable ?? false,
      matched_skills: x.m.matched_skills ?? [],
      reasons: x.m.reasons ?? [],
      mismatch_flags: x.m.mismatch_flags ?? [],
      breakdown: x.m.breakdown ?? null,
      assessment_status: app?.assignment_status ?? null,
      assessment_score: app?.assignment_score ?? null,
      assessment_feedback: app?.assignment_ai_feedback ? j.parse(app.assignment_ai_feedback, null) : null,
      matched_resume_id: matchedResumeId,
      matched_resume_name: snapshot?.name ?? null,
      current_resume_id: curResumeId,
      resume_changed: !!app && !!matchedResumeId && !!curResumeId && matchedResumeId !== curResumeId,
    }
  })

  // Mistral employer-facing decision aid (graceful: skipped if no key / fails).
  let summary: string | null = null
  const aid = await mistralShortlistAid(job, candidates)
  if (aid) {
    summary = aid.summary ?? null
    const byId = new Map((aid.candidates ?? []).map((c: any) => [c.student_id, c]))
    for (const c of candidates as any[]) {
      const e = byId.get(c.student_id)
      if (e) {
        c.fit_score = typeof e.fit_score === 'number' ? e.fit_score : c.score
        c.verdict = e.verdict ?? null
        c.category = e.category ?? null
        c.decision_note = e.decision_note ?? null
        c.fit_strengths = e.strengths ?? []
        c.fit_gaps = e.gaps ?? []
      }
    }
    candidates.sort((a: any, b: any) => (b.fit_score ?? b.score) - (a.fit_score ?? a.score))
  }
  // A "fit_score" produced by Mistral for a candidate with NO real match score is
  // an unsupported guess (no evidence to rank on), so never present it as a number
  // or let it outrank genuinely-scored candidates. Keep only the qualitative note.
  for (const c of candidates as any[]) if (c.score_unavailable) c.fit_score = null

  const scored = candidates.filter((c: any) => !c.score_unavailable).length
  return { job_id: jobId, mistral: hasMistral(), summary, candidates, scored, total: candidates.length, note: null }
}

jobs.get('/:jobId/shortlist', async (req, res) => {
  const jobId = req.params.jobId
  const job = must(await sb.from('job_listings').select('*').eq('id', jobId).maybeSingle()) as any
  if (!job) return res.status(404).json({ error: 'not_found' })
  if (job.company_id !== req.user!.id && !isAdminEmail(req.user!.email)) return res.status(403).json({ error: 'forbidden' })

  const force = req.query.rescore === '1' || req.query.rescore === 'true'
  const cached = !force ? ((await sb.from('shortlist_cache').select('*').eq('job_id', jobId).maybeSingle()).data as any) : null

  let needsCompute = !cached
  if (cached && !needsCompute) {
    // Invalidate only when a NEW application arrived since the last compute, or the
    // engine version changed — otherwise serve the cached shortlist untouched. We do
    // NOT re-score on every open (and do not self-heal incomplete results here): a
    // cached shortlist is reused as-is until a new applicant lands or the employer
    // explicitly hits Rescore.
    const newest = (await sb.from('applications').select('created_at').eq('job_id', jobId).in('status', SHORTLIST_STATUS).order('created_at', { ascending: false }).limit(1)).data?.[0]
    if (newest && new Date(newest.created_at) > new Date(cached.computed_at)) needsCompute = true
    else if (cached.engine_version !== SHORTLIST_VERSION) needsCompute = true
  }

  if (!needsCompute && cached) {
    const stored = JSON.parse(cached.payload)
    return res.json({ ...stored, cached: true, computed_at: cached.computed_at })
  }

  const result = await buildShortlist(job, force)
  const payload = { job_id: result.job_id, mistral: result.mistral, summary: result.summary, candidates: result.candidates, scored: result.scored, total: result.total, note: result.note }
  const computedAt = new Date().toISOString()
  try {
    await sb.from('shortlist_cache').upsert({
      job_id: jobId,
      payload: JSON.stringify(payload),
      total: result.total,
      scored: result.scored,
      engine_version: SHORTLIST_VERSION,
      mistral: result.mistral,
      computed_at: computedAt,
    })
  } catch { /* best-effort cache write */ }
  return res.json({ ...payload, cached: false, computed_at: computedAt })
})

// Employer-initiated full re-score: re-runs getMatch for every applicant (ignoring
// the match cache) and refreshes the shortlist cache.
jobs.post('/:jobId/shortlist/rescore', async (req, res) => {
  const jobId = req.params.jobId
  const job = must(await sb.from('job_listings').select('*').eq('id', jobId).maybeSingle()) as any
  if (!job) return res.status(404).json({ error: 'not_found' })
  if (job.company_id !== req.user!.id && !isAdminEmail(req.user!.email)) return res.status(403).json({ error: 'forbidden' })

  const result = await buildShortlist(job, true)
  const payload = { job_id: result.job_id, mistral: result.mistral, summary: result.summary, candidates: result.candidates, scored: result.scored, total: result.total, note: result.note }
  const computedAt = new Date().toISOString()
  try {
    await sb.from('shortlist_cache').upsert({
      job_id: jobId,
      payload: JSON.stringify(payload),
      total: result.total,
      scored: result.scored,
      engine_version: SHORTLIST_VERSION,
      mistral: result.mistral,
      computed_at: computedAt,
    })
  } catch { /* best-effort cache write */ }
  return res.json({ ...payload, cached: false, computed_at: computedAt, rescored: true })
})

// Employer AI research: ask a free-form question about ONE candidate (candidateId)
// or the whole applicant PIPELINE for a job. Grounded ONLY in stored candidate data
// (profile, match, assessment, shortlist verdict) — never invents candidates.
jobs.post('/:jobId/research', async (req, res) => {
  const jobId = req.params.jobId
  const { question, candidateId } = req.body ?? {}
  const job = must(await sb.from('job_listings').select('*').eq('id', jobId).maybeSingle()) as any
  if (!job) return res.status(404).json({ error: 'not_found' })
  if (job.company_id !== req.user!.id && !isAdminEmail(req.user!.email)) return res.status(403).json({ error: 'forbidden' })
  if (!question || typeof question !== 'string' || !question.trim()) return res.status(400).json({ error: 'missing_question' })
  if (!hasMistral() && !hasClaude()) return res.status(501).json({ error: 'ai_unavailable' })

  const appRows = (must(await sb.from('applications').select('*').eq('job_id', jobId).in('status', SHORTLIST_STATUS)) as any[]) ?? []
  const studentIds = candidateId ? [candidateId] : Array.from(new Set(appRows.map((a) => a.student_id)))
  const profRows = (must(await sb.from('profiles').select('id, full_name, major, location, skills, bio, school, year').in('id', studentIds)) as any[]) ?? []
  const profById = new Map(profRows.map((p) => [p.id, p]))

  // Pull shortlist verdicts from the cache (best-effort) so the answer can reference
  // the existing Smart Shortlist read without re-scoring.
  const slVerdicts: Record<string, any> = {}
  try {
    const cached = (await sb.from('shortlist_cache').select('payload').eq('job_id', jobId).maybeSingle()).data as any
    if (cached?.payload) {
      const parsed: any = typeof cached.payload === 'string' ? j.parse(cached.payload, { candidates: [] }) : cached.payload
      for (const c of parsed?.candidates ?? []) slVerdicts[c.student_id] = c
    }
  } catch { /* ignore */ }

  const buildCtx = (sid: string) => {
    const p = profById.get(sid) ?? {}
    const a = appRows.find((x) => x.student_id === sid)
    const sl = slVerdicts[sid]
    const snapshot: any = a?.resume_snapshot ? j.parse(a.resume_snapshot, null) : null
    return {
      name: p.full_name ?? 'Candidate',
      major: p.major ?? null,
      location: p.location ?? null,
      school: p.school ?? null,
      year: p.year ?? null,
      skills: j.parse(p.skills, []),
      bio: p.bio ?? null,
      application_status: a?.status ?? null,
      match_score: a?.match_score ?? null,
      assessment_status: a?.assignment_status ?? null,
      assessment_score: a?.assignment_score ?? null,
      decision_reason: a?.decision_reason ?? null,
      resume_summary: snapshot?.summary ?? null,
      resume_skills: snapshot?.skills ?? null,
      shortlist_verdict: sl?.verdict ?? null,
      shortlist_category: sl?.category ?? null,
      shortlist_fit: sl?.fit_score ?? null,
      shortlist_note: sl?.decision_note ?? null,
    }
  }

  const jobCtx =
    `ROLE: ${job.title} (${job.listing_type})\n` +
    `Tags: ${j.parse(job.tags, []).join(', ')}\n` +
    `Description: ${(job.description || '').slice(0, 1500)}\n` +
    `Qualifications: ${j.parse(job.qualifications, []).join('; ')}`

  let answer: string | null = null
  // Prefer Mistral for research (it already powers the shortlist aid); fall back to
  // Claude if Mistral is unavailable or returns nothing, so the chat never dead-ends
  // on a single provider being down. (Previously this was Claude-only, which failed
  // with ai_failed whenever the Claude key/call was unavailable.)
  async function askAI(system: string, user: string, maxTokens: number): Promise<string | null> {
    if (hasMistral()) {
      const a = await mistralText({ system, user, maxTokens })
      if (a) return a
    }
    if (hasClaude()) {
      try { return await claudeText({ system, user, maxTokens }) } catch { return null }
    }
    return null
  }
  if (candidateId) {
    const ctx = buildCtx(candidateId)
    const system =
      'You are a concise hiring analyst evaluating ONE candidate for a role. ' +
      'Use ONLY the candidate data provided — do not invent skills or experience. ' +
      'Reply in PLAIN TEXT as 3-5 short bullet points (one line each), no preamble: ' +
      '1) fit verdict, 2) key strengths (with evidence), 3) key gaps, 4) one suggested next step.'
    const user = `${jobCtx}\n\nCANDIDATE DATA:\n${JSON.stringify(ctx, null, 2)}\n\nEMPLOYER QUESTION: ${question}\n\nBe terse. Bullets only — no intro or closing sentence.`
    answer = await askAI(system, user, 500)
  } else {
    const list = studentIds
      .slice(0, 40)
      .map((sid) => {
        const c = buildCtx(sid)
        return `- ${c.name} | status ${c.application_status} | match ${c.match_score ?? 'n/a'} | assessment ${c.assessment_status}${c.assessment_score != null ? ` (${c.assessment_score})` : ''} | shortlist ${c.shortlist_verdict ?? 'n/a'}${c.shortlist_category ? ` (${c.shortlist_category})` : ''} | skills [${c.skills.join(', ')}]`
      })
      .join('\n')
    const system =
      'You are a concise hiring analyst for an EMPLOYER reviewing an applicant pipeline. ' +
      'Use ONLY the provided candidate summaries — never invent candidates. ' +
      'Reply in PLAIN TEXT as 3-6 short bullet points (one line each), no preamble: ' +
      '1) strongest candidate(s) and why, 2) biggest gap in the pipeline, ' +
      '3) who to prioritize or probe next, 4) one concrete sourcing recommendation.'
    const user = `${jobCtx}\n\nPIPELINE (${studentIds.length} applicants):\n${list}\n\nEMPLOYER QUESTION: ${question}\n\nBe terse. Bullets only — no intro or closing sentence.`
    answer = await askAI(system, user, 700)
  }

  if (!answer) {
    console.error('[research] ai_failed', { hasMistral: hasMistral(), hasClaude: hasClaude(), candidateId: !!candidateId })
    return res.status(502).json({ error: 'ai_failed' })
  }
  return res.json({ answer })
})

async function mistralShortlistAid(job: any, candidates: any[]): Promise<{ summary?: string; candidates?: any[] } | null> {
  if (!hasMistral()) return null
  const top = candidates.slice(0, 25)
  const system =
    'You are an impartial hiring decision assistant for an EMPLOYER reviewing a shortlist of students who applied to a role. ' +
    'For each candidate give an employer-focused FIT VERDICT and a concise, NEUTRAL, evidence-based DECISION NOTE that helps the employer decide. ' +
    'Use careful, non-punitive language: distinguish "not qualified on available evidence", "insufficient evidence", and "potential fit after assessment or training". ' +
    'Do NOT treat missing résumé evidence as proof the person lacks the skill, and do not label people harshly. ' +
    'ASSESSMENT STATUS is provided per candidate as one of: ' +
    'assessment=none (this role has NO test — do NOT invent or assume any test result; base the read on résumé/match only and say the assessment is not included), ' +
    'assessment=pending (a test is assigned but the candidate has NOT completed it — do NOT factor any test score; note it is pending and the read may change once submitted), ' +
    'assessment=submitted score=X (use score X as real evidence). ' +
    'Only ever use an assessment score when status is submitted; never infer one otherwise. Output STRICT JSON only.'
  const schema = {
    summary: 'string — 1-2 sentence overview of shortlist quality for this role',
    candidates: [
      {
        student_id: 'string (must match the provided id exactly)',
        fit_score: 'number 0-100 (your independent employer-facing fit estimate)',
        verdict: "one of 'strong' | 'possible' | 'weak'",
        category: "one of 'not_qualified' | 'insufficient_evidence' | 'potential_fit'",
        decision_note: 'string — 2-3 neutral sentences: what the evidence shows, the key gap or tradeoff, and the suggested next step (assessment / junior role / interview).',
        strengths: ['string'],
        gaps: ['string'],
      },
    ],
  }
  const assessmentDesc = (c: any) => {
    const s = c.assessment_status
    if (s === 'submitted') return `assessment=submitted score=${c.assessment_score ?? 'n/a'}`
    if (s === 'pending') return 'assessment=pending (assigned but NOT completed — do not factor a test score)'
    return 'assessment=none (no test required for this role — not included)'
  }
  const cands = top
    .map(
      (c, i) =>
        `${i + 1}. id=${c.student_id} name=${c.name} major=${c.major ?? ''} location=${c.location ?? ''} ` +
        `skills=[${c.skills.join(', ')}] baseScore=${c.score} matchedSkills=[${c.matched_skills.join(', ')}] ` +
        `reasons=[${c.reasons.join(' | ')}] gaps=[${c.mismatch_flags.join(', ')}] ${assessmentDesc(c)}`,
    )
    .join('\n')
  const content: any[] = [
    {
      type: 'text',
      text:
        `ROLE:\nTitle: ${job.title}\nType: ${job.listing_type}\nTags: ${j.parse(job.tags, []).join(', ')}\n` +
        `Description: ${(job.description || '').slice(0, 3000)}\n` +
        `Qualifications: ${j.parse(job.qualifications, []).join('; ')}\n\n` +
        `CANDIDATES (base score is 0-1 from the matching model):\n${cands}`,
    },
  ]
  return mistralJsonBlocks<{ summary?: string; candidates?: any[] }>({ system, content, schema, maxTokens: 2500, temperature: 0.2 })
}

jobs.get('/:id', async (req, res) => {
  const r = must(await sb.from('job_listings').select('*').eq('id', req.params.id).maybeSingle()) as any
  if (!r) return res.status(404).json({ error: 'not_found' })
  if (req.user!.id !== r.company_id) {
    const viewer = must(await sb.from('profiles').select('*').eq('id', req.user!.id).maybeSingle()) as any
    const gates = await schoolGates([r.company_id])
    if (!jobVisibleTo(r, viewer, gates)) return res.status(404).json({ error: 'not_found' })
  }
  // Attach the posting entity's display name + avatar (same as GET /jobs list
  // endpoint) so single-job fetches carry company_name/company_avatar_url
  // without the client needing a separate profiles query.
  if (r.company_id) {
    const c = (await sb.from('profiles').select('company_name,avatar_url,full_name').eq('id', r.company_id).maybeSingle()).data as any
    if (c) {
      r.company_name = c.company_name ?? c.full_name ?? undefined
      r.company_avatar_url = c.avatar_url ?? undefined
    }
  }
  res.json(rowToJob(r))
})

jobs.post('/', async (req, res) => {
  const viewer = must(await sb.from('profiles').select('*').eq('id', req.user!.id).maybeSingle()) as any
  if (viewer.user_type === 'student') return res.status(403).json({ error: 'forbidden' })
  const b = req.body ?? {}
  const id = uid('j')
  const ts = now()
  const row: Record<string, any> = {
    id,
    company_id: req.user!.id,
    title: b.title,
    description: b.description,
    type: b.type ?? 'Software Engineering',
    listing_type: b.listing_type ?? 'Internship',
    location: b.location ?? 'Remote (Global)',
    country: b.country ?? 'Remote',
    remote: b.remote ? 1 : 0,
    pay: b.pay ?? null,
    currency: b.currency ?? null,
    duration: b.duration ?? null,
    deadline: b.deadline ?? null,
    tags: j.stringify(b.tags ?? []),
    status: b.status ?? 'active',
    apply_url: b.apply_url ?? null,
    allowed_years: j.stringify(b.allowed_years ?? []),
    allowed_schools: j.stringify(b.allowed_schools ?? []),
    posted_by_role: viewer.user_type === 'school' ? 'school' : 'company',
    original_company_name: b.original_company_name ?? null,
    original_company_logo_url: b.original_company_logo_url ?? null,
    assignment: b.assignment ? j.stringify(b.assignment) : null,
    created_at: ts,
  }
  if (await contentColsExist()) {
    row.responsibilities = j.stringify(b.responsibilities ?? [])
    row.benefits = j.stringify(b.benefits ?? [])
    row.qualifications = j.stringify(b.qualifications ?? [])
  }
  // Only a school can restrict a listing to its student domains.
  if (await studentsOnlyColExists()) {
    row.students_only = viewer.user_type === 'school' && b.students_only ? 1 : 0
  }
  must(await sb.from('job_listings').insert(row))
  cacheDeletePrefix('jobs:active:')

  // Notify followers (in-app; email/push would fire here in §14.2)
  const followers = must(await sb.from('company_follows').select('student_id').eq('company_id', req.user!.id)) as any[]
  await Promise.all(followers.map((f) => notify(f.student_id, 'followed_company_listing', 'New role from a company you follow', `${b.title} — ${b.location ?? ''}`, id)))

  const job = must(await sb.from('job_listings').select('*').eq('id', id).maybeSingle())
  embedJob(job).catch(() => {}) // semantic index, best-effort
  res.json(rowToJob(job))
})

jobs.patch('/:id', async (req, res) => {
  const r = must(await sb.from('job_listings').select('*').eq('id', req.params.id).maybeSingle()) as any
  if (!r) return res.status(404).json({ error: 'not_found' })
  if (r.company_id !== req.user!.id) return res.status(403).json({ error: 'forbidden' })
  const b = req.body ?? {}
  const merged: Record<string, any> = {
    title: b.title ?? r.title,
    description: b.description ?? r.description,
    type: b.type ?? r.type,
    listing_type: b.listing_type ?? r.listing_type,
    location: b.location ?? r.location,
    country: b.country ?? r.country,
    remote: (b.remote ?? r.remote) ? 1 : 0,
    pay: b.pay ?? r.pay,
    currency: b.currency ?? r.currency,
    duration: b.duration ?? r.duration,
    deadline: b.deadline ?? r.deadline,
    tags: b.tags ? j.stringify(b.tags) : r.tags,
    status: b.status ?? r.status,
    apply_url: b.apply_url === undefined ? r.apply_url : b.apply_url,
    allowed_years: b.allowed_years ? j.stringify(b.allowed_years) : r.allowed_years,
    allowed_schools: b.allowed_schools ? j.stringify(b.allowed_schools) : r.allowed_schools,
    original_company_name: b.original_company_name === undefined ? r.original_company_name : b.original_company_name,
    original_company_logo_url: b.original_company_logo_url === undefined ? r.original_company_logo_url : b.original_company_logo_url,
    assignment: b.assignment === undefined ? r.assignment : b.assignment ? j.stringify(b.assignment) : null,
  }
  if (await contentColsExist()) {
    merged.responsibilities = b.responsibilities ? j.stringify(b.responsibilities) : r.responsibilities
    merged.benefits = b.benefits ? j.stringify(b.benefits) : r.benefits
    merged.qualifications = b.qualifications ? j.stringify(b.qualifications) : r.qualifications
  }
  // Schools-only restriction (only meaningful for school posters).
  if (await studentsOnlyColExists()) {
    merged.students_only =
      b.students_only === undefined
        ? (r.students_only ?? 0)
        : r.posted_by_role === 'school' && b.students_only
          ? 1
          : 0
  }
  must(await sb.from('job_listings').update(merged).eq('id', r.id))
  cacheDeletePrefix('jobs:active:')
  // Invalidate cached matches for this job (DB-trigger equivalent, spec §8.1)
  must(await sb.from('ai_match_cache').update({ stale: 1 }).eq('job_id', r.id))
  const job = must(await sb.from('job_listings').select('*').eq('id', r.id).maybeSingle())
  embedJob(job).catch(() => {}) // re-embed after content change, best-effort
  res.json(rowToJob(job))
})

jobs.delete('/:id', async (req, res) => {
  const r = must(await sb.from('job_listings').select('company_id').eq('id', req.params.id).maybeSingle()) as any
  if (!r) return res.status(404).json({ error: 'not_found' })
  if (r.company_id !== req.user!.id) return res.status(403).json({ error: 'forbidden' })
  must(await sb.from('job_listings').delete().eq('id', r.id))
  cacheDeletePrefix('jobs:active:')
  res.json({ ok: true })
})
