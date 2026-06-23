import { Router } from '@/lib/http'
import { sb, must, j } from '@/db'
import { requireAuth } from '@/lib/auth'
import { rowToApplication } from '@/lib/serialize'
import { uid, now, notify } from '@/lib/util'

export const applications = Router()
applications.use(requireAuth)

applications.get('/mine', async (req, res) => {
  const rows = must(await sb.from('applications').select('*').eq('student_id', req.user!.id).order('created_at', { ascending: false })) as any[]
  res.json(rows.map(rowToApplication))
})

applications.get('/job/:jobId', async (req, res) => {
  const rows = must(await sb.from('applications').select('*').eq('job_id', req.params.jobId).order('created_at', { ascending: false })) as any[]
  res.json(rows.map(rowToApplication))
})

applications.get('/company', async (req, res) => {
  const jobs = must(await sb.from('job_listings').select('id').eq('company_id', req.user!.id)) as any[]
  const ids = jobs.map((j2) => j2.id)
  if (!ids.length) return res.json([])
  const rows = must(await sb.from('applications').select('*').in('job_id', ids).order('created_at', { ascending: false })) as any[]
  res.json(rows.map(rowToApplication))
})

applications.get('/:id', async (req, res) => {
  const r = must(await sb.from('applications').select('*').eq('id', req.params.id).maybeSingle())
  if (!r) return res.status(404).json({ error: 'not_found' })
  res.json(rowToApplication(r))
})

applications.post('/', async (req, res) => {
  const b = req.body ?? {}
  const job = must(await sb.from('job_listings').select('*').eq('id', b.job_id).maybeSingle()) as any
  if (!job) return res.status(404).json({ error: 'job_not_found' })
  const dup = must(await sb.from('applications').select('id').eq('student_id', req.user!.id).eq('job_id', b.job_id).maybeSingle())
  if (dup) return res.status(409).json({ error: 'already_applied' })

  const id = uid('a')
  const ts = now()
  must(await sb.from('applications').insert({
    id, student_id: req.user!.id, job_id: b.job_id, status: 'pending',
    cover_note: b.cover_note ?? null, documents: j.stringify(b.documents ?? []),
    full_name: b.full_name, email: b.email, phone: b.phone ?? null,
    school: b.school ?? null, year: b.year ?? null, linkedin: b.linkedin ?? null,
    timeline: j.stringify([{ status: 'applied', at: ts }]), created_at: ts,
  }))
  await notify(job.company_id, 'new_application', 'New application received', `${b.full_name} applied to ${job.title}`, id)
  const created = must(await sb.from('applications').select('*').eq('id', id).maybeSingle())
  res.json(rowToApplication(created))
})

applications.patch('/:id/status', async (req, res) => {
  const { status } = req.body ?? {}
  const r = must(await sb.from('applications').select('*').eq('id', req.params.id).maybeSingle()) as any
  if (!r) return res.status(404).json({ error: 'not_found' })
  const job = must(await sb.from('job_listings').select('title').eq('id', r.job_id).maybeSingle()) as any
  const timeline = j.parse<any[]>(r.timeline, [])
  timeline.push({ status, at: now() })
  must(await sb.from('applications').update({ status, timeline: j.stringify(timeline) }).eq('id', r.id))
  await notify(r.student_id, 'status_change', `Application update: ${status}`, `Your application for ${job?.title ?? 'a role'} is now ${status}.`, r.id)
  const updated = must(await sb.from('applications').select('*').eq('id', r.id).maybeSingle())
  res.json(rowToApplication(updated))
})

applications.delete('/:id', async (req, res) => {
  const r = must(await sb.from('applications').select('student_id').eq('id', req.params.id).maybeSingle()) as any
  if (!r) return res.status(404).json({ error: 'not_found' })
  if (r.student_id !== req.user!.id) return res.status(403).json({ error: 'forbidden' })
  must(await sb.from('applications').delete().eq('id', req.params.id))
  res.json({ ok: true })
})
