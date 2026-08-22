import { Router } from '@/lib/http'
import { sb, must, j } from '@/db'
import { requireAuth } from '@/lib/auth'
import { rowToApplication } from '@/lib/serialize'
import { uid, now, notify } from '@/lib/util'
import { isAdminEmail } from '@/lib/admin'
import { storeDocument, validateDocuments } from '@/lib/documents'
import { scoreAssignmentWithAI } from '@/routes/ai/assignment'

export const applications = Router()
applications.use(requireAuth)

/** Attach the applicant's profile fields (avatar, skills, bio) onto application
 *  rows so reviewers see the real candidate photo/skills without one extra fetch
 *  per applicant. Does a single profiles query for all distinct student_ids. */
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

applications.get('/mine', async (req, res) => {
  const rows = must(await sb.from('applications').select('*').eq('student_id', req.user!.id).order('created_at', { ascending: false })) as any[]
  res.json(rows.map(rowToApplication))
})

applications.get('/job/:jobId', async (req, res) => {
  const job = must(await sb.from('job_listings').select('company_id').eq('id', req.params.jobId).maybeSingle()) as any
  if (!job) return res.status(404).json({ error: 'job_not_found' })
  if (job.company_id !== req.user!.id && !isAdminEmail(req.user!.email)) return res.status(403).json({ error: 'forbidden' })
  const rows = must(await sb.from('applications').select('*').eq('job_id', req.params.jobId).order('created_at', { ascending: false })) as any[]
  await attachStudentProfiles(rows)
  res.json(rows.map(rowToApplication))
})

applications.get('/company', async (req, res) => {
  if (req.user!.user_type !== 'company' && req.user!.user_type !== 'school' && !isAdminEmail(req.user!.email)) {
    return res.status(403).json({ error: 'forbidden' })
  }
  const jobs = must(await sb.from('job_listings').select('id').eq('company_id', req.user!.id)) as any[]
  const ids = jobs.map((j2) => j2.id)
  if (!ids.length) return res.json([])
  const rows = must(await sb.from('applications').select('*').in('job_id', ids).order('created_at', { ascending: false })) as any[]
  await attachStudentProfiles(rows)
  res.json(rows.map(rowToApplication))
})

applications.get('/:id', async (req, res) => {
  const r = must(await sb.from('applications').select('*').eq('id', req.params.id).maybeSingle())
  if (!r) return res.status(404).json({ error: 'not_found' })
  const job = must(await sb.from('job_listings').select('company_id').eq('id', r.job_id).maybeSingle()) as any
  const allowed = r.student_id === req.user!.id || job?.company_id === req.user!.id || isAdminEmail(req.user!.email)
  if (!allowed) return res.status(403).json({ error: 'forbidden' })
  await attachStudentProfiles([r])
  res.json(rowToApplication(r))
})

applications.post('/', async (req, res) => {
  const b = req.body ?? {}
  const documentError = validateDocuments(b.documents ?? [])
  if (documentError) return res.status(400).json({ error: documentError })
  const job = must(await sb.from('job_listings').select('*').eq('id', b.job_id).maybeSingle()) as any
  if (!job) return res.status(404).json({ error: 'job_not_found' })
  const dup = must(await sb.from('applications').select('*').eq('student_id', req.user!.id).eq('job_id', b.job_id).maybeSingle()) as any
  // A saved draft is resumed (turned into a real application) on submit; a real
  // (already-submitted) application can't be re-created.
  if (dup && dup.status !== 'draft') return res.status(409).json({ error: 'already_applied' })

  const documents = await Promise.all((b.documents ?? []).map(async (document: any) => {
    const stored = await storeDocument(req.user!.id, document.kind ?? 'document', document.name ?? 'document', document.url)
    // Keep the original mime/size when the file was already stored (e.g. a resumed draft).
    return { ...document, url: stored.url, storage_path: stored.path, ...(stored.path ? { mime: stored.mime, size: stored.size } : {}) }
  }))

  const ts = now()
  // Carry the AI match score + rationale we showed the student at apply time onto
  // the application so the employer can see the same evidence during review.
  let matchScore: number | null = null
  let matchRationale: string | null = null
  try {
    const c = (await sb.from('ai_match_cache').select('payload').eq('student_id', req.user!.id).eq('job_id', b.job_id).maybeSingle()).data as any
    if (c?.payload) {
      const p = JSON.parse(c.payload)
      matchScore = p.score ?? null
      const skills: string[] = Array.isArray(p.matched_skills) ? p.matched_skills : []
      const reasons: string[] = Array.isArray(p.reasons) ? p.reasons : []
      const parts = [...(skills.length ? [`Strong in ${skills.slice(0, 4).join(', ')}`] : []), ...reasons].filter(Boolean)
      matchRationale = parts.length ? parts.join(' ') : null
    }
  } catch { /* no cached score — leave null */ }

  const id = dup?.id ?? uid('a')
  const timeline = j.parse<any[]>(dup?.timeline ?? '[]', [])
  timeline.push({ status: 'applied', at: ts })
  const row = {
    id, student_id: req.user!.id, job_id: b.job_id, status: 'pending',
    cover_note: b.cover_note ?? null, documents: j.stringify(documents),
    full_name: b.full_name, email: b.email, phone: b.phone ?? null,
    school: b.school ?? null, year: b.year ?? null, linkedin: b.linkedin ?? null,
    assignment_answers: j.stringify(b.assignment_answers ?? []),
    assignment_status: job.assignment ? (b.assignment_answers?.length ? 'submitted' : 'pending') : 'not_required',
    match_score: matchScore,
    match_rationale: matchRationale,
    created_at: dup?.created_at ?? ts,
    timeline: j.stringify(timeline),
  }
  if (dup) {
    must(await sb.from('applications').update(row).eq('id', id))
  } else {
    must(await sb.from('applications').insert(row))
  }
  await notify(job.company_id, 'new_application', 'New application received', `${b.full_name} applied to ${job.title}`, id)
  const created = must(await sb.from('applications').select('*').eq('id', id).maybeSingle())
  res.json(rowToApplication(created))
})

/** Load the student's saved draft for a job (or null). Used to resume an
 *  application the candidate started earlier. */
applications.get('/draft/:jobId', async (req, res) => {
  const r = must(await sb.from('applications').select('*').eq('student_id', req.user!.id).eq('job_id', req.params.jobId).eq('status', 'draft').maybeSingle())
  res.json(r ? rowToApplication(r) : null)
})

/** Save (upsert) a draft application for the current user + job so a candidate can
 *  come back later. Never overwrites an already-submitted application. */
applications.put('/draft', async (req, res) => {
  const b = req.body ?? {}
  const job = must(await sb.from('job_listings').select('*').eq('id', b.job_id).maybeSingle()) as any
  if (!job) return res.status(404).json({ error: 'job_not_found' })
  const existing = must(await sb.from('applications').select('*').eq('student_id', req.user!.id).eq('job_id', b.job_id).maybeSingle()) as any
  if (existing && existing.status !== 'draft') return res.status(409).json({ error: 'already_applied' })
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
    cover_note: b.cover_note ?? null, documents: j.stringify(documents),
    full_name: b.full_name, email: b.email, phone: b.phone ?? null,
    school: b.school ?? null, year: b.year ?? null, linkedin: b.linkedin ?? null,
    assignment_answers: j.stringify(b.assignment_answers ?? []),
    assignment_status: job.assignment ? (b.assignment_answers?.length ? 'submitted' : 'pending') : 'not_required',
    created_at: existing?.created_at ?? ts,
    updated_at: ts,
    timeline: existing?.timeline ?? j.stringify([{ status: 'draft', at: ts }]),
  }
  if (existing) {
    must(await sb.from('applications').update(row).eq('id', id))
  } else {
    must(await sb.from('applications').insert(row))
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
  const timeline = j.parse<any[]>(r.timeline, [])
  timeline.push({ status, at: now() })
  // Every status change is a human decision: record who made it, when, and why
  // (a reason is required when rejecting, so the call is traceable).
  const patch: any = { status, timeline: j.stringify(timeline), decision_by: req.user!.id, decided_at: now() }
  if (reason !== undefined) patch.decision_reason = reason || null
  must(await sb.from('applications').update(patch).eq('id', r.id))
  await notify(r.student_id, 'status_change', `Application update: ${status}`, `Your application for ${job?.title ?? 'a role'} is now ${status}.`, r.id)
  const updated = must(await sb.from('applications').select('*').eq('id', r.id).maybeSingle())
  res.json(rowToApplication(updated))
})

// Human override of the AI assessment score + an optional decision note. The final
// number is the employer's; we only store it (and who set it, when).
applications.patch('/:id/review', async (req, res) => {
  const { assignment_score, decision_reason } = req.body ?? {}
  const r = must(await sb.from('applications').select('*').eq('id', req.params.id).maybeSingle()) as any
  if (!r) return res.status(404).json({ error: 'not_found' })
  const job = must(await sb.from('job_listings').select('company_id').eq('id', r.job_id).maybeSingle()) as any
  if (!job || (job.company_id !== req.user!.id && !isAdminEmail(req.user!.email))) return res.status(403).json({ error: 'forbidden' })
  const patch: any = { decision_by: req.user!.id, decided_at: now() }
  if (typeof assignment_score === 'number') patch.assignment_score = Math.max(0, Math.min(100, Math.round(assignment_score)))
  if (decision_reason !== undefined) patch.decision_reason = decision_reason || null
  must(await sb.from('applications').update(patch).eq('id', r.id))
  const updated = must(await sb.from('applications').select('*').eq('id', r.id).maybeSingle())
  res.json(rowToApplication(updated))
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
  // Feed the candidate's already-computed match fit (résumé + role) into the
  // review AI as a prior, so the employer's scoring reasons from it instead of
  // re-deriving fit from scratch.
  const matchContext = r.match_score != null
    ? { score: r.match_score, rationale: r.match_rationale ?? null }
    : null
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
  res.json(rowToApplication(updated))
})

// Records a proctor integrity violation (e.g. camera/mic denied, a second person
// detected, the candidate left frame, loud noise, excessive movement) so the
// candidate can't re-take the test for this job. We store a cancelled
// application row: the already-applied guard treats any non-draft status as
// final, so re-applying is blocked and the employer sees the cancellation.
applications.post('/proctor-cancel', async (req, res) => {
  const { job_id, reason } = req.body ?? {}
  if (!job_id) return res.status(400).json({ error: 'missing_job' })
  const job = must(await sb.from('job_listings').select('id').eq('id', job_id).maybeSingle())
  if (!job) return res.status(404).json({ error: 'job_not_found' })
  const existing = must(await sb.from('applications').select('*').eq('student_id', req.user!.id).eq('job_id', job_id).maybeSingle()) as any
  if (existing) return res.json(rowToApplication(existing))
  const profile = must(await sb.from('profiles').select('full_name,email,school,year').eq('id', req.user!.id).maybeSingle()) as any
  const id = uid('a')
  const ts = now()
  must(await sb.from('applications').insert({
    id,
    student_id: req.user!.id,
    job_id,
    status: 'cancelled',
    assignment_status: 'cancelled',
    full_name: profile?.full_name ?? '',
    email: profile?.email ?? '',
    school: profile?.school ?? null,
    year: profile?.year ?? null,
    timeline: j.stringify([{ status: 'cancelled', at: ts, reason: reason ?? 'violation' }]),
    created_at: ts,
  }))
  const created = must(await sb.from('applications').select('*').eq('id', id).maybeSingle())
  res.json(rowToApplication(created))
})

applications.delete('/:id', async (req, res) => {
  const r = must(await sb.from('applications').select('student_id').eq('id', req.params.id).maybeSingle()) as any
  if (!r) return res.status(404).json({ error: 'not_found' })
  if (r.student_id !== req.user!.id) return res.status(403).json({ error: 'forbidden' })
  must(await sb.from('applications').delete().eq('id', req.params.id))
  res.json({ ok: true })
})
