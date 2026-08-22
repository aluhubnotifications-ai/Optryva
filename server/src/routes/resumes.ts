import { Router } from '@/lib/http'
import { sb, must, j } from '@/db'
import { requireAuth } from '@/lib/auth'
import { uid, now } from '@/lib/util'
import { documentUrl, pathFromToken, storeDocument, validateDocumentUrl } from '@/lib/documents'

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

async function storageColumnExists(): Promise<boolean> {
  const { error } = await sb.from('resume_profiles').select('cv_storage_path').limit(1)
  return !error
}

function ownedDocumentPath(value: unknown, ownerId: string): string | null {
  if (typeof value !== 'string') return null
  let pathname = value
  try { pathname = new URL(value).pathname } catch { /* relative URL */ }
  if (!pathname.startsWith('/api/documents/')) return null
  const path = pathFromToken(pathname.slice('/api/documents/'.length))
  return path && path.startsWith(`${ownerId}/`) ? path : null
}

resumes.get('/', async (req, res) => {
  let rows = must(await sb.from('resume_profiles').select('*').eq('student_id', req.user!.id).order('created_at', { ascending: true })) as any[]
  // Convert the legacy profile into the first ordinary résumé direction once.
  // This is deliberately local to résumé storage: it must not invalidate or
  // rerun matching for the already-scored profile.
  if (!rows.length && req.user!.user_type === 'student') {
    const profile = must(await sb.from('profiles').select('*').eq('id', req.user!.id).maybeSingle()) as any
    if (profile) {
      const ts = now()
      const first = {
        id: uid('resume'),
        student_id: req.user!.id,
        name: 'Resume 1',
        target_roles: profile.desired_roles ?? '[]',
        preferred_industries: profile.preferred_industries ?? '[]',
        pref_countries: profile.pref_countries ?? '[]',
        pref_listing_types: profile.pref_listing_types ?? '[]',
        skills: profile.skills ?? '[]',
        work_type: profile.work_type ?? 'any',
        cv_filename: profile.cv_filename ?? null,
        cv_url: profile.cv_url ?? null,
        cv_storage_path: profile.cv_storage_path ?? null,
        active: 1,
        created_at: ts,
        updated_at: ts,
      }
      must(await sb.from('resume_profiles').insert(first))
      rows = [first]
    }
  }
  res.json(rows.map(rowToResume))
})

resumes.post('/', async (req, res) => {
  if (req.user!.user_type !== 'student') return res.status(403).json({ error: 'students_only' })
  const b = req.body ?? {}
  const name = String(b.name ?? '').trim()
  if (!name) return res.status(400).json({ error: 'name_required' })
  const existingPath = ownedDocumentPath(b.cv_url, req.user!.id)
  if (b.cv_url && !existingPath) {
    const documentError = validateDocumentUrl(b.cv_url, b.cv_filename)
    if (documentError) return res.status(400).json({ error: documentError })
  }
  const ts = now()
  const id = uid('resume')
  const row: Record<string, any> = {
    id,
    student_id: req.user!.id,
    name,
    work_type: b.work_type ?? 'any',
    cv_filename: b.cv_filename ?? null,
    cv_url: existingPath ? documentUrl(existingPath) : null,
    active: b.active === false ? 0 : 1,
    created_at: ts,
    updated_at: ts,
  }
  if (existingPath) {
    row.cv_storage_path = existingPath
  } else if (b.cv_url) {
    if (!await storageColumnExists()) return res.status(503).json({ error: 'document_storage_unavailable' })
    const stored = await storeDocument(req.user!.id, 'resume', b.cv_filename ?? 'resume', b.cv_url)
    row.cv_url = documentUrl(stored.path)
    row.cv_storage_path = stored.path
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
  const existingPath = ownedDocumentPath(b.cv_url, req.user!.id)
  if ('cv_url' in b && b.cv_url) {
    const documentError = existingPath ? null : validateDocumentUrl(b.cv_url, b.cv_filename)
    if (documentError) return res.status(400).json({ error: documentError })
    if (!await storageColumnExists()) return res.status(503).json({ error: 'document_storage_unavailable' })
    if (existingPath) {
      update.cv_url = documentUrl(existingPath)
      update.cv_storage_path = existingPath
    } else {
      const stored = await storeDocument(req.user!.id, 'resume', b.cv_filename ?? current.cv_filename ?? 'resume', b.cv_url)
      update.cv_url = documentUrl(stored.path)
      update.cv_storage_path = stored.path
    }
  }
  for (const field of editable) if (field in b && !(field === 'cv_url' && b.cv_url)) update[field] = field === 'active' ? (b[field] ? 1 : 0) : (b[field] ?? null)
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
