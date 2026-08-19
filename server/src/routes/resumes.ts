import { Router } from '@/lib/http'
import { sb, must, j } from '@/db'
import { requireAuth } from '@/lib/auth'
import { uid, now } from '@/lib/util'

export const resumes = Router()
resumes.use(requireAuth)

const arrays = ['target_roles', 'preferred_industries', 'pref_countries', 'pref_listing_types', 'skills'] as const
const editable = ['name', 'work_type', 'cv_filename', 'cv_url', 'active'] as const

function rowToResume(r: any) {
  return {
    id: r.id,
    student_id: r.student_id,
    name: r.name,
    target_roles: j.parse<string[]>(r.target_roles, []),
    preferred_industries: j.parse<string[]>(r.preferred_industries, []),
    pref_countries: j.parse<string[]>(r.pref_countries, []),
    pref_listing_types: j.parse<any[]>(r.pref_listing_types, []),
    skills: j.parse<string[]>(r.skills, []),
    work_type: r.work_type ?? 'any',
    cv_filename: r.cv_filename ?? undefined,
    cv_url: r.cv_url ?? undefined,
    active: r.active === 1 || r.active === true,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

function owned(id: string, studentId: string) {
  return sb.from('resume_profiles').select('*').eq('id', id).eq('student_id', studentId).maybeSingle()
}

resumes.get('/', async (req, res) => {
  const rows = must(await sb.from('resume_profiles').select('*').eq('student_id', req.user!.id).order('created_at', { ascending: true })) as any[]
  res.json(rows.map(rowToResume))
})

resumes.post('/', async (req, res) => {
  if (req.user!.user_type !== 'student') return res.status(403).json({ error: 'students_only' })
  const b = req.body ?? {}
  const name = String(b.name ?? '').trim()
  if (!name) return res.status(400).json({ error: 'name_required' })
  const ts = now()
  const id = uid('resume')
  const row: Record<string, any> = {
    id,
    student_id: req.user!.id,
    name,
    work_type: b.work_type ?? 'any',
    cv_filename: b.cv_filename ?? null,
    cv_url: b.cv_url ?? null,
    active: b.active === false ? 0 : 1,
    created_at: ts,
    updated_at: ts,
  }
  for (const field of arrays) row[field] = j.stringify(Array.isArray(b[field]) ? b[field] : [])
  must(await sb.from('resume_profiles').insert(row))
  const created = must(await owned(id, req.user!.id))
  res.json(rowToResume(created))
})

resumes.patch('/:id', async (req, res) => {
  const current = must(await owned(req.params.id, req.user!.id)) as any
  if (!current) return res.status(404).json({ error: 'not_found' })
  const b = req.body ?? {}
  const update: Record<string, any> = { updated_at: now() }
  for (const field of editable) if (field in b) update[field] = field === 'active' ? (b[field] ? 1 : 0) : (b[field] ?? null)
  for (const field of arrays) if (field in b) update[field] = j.stringify(Array.isArray(b[field]) ? b[field] : [])
  if ('name' in b && !String(b.name ?? '').trim()) return res.status(400).json({ error: 'name_required' })
  must(await sb.from('resume_profiles').update(update).eq('id', req.params.id).eq('student_id', req.user!.id))
  const updated = must(await owned(req.params.id, req.user!.id))
  res.json(rowToResume(updated))
})

resumes.delete('/:id', async (req, res) => {
  const current = must(await owned(req.params.id, req.user!.id)) as any
  if (!current) return res.status(404).json({ error: 'not_found' })
  must(await sb.from('resume_profiles').delete().eq('id', req.params.id).eq('student_id', req.user!.id))
  res.json({ ok: true })
})
