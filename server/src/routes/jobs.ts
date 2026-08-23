import { Router } from '@/lib/http'
import { sb, must, j } from '@/db'
import { requireAuth } from '@/lib/auth'
import { isAdminEmail } from '@/lib/admin'
import { rowToJob } from '@/lib/serialize'
import { uid, now, notify } from '@/lib/util'
import { embedJob } from '@/lib/enrich'
import { jobVisibleTo, schoolGates } from '@/lib/visibility'
import { cacheGet, cacheSet, cacheDeletePrefix } from '@/lib/cache'
import { mistralJsonBlocks, hasMistral } from '@/lib/mistral'
import { getMatch, rowToMatchJob } from './ai/helpers'

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
  // The dashboard, nav badges, and the Jobs page all hit this; the full active
  // set changes rarely, so cache the visibility-filtered result per viewer.
  const cacheKey = `jobs:active:${req.user!.id}`
  const cached = cacheGet<any[]>(cacheKey)
  if (cached) return res.json(cached)
  const rows = must(await sb.from('job_listings').select(LIST_COLUMNS).eq('status', 'active').order('created_at', { ascending: false })) as any[]
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
// Surfaces the students ALREADY matched to a posted job (from ai_match_cache),
// enriches each with profile + applied status, and asks Mistral to produce an
// employer-facing decision aid (fit verdict + decision note) so the employer can
// decide who to interview. Degrades gracefully: with no Mistral key we return the
// cached Claude scores/reasons, which are already explainable.
// ---------------------------------------------------------------------------
jobs.get('/:jobId/shortlist', async (req, res) => {
  const jobId = req.params.jobId
  const job = must(await sb.from('job_listings').select('*').eq('id', jobId).maybeSingle()) as any
  if (!job) return res.status(404).json({ error: 'not_found' })
  if (job.company_id !== req.user!.id && !isAdminEmail(req.user!.email)) return res.status(403).json({ error: 'forbidden' })

  const cacheRows = await (async () => {
    const rows = (must(await sb.from('ai_match_cache').select('student_id, payload, resume_id, stale').eq('job_id', jobId)) as any[]) ?? []
    const jobMatch = rowToMatchJob(job)
    // Re-score entries invalidated by a résumé/profile edit so the employer sees
    // the refreshed analysis (and an updated score), instead of a stale or dropped
    // row. getMatch re-caches with the current résumé when it re-scores.
    return Promise.all(
      rows.map(async (r) => {
        let m: any = null
        try { m = JSON.parse(r.payload) } catch { return null }
        if (r.stale === 1) {
          try {
            const fresh = await getMatch(r.student_id, jobMatch, { cache: true })
            if (fresh) m = fresh
          } catch { /* keep stale payload as fallback */ }
        }
        return { student_id: r.student_id, resume_id: r.resume_id, m }
      }),
    )
  })()
  const parsed = (cacheRows.filter(Boolean) as any[]).sort((a: any, b: any) => (b.m.score ?? 0) - (a.m.score ?? 0))

  if (!parsed.length) {
    return res.json({
      job_id: jobId,
      mistral: hasMistral(),
      summary: null,
      candidates: [],
      note: 'No students have been matched to this role yet. Candidates appear here once they browse the role and get scored.',
    })
  }

  const ids = parsed.map((x: any) => x.student_id)
  const profRows = (must(await sb.from('profiles').select('id, full_name, avatar_url, major, location, skills').in('id', ids)) as any[]) ?? []
  const profById = new Map(profRows.map((p) => [p.id, p]))
  const appRows = (must(await sb.from('applications').select('*').eq('job_id', jobId).in('student_id', ids).in('status', ['pending', 'reviewed', 'shortlisted', 'hired', 'rejected'])) as any[]) ?? []
  const appByStudent = new Map(appRows.map((a) => [a.student_id, a]))
  // The candidate's CURRENT active résumé, to detect post-apply edits.
  const curRows = (must(await sb.from('resume_profiles').select('id, student_id').eq('active', 1).in('student_id', ids)) as any[]) ?? []
  const curResumeByStudent = new Map(curRows.map((r) => [r.student_id, r.id]))

  const candidates = parsed.map((x: any) => {
    const p = profById.get(x.student_id) ?? {}
    const app = appByStudent.get(x.student_id)
    const matchedResumeId = app?.resume_id ?? x.resume_id ?? null
    const curResumeId = curResumeByStudent.get(x.student_id) ?? null
    const snapshot: any = app?.resume_snapshot ? j.parse(app.resume_snapshot, null) : null
    return {
      student_id: x.student_id,
      resume_id: x.resume_id,
      name: p.full_name ?? 'Candidate',
      avatar_url: p.avatar_url ?? null,
      major: p.major ?? null,
      location: p.location ?? null,
      skills: j.parse(p.skills, []),
      applied: !!app,
      application_id: app?.id ?? null,
      application_status: app?.status ?? null,
      score: x.m.score ?? 0,
      matched_skills: x.m.matched_skills ?? [],
      reasons: x.m.reasons ?? [],
      mismatch_flags: x.m.mismatch_flags ?? [],
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
        c.decision_note = e.decision_note ?? null
        c.fit_strengths = e.strengths ?? []
        c.fit_gaps = e.gaps ?? []
      }
    }
    candidates.sort((a: any, b: any) => (b.fit_score ?? b.score) - (a.fit_score ?? a.score))
  }

  return res.json({ job_id: jobId, mistral: hasMistral(), summary, candidates })
})

async function mistralShortlistAid(job: any, candidates: any[]): Promise<{ summary?: string; candidates?: any[] } | null> {
  if (!hasMistral()) return null
  const top = candidates.slice(0, 25)
  const system =
    'You are an impartial hiring decision assistant for an EMPLOYER reviewing a shortlist of students already matched to a role. ' +
    'For each candidate give an employer-focused FIT VERDICT and a concise DECISION NOTE that helps the employer decide whether to interview. ' +
    'Be honest: surface both strengths and gaps relative to the role. Output STRICT JSON only.'
  const schema = {
    summary: 'string — 1-2 sentence overview of shortlist quality for this role',
    candidates: [
      {
        student_id: 'string (must match the provided id exactly)',
        fit_score: 'number 0-100 (your independent employer-facing fit estimate)',
        verdict: "one of 'strong' | 'possible' | 'weak'",
        decision_note: 'string — 2-3 sentences: why interview or not, with the key tradeoff',
        strengths: ['string'],
        gaps: ['string'],
      },
    ],
  }
  const cands = top
    .map(
      (c, i) =>
        `${i + 1}. id=${c.student_id} name=${c.name} major=${c.major ?? ''} location=${c.location ?? ''} ` +
        `skills=[${c.skills.join(', ')}] baseScore=${c.score} matchedSkills=[${c.matched_skills.join(', ')}] ` +
        `reasons=[${c.reasons.join(' | ')}] gaps=[${c.mismatch_flags.join(', ')}]`,
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
