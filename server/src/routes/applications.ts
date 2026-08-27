import { Router } from '@/lib/http'
import { sb, must, j } from '@/db'
import { requireAuth, loadUserType } from '@/lib/auth'
import { rowToApplication } from '@/lib/serialize'
import { uid, now, notify } from '@/lib/util'
import { cacheGet, cacheSet } from '@/lib/cache'
import { isAdminEmail } from '@/lib/admin'
import { storeDocument, validateDocuments, DOCUMENT_BUCKET } from '@/lib/documents'
import { scoreAssignmentWithAI } from '@/routes/ai/assignment'
import { getMatch, rowToMatchJob, hasClaude } from '@/routes/ai/helpers'

// Detect a unique-constraint violation on (student_id, job_id). `must()` rethrows
// Postgres errors as plain Error objects, so we match on the message text.
function isDuplicateApplication(e: any): boolean {
  const m: string = e?.message ?? ''
  return m.includes('duplicate key value') || m.includes('applications_student_job_unique')
}

// Resolve a candidate's match fit for a job, used to connect the assessment review
// AI to the (résumé) match even when the application's own snapshot is empty — e.g.
// the applied job was never in the student's top-40 discovery set, so no match was
// captured at apply time. Reads the cached score first, scoring on the fly only if
// missing, then returns the prior the review AI reasons from.
async function resolveMatchContext(studentId: string, job: any): Promise<{ score: number; rationale: string | null; matchedSkills: string[] } | null> {
  try {
    const cached = (await sb.from('ai_match_cache').select('payload').eq('student_id', studentId).eq('job_id', job.id).maybeSingle()).data as any
    let p: any = cached?.payload ? j.parse(cached.payload, null) : null
    if (!p) p = await getMatch(studentId, rowToMatchJob(job), { cache: true })
    if (!p) return null
    const reasons: string[] = Array.isArray(p.reasons) ? p.reasons : []
    const skills: string[] = Array.isArray(p.matched_skills) ? p.matched_skills : []
    return { score: p.score ?? 0, rationale: reasons.length ? reasons.join(' ') : null, matchedSkills: skills }
  } catch {
    return null
  }
}

export const applications = Router()
applications.use(requireAuth)

/** Attach the applicant's profile fields (avatar, skills, bio) onto application
 *  rows so reviewers see the real candidate photo/skills without one extra fetch
 *  per applicant. Does a single profiles query for all distinct student_ids. */
// Enrich a single application row with the student's profile (avatar, skills, bio)
// and resume-change flag, then serialize. Update routes must use this instead of
// rowToApplication directly, or the returned application loses student_avatar_url
// (the avatar would fall back to a blank monogram while the tags ring stayed).
async function serializeEnriched(row: any) {
  if (!row) return null
  await attachStudentProfiles([row])
  await attachResumeChanged([row])
  return rowToApplication(row)
}

async function attachStudentProfiles(rows: any[]) {
  const ids = Array.from(new Set((rows ?? []).map((r) => r.student_id).filter(Boolean)))
  if (!ids.length) return
  let profiles: any[] = []
  try {
    profiles = must(await sb.from('profiles').select('id, avatar_url, skills, bio').in('id', ids)) as any[]
  } catch {
    return // profile lookup is best-effort — never block the application list
  }
  const map = new Map(profiles.map((p) => [p.id, p]))
  for (const r of rows) {
    const p = map.get(r.student_id)
    if (p) {
      r.student_avatar_url = p.avatar_url ?? null
      r.student_skills = p.skills ?? null
      r.student_bio = p.bio ?? null
    }
  }
}

// resume_id / resume_snapshot (migration 0035) may not be applied yet; detect
// once so the apply flow degrades gracefully and the feature activates on deploy.
let hasResumeSnapshotCols = false
async function resumeSnapshotColsExist(): Promise<boolean> {
  if (hasResumeSnapshotCols) return true
  const { error } = await sb.from('applications').select('resume_id').limit(1)
  hasResumeSnapshotCols = !error
  return hasResumeSnapshotCols
}

/** Flag applications whose candidate edited their résumé AFTER applying: compare
 *  the résumé that produced the match (application.resume_id) against the
 *  student's CURRENT active résumé. Best-effort — never blocks the response. */
async function attachResumeChanged(rows: any[]) {  const ids = Array.from(new Set((rows ?? []).map((r) => r.student_id).filter(Boolean)))
  if (!ids.length) return
  try {
    const cur = (must(await sb.from('resume_profiles').select('id, student_id').eq('active', 1).in('student_id', ids)) as any[]) ?? []
    const curMap = new Map(cur.map((r) => [r.student_id, r.id]))
    for (const r of rows) {
      const matched = r.resume_id ?? null
      const curId = curMap.get(r.student_id) ?? null
      r.resume_changed = !!matched && !!curId && matched !== curId
    }
  } catch {
    /* best-effort */
  }
}

// Permanently remove an application's stored documents from object storage. Best-
// effort: a missing bucket or path never blocks the (hard) delete of the row.
async function deleteApplicationDocuments(app: any) {
  try {
    const docs = j.parse<any[]>(app.documents, [])
    const paths = (docs ?? []).map((d) => d?.storage_path).filter(Boolean)
    if (paths.length) await sb.storage.from(DOCUMENT_BUCKET).remove(paths)
  } catch { /* ignore */ }
}

applications.get('/mine', async (req, res) => {
  const cacheKey = `apps:student:${req.user!.id}`
  const cached = cacheGet<any[]>(cacheKey)
  if (cached) return res.json(cached)
  const rows = must(await sb.from('applications').select('*').eq('student_id', req.user!.id).order('created_at', { ascending: false })) as any[]
  const payload = rows.map(rowToApplication)
  cacheSet(cacheKey, payload, 120_000)
  res.json(payload)
})

applications.get('/job/:jobId', async (req, res) => {
  const job = must(await sb.from('job_listings').select('company_id').eq('id', req.params.jobId).maybeSingle()) as any
  if (!job) return res.status(404).json({ error: 'job_not_found' })
  if (job.company_id !== req.user!.id && !isAdminEmail(req.user!.email)) return res.status(403).json({ error: 'forbidden' })
  // Employers only see submitted applications. In-progress rows (a saved draft,
  // or a failed/cancelled proctor attempt that hasn't been re-submitted yet) stay
  // hidden — a cancelled attempt reappears once the candidate re-submits, and its
  // retry history lives in the timeline.
  // Archived rows are excluded by default; ?archived=1 returns ONLY archived ones
  // (the employer's trash/recycle bin they can restore or purge).
  const showArchived = req.query.archived === '1'
  let q = sb.from('applications').select('*').eq('job_id', req.params.jobId).in('status', ['pending', 'reviewed', 'shortlisted', 'hired', 'rejected', 'withdrawn'])
  q = showArchived ? q.not('archived_at', 'is', null) : q.is('archived_at', null)
  const rows = must(await q.order('created_at', { ascending: false })) as any[]
  await attachStudentProfiles(rows)
  await attachResumeChanged(rows)
  res.json(rows.map(rowToApplication))
})

applications.get('/company', async (req, res) => {
  // Trust the live profile over the (possibly stale) JWT `user_type`. The access
  // token signs the role at login time, but a role can change — e.g. a student who
  // selects "school"/"company" during onboarding, or an account whose persisted
  // token predates the role update. Re-resolving here prevents valid companies and
  // schools from being 403'd while their token still carries an old role.
  const liveType = await loadUserType(req.user!.id)
  const userType = liveType ?? req.user!.user_type
  if (userType !== 'company' && userType !== 'school' && !isAdminEmail(req.user!.email)) {
    return res.status(403).json({ error: 'forbidden' })
  }
  const jobs = must(await sb.from('job_listings').select('id').eq('company_id', req.user!.id)) as any[]
  const ids = jobs.map((j2) => j2.id)
  if (!ids.length) return res.json([])
  // Employers only see submitted applications (hide drafts / cancelled attempts),
  // and archived rows are excluded unless ?archived=1 is passed.
  const showArchived = req.query.archived === '1'
  let q = sb.from('applications').select('*').in('job_id', ids).in('status', ['pending', 'reviewed', 'shortlisted', 'hired', 'rejected', 'withdrawn'])
  q = showArchived ? q.not('archived_at', 'is', null) : q.is('archived_at', null)
  const rows = must(await q.order('created_at', { ascending: false })) as any[]
  await attachStudentProfiles(rows)
  await attachResumeChanged(rows)
  res.json(rows.map(rowToApplication))
})

applications.get('/:id', async (req, res) => {
  const r = must(await sb.from('applications').select('*').eq('id', req.params.id).maybeSingle())
  if (!r) return res.status(404).json({ error: 'not_found' })
  const job = must(await sb.from('job_listings').select('company_id').eq('id', r.job_id).maybeSingle()) as any
  const allowed = r.student_id === req.user!.id || job?.company_id === req.user!.id || isAdminEmail(req.user!.email)
  if (!allowed) return res.status(403).json({ error: 'forbidden' })
  await attachStudentProfiles([r])
  await attachResumeChanged([r])
  res.json(rowToApplication(r))
})

applications.post('/', async (req, res) => {
  const b = req.body ?? {}
  const documentError = validateDocuments(b.documents ?? [])
  if (documentError) return res.status(400).json({ error: documentError })
  const job = must(await sb.from('job_listings').select('*').eq('id', b.job_id).maybeSingle()) as any
  if (!job) return res.status(404).json({ error: 'job_not_found' })
  const dup = must(await sb.from('applications').select('*').eq('student_id', req.user!.id).eq('job_id', b.job_id).maybeSingle()) as any
  // A saved draft is resumed (turned into a real application) on submit; a withdrawn
  // application is reactivated (same record, fresh submission); a real, already-
  // submitted application (pending/reviewed/etc.) can't be re-created.
  if (dup && dup.status !== 'draft' && dup.status !== 'withdrawn') return res.status(409).json({ error: 'already_applied' })

  const documents = await Promise.all((b.documents ?? []).map(async (document: any) => {
    const stored = await storeDocument(req.user!.id, document.kind ?? 'document', document.name ?? 'document', document.url)
    // Keep the original mime/size when the file was already stored (e.g. a resumed draft).
    return { ...document, url: stored.url, storage_path: stored.path, ...(stored.path ? { mime: stored.mime, size: stored.size } : {}) }
  }))

  const ts = now()
  // Carry the AI match score + rationale we showed the student at apply time onto
  // the application so the employer can see the same evidence during review. Also
  // snapshot the résumé that produced the match, so reviewers can compare it to the
  // candidate's CURRENT résumé (e.g. gaps filled after applying).
  let matchScore: number | null = null
  let matchRationale: string | null = null
  let resumeId: string | null = null
  let resumeSnapshot: any = null
  try {
    const c = (await sb.from('ai_match_cache').select('payload, resume_id').eq('student_id', req.user!.id).eq('job_id', b.job_id).maybeSingle()).data as any
    if (c?.payload) {
      const p = JSON.parse(c.payload)
      matchScore = p.score ?? null
      const skills: string[] = Array.isArray(p.matched_skills) ? p.matched_skills : []
      const reasons: string[] = Array.isArray(p.reasons) ? p.reasons : []
      const parts = [...(skills.length ? [`Strong in ${skills.slice(0, 4).join(', ')}`] : []), ...reasons].filter(Boolean)
      matchRationale = parts.length ? parts.join(' ') : null
    }
    resumeId = c?.resume_id ?? null
  } catch { /* no cached score — leave null */ }
  if (resumeId) {
    try {
      const rp = (await sb.from('resume_profiles').select('id, name, summary, skills, projects').eq('id', resumeId).maybeSingle()).data as any
      if (rp) {
        resumeSnapshot = { id: rp.id, name: rp.name, summary: rp.summary ?? null, skills: j.parse(rp.skills, []), projects: j.parse(rp.projects, []) }
      }
    } catch { /* best-effort snapshot */ }
  }

  // Attempts represent *test* attempts consumed. Submitting the application itself
  // does NOT consume one — under the apply-first model the candidate takes the
  // proctored test afterwards (PATCH /:id/assignment), and that's when an attempt
  // is counted (or a proctor cancellation does). So a fresh application starts at
  // 0; a resumed draft keeps whatever attempts were already consumed.
  const prevAttempts = dup?.attempts ?? 0
  const maxAttempts = job.assignment?.max_attempts && job.assignment.max_attempts > 0 ? job.assignment.max_attempts : 10
  const attempts = prevAttempts
  if (prevAttempts >= maxAttempts) {
    return res.status(403).json({ error: 'attempts_exhausted' })
  }

  // Apply-first: the application is submitted now; the proctored test is taken
  // afterwards. The candidate becomes eligible for the test immediately when the
  // employer requires it 'after_application' (default), or only once shortlisted.
  const requiredWhen = (job.assignment as any)?.required_when ?? 'after_application'
  const testEligibleAt = requiredWhen === 'after_application' ? ts : null

  const id = dup?.id ?? uid('a')
  const timeline = j.parse<any[]>(dup?.timeline ?? '[]', [])
  timeline.push({ status: dup?.status === 'withdrawn' ? 'reapplied' : 'applied', at: ts })
  const row = {
    id, student_id: req.user!.id, job_id: b.job_id, status: 'pending',
    archived_at: null,
    cover_note: b.cover_note ?? null, documents: j.stringify(documents),
    full_name: b.full_name, email: b.email, phone: b.phone ?? null,
    school: b.school ?? null, year: b.year ?? null, graduated: !!b.graduated, linkedin: b.linkedin ?? null,
    assignment_answers: j.stringify(b.assignment_answers ?? []),
    assignment_status: job.assignment ? (b.assignment_answers?.length ? 'submitted' : 'pending') : 'not_required',
    test_eligible_at: testEligibleAt,
    attempts,
    match_score: matchScore,
    match_rationale: matchRationale,
    created_at: dup?.created_at ?? ts,
    timeline: j.stringify(timeline),
  }
  if (dup) {
    must(await sb.from('applications').update(row).eq('id', id))
  } else {
    try {
      must(await sb.from('applications').insert(row))
    } catch (e: any) {
      // Another concurrent submit already created the row (unique index
      // applications_student_job_unique). Treat it as "already applied".
      if (isDuplicateApplication(e)) {
        const existing = must(await sb.from('applications').select('*').eq('student_id', req.user!.id).eq('job_id', b.job_id).maybeSingle()) as any
        if (existing) {
          await attachStudentProfiles([existing])
          await attachResumeChanged([existing])
          return res.status(409).json({ error: 'already_applied', application: rowToApplication(existing) })
        }
      }
      throw e
    }
  }
  // Snapshot the résumé used for matching once the column exists (migration 0035).
  // Best-effort: skipped safely if the migration hasn't been applied yet.
  if (await resumeSnapshotColsExist()) {
    try {
      must(await sb.from('applications').update({ resume_id: resumeId, resume_snapshot: j.stringify(resumeSnapshot) }).eq('id', id))
    } catch { /* best-effort */ }
  }
  // Proactively score this applied job now so the employer ALWAYS has a real ranking
  // for the user/job pair — even when the role was outside the student's top-40
  // discovery set (where the LLM scorer normally wouldn't have been called). Best-
  // effort + fire-and-forget: never blocks the apply response, and the shortlist
  // also re-scores on the fly as a fallback.
  if (matchScore == null && hasClaude()) {
    void (async () => {
      try {
        const m = await getMatch(req.user!.id, rowToMatchJob(job), { cache: true })
        if (m) {
          const skills = Array.isArray(m.matched_skills) ? m.matched_skills : []
          const reasons = Array.isArray(m.reasons) ? m.reasons : []
          const parts = [...(skills.length ? [`Strong in ${skills.slice(0, 4).join(', ')}`] : []), ...reasons].filter(Boolean)
          await sb.from('applications').update({ match_score: m.score ?? null, match_rationale: parts.length ? parts.join(' ') : null }).eq('id', id)
        }
      } catch { /* best-effort */ }
    })()
  }
  await notify(job.company_id, 'new_application', 'New application received', `${b.full_name} applied to ${job.title}`, id)
  const created = must(await sb.from('applications').select('*').eq('id', id).maybeSingle())
  res.json(rowToApplication(created))
})

/** Load the student's saved draft for a job (or null). Used to resume an
 *  application the candidate started earlier. */
applications.get('/draft/:jobId', async (req, res) => {
  const r = must(await sb.from('applications').select('*').eq('student_id', req.user!.id).eq('job_id', req.params.jobId).in('status', ['draft', 'cancelled']).maybeSingle())
  res.json(r ? rowToApplication(r) : null)
})

/** Save (upsert) a draft application for the current user + job so a candidate can
 *  come back later. Never overwrites an already-submitted application. */
applications.put('/draft', async (req, res) => {
  const b = req.body ?? {}
  const job = must(await sb.from('job_listings').select('*').eq('id', b.job_id).maybeSingle()) as any
  if (!job) return res.status(404).json({ error: 'job_not_found' })
  const existing = must(await sb.from('applications').select('*').eq('student_id', req.user!.id).eq('job_id', b.job_id).maybeSingle()) as any
  // Block saving a draft only once the application has actually been submitted.
  // A cancelled (failed-attempt) application can be resumed as a new draft retry.
  if (existing && existing.status === 'pending') return res.status(409).json({ error: 'already_applied' })
  const documentError = validateDocuments(b.documents ?? [])
  if (documentError) return res.status(400).json({ error: documentError })
  const documents = await Promise.all((b.documents ?? []).map(async (document: any) => {
    const stored = await storeDocument(req.user!.id, document.kind ?? 'document', document.name ?? 'document', document.url)
    // Keep the original mime/size when the file was already stored (e.g. a resumed draft).
    return { ...document, url: stored.url, storage_path: stored.path, ...(stored.path ? { mime: stored.mime, size: stored.size } : {}) }
  }))
  const ts = now()
  const id = existing?.id ?? uid('a')
  const row = {
    id, student_id: req.user!.id, job_id: b.job_id, status: 'draft',
    archived_at: null,
    cover_note: b.cover_note ?? null, documents: j.stringify(documents),
    full_name: b.full_name, email: b.email, phone: b.phone ?? null,
    school: b.school ?? null, year: b.year ?? null, graduated: !!b.graduated, linkedin: b.linkedin ?? null,
    assignment_answers: j.stringify(b.assignment_answers ?? []),
    assignment_status: job.assignment ? (b.assignment_answers?.length ? 'submitted' : 'pending') : 'not_required',
    attempts: existing?.attempts ?? 0,
    created_at: existing?.created_at ?? ts,
    updated_at: ts,
    timeline: existing?.timeline ?? j.stringify([{ status: 'draft', at: ts }]),
  }
  if (existing) {
    must(await sb.from('applications').update(row).eq('id', id))
  } else {
    try {
      must(await sb.from('applications').insert(row))
    } catch (e: any) {
      // Concurrent draft save: a row already exists, just return it.
      if (isDuplicateApplication(e)) {
        const saved = must(await sb.from('applications').select('*').eq('student_id', req.user!.id).eq('job_id', b.job_id).maybeSingle())
        return res.json(rowToApplication(saved))
      }
      throw e
    }
  }
  const saved = must(await sb.from('applications').select('*').eq('id', id).maybeSingle())
  res.json(rowToApplication(saved))
})

applications.patch('/:id/status', async (req, res) => {
  const { status, reason } = req.body ?? {}
  const r = must(await sb.from('applications').select('*').eq('id', req.params.id).maybeSingle()) as any
  if (!r) return res.status(404).json({ error: 'not_found' })
  const validStatuses = new Set(['pending', 'reviewed', 'shortlisted', 'hired', 'rejected'])
  if (!validStatuses.has(status)) return res.status(400).json({ error: 'invalid_status' })
  const job = must(await sb.from('job_listings').select('title, company_id').eq('id', r.job_id).maybeSingle()) as any
  if (!job || (job.company_id !== req.user!.id && !isAdminEmail(req.user!.email))) return res.status(403).json({ error: 'forbidden' })
  const ts = now()
  const timeline = j.parse<any[]>(r.timeline, [])
  timeline.push({ status, at: ts })
  // When the employer requires the test only after shortlisting, the candidate
  // becomes eligible for the test at the moment they're shortlisted.
  const patch0: any = {}
  if (status === 'shortlisted') {
    const jb = must(await sb.from('job_listings').select('assignment').eq('id', r.job_id).maybeSingle()) as any
    const rw = jb?.assignment?.required_when ?? 'after_application'
    if (rw === 'after_shortlist' && !r.test_eligible_at) {
      patch0.test_eligible_at = ts
      timeline.push({ status: 'applied', at: ts, note: 'test unlocked' })
    }
  }
  // Every status change is a human decision: record who made it, when, and why
  // (a reason is required when rejecting, so the call is traceable).
  const patch: any = { status, timeline: j.stringify(timeline), decision_by: req.user!.id, decided_at: now(), ...patch0 }
  if (reason !== undefined) patch.decision_reason = reason || null
  must(await sb.from('applications').update(patch).eq('id', r.id))
  await notify(r.student_id, 'status_change', `Application update: ${status}`, `Your application for ${job?.title ?? 'a role'} is now ${status}.`, r.id)
  const updated = must(await sb.from('applications').select('*').eq('id', r.id).maybeSingle())
  res.json(await serializeEnriched(updated))
})

// Human override of the AI assessment score + an optional decision note. The final
// number is the employer's; we only store it (and who set it, when).
applications.patch('/:id/review', async (req, res) => {
  const { assignment_score, decision_reason, tags } = req.body ?? {}
  const r = must(await sb.from('applications').select('*').eq('id', req.params.id).maybeSingle()) as any
  if (!r) return res.status(404).json({ error: 'not_found' })
  const job = must(await sb.from('job_listings').select('company_id').eq('id', r.job_id).maybeSingle()) as any
  if (!job || (job.company_id !== req.user!.id && !isAdminEmail(req.user!.email))) return res.status(403).json({ error: 'forbidden' })
  const patch: any = { decision_by: req.user!.id, decided_at: now() }
  if (typeof assignment_score === 'number') patch.assignment_score = Math.max(0, Math.min(100, Math.round(assignment_score)))
  if (decision_reason !== undefined) patch.decision_reason = decision_reason || null
  if (Array.isArray(tags)) patch.tags = tags as string[]
  must(await sb.from('applications').update(patch).eq('id', r.id))
  const updated = must(await sb.from('applications').select('*').eq('id', r.id).maybeSingle())
  res.json(await serializeEnriched(updated))
})

// Run the AI assessment review (scores the submitted assignment against the rubric).
// Returns an updated application with assignment_score + feedback. The score is a
// suggestion — the employer overrides it via PATCH /:id/review.
applications.post('/:id/score-assignment', async (req, res) => {
  const r = must(await sb.from('applications').select('*').eq('id', req.params.id).maybeSingle()) as any
  if (!r) return res.status(404).json({ error: 'not_found' })
  const job = must(await sb.from('job_listings').select('*').eq('id', r.job_id).maybeSingle()) as any
  if (!job || (job.company_id !== req.user!.id && !isAdminEmail(req.user!.email))) return res.status(403).json({ error: 'forbidden' })
  if (!job.assignment) return res.status(400).json({ error: 'no_assignment' })
  const answers = j.parse<any[]>(r.assignment_answers ?? '[]', [])
  if (!answers.length) return res.status(400).json({ error: 'no_answers' })
  // Connect the review AI to the candidate's match fit (résumé + role), even when
  // the application's own snapshot is empty: resolve the real match from the cache
  // (or score on the fly) and feed it as a prior. Also backfill the application's
  // match_score so the review page shows it ("student match is empty" fix).
  const matchContext = await resolveMatchContext(r.student_id, job)
  if (matchContext && r.match_score == null) {
    try { await sb.from('applications').update({ match_score: matchContext.score, match_rationale: matchContext.rationale }).eq('id', r.id) } catch { /* best-effort */ }
  }
  const result = await scoreAssignmentWithAI(job.assignment, answers, { title: job.title, type: job.type, description: job.description }, matchContext)
  must(
    await sb
      .from('applications')
      .update({
        assignment_score: result.score,
        assignment_ai_feedback: j.stringify(result.feedback),
        ai_recommendation: result.recommendation,
        decision_by: req.user!.id,
        decided_at: now(),
      })
      .eq('id', r.id),
  )
  const updated = must(await sb.from('applications').select('*').eq('id', r.id).maybeSingle())
  res.json(await serializeEnriched(updated))
})

// Submits the candidate's completed proctored test for an already-submitted
// application (apply-first flow). Records whether it was late vs the employer's
// window, marks the assignment done, and runs the AI scoring as a suggestion.
applications.patch('/:id/assignment', async (req, res) => {
  const { assignment_answers, duration_seconds } = req.body ?? {}
  const r = must(await sb.from('applications').select('*').eq('id', req.params.id).maybeSingle()) as any
  if (!r) return res.status(404).json({ error: 'not_found' })
  if (r.student_id !== req.user!.id) return res.status(403).json({ error: 'forbidden' })
  const job = must(await sb.from('job_listings').select('*').eq('id', r.job_id).maybeSingle()) as any
  if (!job?.assignment) return res.status(400).json({ error: 'no_assignment' })
  if (r.assignment_status === 'submitted') return res.json(await serializeEnriched(r))
  const maxAttempts = job.assignment?.max_attempts && job.assignment.max_attempts > 0 ? job.assignment.max_attempts : 10
  if ((r.attempts ?? 0) >= maxAttempts) return res.status(403).json({ error: 'attempts_exhausted' })

  const ts = now()
  // Late if past the eligibility window the employer set.
  let late = false
  if (r.test_eligible_at && job.assignment?.window_days) {
    const due = new Date(new Date(r.test_eligible_at).getTime() + job.assignment.window_days * 86400000)
    late = new Date(ts).getTime() > due.getTime()
  }
  const timeline = j.parse<any[]>(r.timeline ?? '[]', [])
  const isRetake = timeline.some((t) => t.status === 'test_unlocked')
  timeline.push({ status: 'test_submitted', at: ts, late, is_retake: isRetake })
  // An attempt is counted once the test is actually submitted. Cancellations
  // along the way already incremented `attempts`; a clean first submit is #1.
  const attempts = r.attempts ? r.attempts : 1
  // Best-effort AI scoring so the employer sees a suggestion immediately.
  let result: any = null
  try {
    const answers = assignment_answers ?? []
    // Connect the assessment AI to the candidate's match fit (résumé + role),
    // resolving it from the cache / on the fly when the application snapshot is
    // empty, and backfill the application so the review shows the match.
    const matchContext = await resolveMatchContext(r.student_id, job)
    if (matchContext && r.match_score == null) {
      try { await sb.from('applications').update({ match_score: matchContext.score, match_rationale: matchContext.rationale }).eq('id', r.id) } catch { /* best-effort */ }
    }
    result = await scoreAssignmentWithAI(job.assignment, answers, { title: job.title, type: job.type, description: job.description }, matchContext)
  } catch { /* leave unscored */ }
  // Archive this attempt (kept across retakes) so every submission stays
  // reviewable, then update the current/latest fields the employer sees.
  const history = j.parse<any[]>(r.assignment_attempts ?? '[]', [])
  history.push({
    index: history.length + 1,
    is_retake: isRetake,
    submitted_at: ts,
    late,
    duration_seconds: duration_seconds ?? null,
    answers: assignment_answers ?? [],
    score: result?.score ?? null,
    ai_feedback: result ? result.feedback : null,
    recommendation: result?.recommendation ?? null,
  })
  must(
    await sb.from('applications').update({
      assignment_answers: j.stringify(assignment_answers ?? []),
      assignment_status: 'submitted',
      assignment_submitted_at: ts,
      assignment_late: late,
      test_eligible_at: r.test_eligible_at ?? ts,
      attempts,
      timeline: j.stringify(timeline),
      assignment_attempts: j.stringify(history),
      ...(result
        ? {
            assignment_score: result.score,
            assignment_ai_feedback: j.stringify(result.feedback),
            ai_recommendation: result.recommendation,
            decision_by: req.user!.id,
            decided_at: ts,
          }
        : {}),
    }).eq('id', r.id),
  )
  const updated = must(await sb.from('applications').select('*').eq('id', r.id).maybeSingle())
  res.json(await serializeEnriched(updated))
})

// Employer override: re-open / grant another attempt at the proctored test for a
// candidate who failed or exhausted their attempts. This is the human backstop —
// e.g. the candidate messaged explaining a tech issue — so the company always
// retains the power to let someone retake it. Resets attempts and clears the
// previous result, and notifies the candidate.
applications.post('/:id/unlock-test', async (req, res) => {
  const r = must(await sb.from('applications').select('*').eq('id', req.params.id).maybeSingle()) as any
  if (!r) return res.status(404).json({ error: 'not_found' })
  const job = must(await sb.from('job_listings').select('id, title, company_id, assignment').eq('id', r.job_id).maybeSingle()) as any
  if (!job || (job.company_id !== req.user!.id && !isAdminEmail(req.user!.email))) return res.status(403).json({ error: 'forbidden' })
  if (!job.assignment) return res.status(400).json({ error: 'no_assignment' })
  const ts = now()
  const timeline = j.parse<any[]>(r.timeline ?? '[]', [])
  timeline.push({ status: 'test_unlocked', at: ts, by: 'employer', retake: true })
  // Preserve any pre-existing submission in the archive before we clear the
  // current fields, so a first attempt from before this feature still survives.
  const archive = j.parse<any[]>(r.assignment_attempts ?? '[]', [])
  if (!archive.length && r.assignment_status === 'submitted' && r.assignment_answers) {
    archive.push({
      index: 1,
      is_retake: false,
      submitted_at: r.assignment_submitted_at ?? null,
      late: r.assignment_late ?? false,
      duration_seconds: null,
      answers: j.parse(r.assignment_answers, []),
      score: r.assignment_score ?? null,
      ai_feedback: r.assignment_ai_feedback ? j.parse(r.assignment_ai_feedback, null) : null,
      recommendation: r.ai_recommendation ?? null,
    })
  }
  must(
    await sb.from('applications').update({
      assignment_status: 'pending',
      attempts: 0,
      assignment_submitted_at: null,
      assignment_late: false,
      assignment_answers: j.stringify([]),
      assignment_score: null,
      assignment_ai_feedback: null,
      ai_recommendation: null,
      test_eligible_at: ts,
      timeline: j.stringify(timeline),
      assignment_attempts: j.stringify(archive),
    }).eq('id', r.id),
  )
  await notify(r.student_id, 'test_unlocked', 'Assessment re-opened', `The employer re-opened your assessment for ${job.title}. You can take it again.`, r.id)
  const updated = must(await sb.from('applications').select('*').eq('id', r.id).maybeSingle())
  res.json(await serializeEnriched(updated))
})

// Records a proctor integrity violation during the test (camera/mic denied, a
// second person detected, the candidate left frame, looked down, sustained loud
// noise, excessive movement, or left the tab/fullscreen). Each violation consumes
// one attempt and is recorded on the already-submitted application — the
// application itself stays "pending" (visible to the employer) and the candidate
// can retry the test until they hit the employer-set limit.
applications.post('/proctor-cancel', async (req, res) => {
  const { job_id, reason } = req.body ?? {}
  if (!job_id) return res.status(400).json({ error: 'missing_job' })
  const job = must(await sb.from('job_listings').select('id, assignment').eq('id', job_id).maybeSingle()) as any
  if (!job) return res.status(404).json({ error: 'job_not_found' })
  const maxAttempts = job.assignment?.max_attempts && job.assignment.max_attempts > 0 ? job.assignment.max_attempts : 10
  const existing = must(await sb.from('applications').select('*').eq('student_id', req.user!.id).eq('job_id', job_id).maybeSingle()) as any
  if (!existing) return res.status(400).json({ error: 'no_application' })
  // Test already completed — nothing to cancel.
  if (existing.assignment_status === 'submitted') return res.json(await serializeEnriched(existing))
  const ts = now()
  const attempts = (existing.attempts ?? 0) + 1
  const timeline = j.parse<any[]>(existing.timeline ?? '[]', [])
  timeline.push({ status: 'test_return', at: ts, reason: reason ?? 'violation' })
  must(await sb.from('applications').update({ attempts, timeline: j.stringify(timeline) }).eq('id', existing.id))
  const updated = must(await sb.from('applications').select('*').eq('id', existing.id).maybeSingle())
  res.json(await serializeEnriched(updated))
})

// Soft-delete: an employer "deletes" an application by archiving it (documents and
// decision history are preserved). The student who owns it can still see their own
// copy; the employer just stops seeing it in active lists until they restore it.
applications.patch('/:id/archive', async (req, res) => {
  const r = must(await sb.from('applications').select('*').eq('id', req.params.id).maybeSingle()) as any
  if (!r) return res.status(404).json({ error: 'not_found' })
  const job = must(await sb.from('job_listings').select('company_id').eq('id', r.job_id).maybeSingle()) as any
  if (!job || (job.company_id !== req.user!.id && !isAdminEmail(req.user!.email))) return res.status(403).json({ error: 'forbidden' })
  must(await sb.from('applications').update({ archived_at: now() }).eq('id', r.id))
  const updated = must(await sb.from('applications').select('*').eq('id', r.id).maybeSingle())
  res.json(await serializeEnriched(updated))
})

// Restore a previously archived application back into the active list.
applications.patch('/:id/restore', async (req, res) => {
  const r = must(await sb.from('applications').select('*').eq('id', req.params.id).maybeSingle()) as any
  if (!r) return res.status(404).json({ error: 'not_found' })
  const job = must(await sb.from('job_listings').select('company_id').eq('id', r.job_id).maybeSingle()) as any
  if (!job || (job.company_id !== req.user!.id && !isAdminEmail(req.user!.email))) return res.status(403).json({ error: 'forbidden' })
  must(await sb.from('applications').update({ archived_at: null }).eq('id', r.id))
  const updated = must(await sb.from('applications').select('*').eq('id', r.id).maybeSingle())
  res.json(await serializeEnriched(updated))
})

// Permanent delete. Allowed for the student who owns the application OR the employer
// who owns the job (after archiving). Removes the stored documents, then the row.
applications.delete('/:id', async (req, res) => {
  const r = must(await sb.from('applications').select('*').eq('id', req.params.id).maybeSingle()) as any
  if (!r) return res.status(404).json({ error: 'not_found' })
  const isStudent = r.student_id === req.user!.id
  let isEmployer = false
  if (!isStudent) {
    const job = must(await sb.from('job_listings').select('company_id').eq('id', r.job_id).maybeSingle()) as any
    isEmployer = !!job && (job.company_id === req.user!.id || isAdminEmail(req.user!.email))
  }
  if (!isStudent && !isEmployer) return res.status(403).json({ error: 'forbidden' })
  // Student "withdraw" is SOFT: keep the row + its documents so the employer still
  // sees it (marked "withdrawn") and the candidate can re-apply to the SAME record
  // (reactivated on their next submit). Hard-deleting would erase history and make
  // re-applications look like brand-new candidates.
  if (isStudent) {
    const timeline = j.parse<any[]>(r.timeline ?? '[]', [])
    timeline.push({ status: 'withdrawn', at: now() })
    must(await sb.from('applications').update({ status: 'withdrawn', timeline: j.stringify(timeline) }).eq('id', r.id))
    return res.json({ ok: true, status: 'withdrawn' })
  }
  // Employer/admin: permanent delete (also removes the stored documents).
  await deleteApplicationDocuments(r)
  must(await sb.from('applications').delete().eq('id', r.id))
  res.json({ ok: true })
})
