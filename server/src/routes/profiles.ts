import { Router } from '@/lib/http'
import { sb, must, j } from '@/db'
import { requireAuth } from '@/lib/auth'
import { rowToProfile } from '@/lib/serialize'
import { refreshStudentEnrichment } from '@/lib/enrich'
import { schoolHiddenFrom, visibilityColsExist } from '@/lib/visibility'

export const profiles = Router()
profiles.use(requireAuth)

profiles.get('/', async (req, res) => {
  const type = req.query.type as string | undefined
  let q = sb.from('profiles').select('*').order('created_at', { ascending: false })
  if (type) q = q.eq('user_type', type)
  const rows = must(await q) as any[]
  // Hide private schools from viewers outside their student domains.
  const viewer = must(await sb.from('profiles').select('*').eq('id', req.user!.id).maybeSingle()) as any
  res.json(rows.filter((r) => !schoolHiddenFrom(r, viewer)).map(rowToProfile))
})

profiles.get('/:id', async (req, res) => {
  const r = must(await sb.from('profiles').select('*').eq('id', req.params.id).maybeSingle()) as any
  if (!r) return res.status(404).json({ error: 'not_found' })
  if (req.user!.id !== r.id) {
    const viewer = must(await sb.from('profiles').select('*').eq('id', req.user!.id).maybeSingle()) as any
    if (schoolHiddenFrom(r, viewer)) return res.status(404).json({ error: 'not_found' })
  }
  res.json(rowToProfile(r))
})

const EDITABLE = [
  'full_name', 'avatar_url', 'cover_url', 'bio', 'school', 'major', 'year', 'location',
  'linkedin', 'github', 'twitter', 'website', 'cv_filename', 'cv_uploaded_at', 'cv_text', 'cv_url',
  'work_type', 'location_pref', 'company_name', 'industry', 'company_size',
] as const
const ARRAY_FIELDS = ['desired_roles', 'preferred_industries', 'skills'] as const
const BOOL_FIELDS = ['open_to_internship', 'open_to_fulltime'] as const
// Changes to these invalidate the student's cached matches (spec §8.1 trigger).
const MATCH_AFFECTING = new Set(['cv_text', 'skills', 'desired_roles', 'preferred_industries', 'work_type', 'major', 'bio'])

// cv_url (the résumé file) is added by migration 0007. Detect its presence so
// updates don't fail before the migration is run — and pick it up once it is.
let hasCvUrlCol = false
async function cvUrlColExists(): Promise<boolean> {
  if (hasCvUrlCol) return true
  const { error } = await sb.from('profiles').select('cv_url').limit(1)
  hasCvUrlCol = !error
  return hasCvUrlCol
}

profiles.patch('/:id', async (req, res) => {
  if (req.params.id !== req.user!.id) return res.status(403).json({ error: 'forbidden' })
  const b = req.body ?? {}
  const update: Record<string, any> = {}
  let affectsMatch = false

  const cvUrlOk = await cvUrlColExists()
  for (const f of EDITABLE) {
    if (!(f in b)) continue
    if (f === 'cv_url' && !cvUrlOk) continue // skip until migration 0007 is run
    update[f] = b[f] ?? null
    if (MATCH_AFFECTING.has(f)) affectsMatch = true
  }
  for (const f of ARRAY_FIELDS) if (f in b) { update[f] = j.stringify(b[f] ?? []); if (MATCH_AFFECTING.has(f)) affectsMatch = true }
  for (const f of BOOL_FIELDS) if (f in b) { update[f] = b[f] ? 1 : 0 }

  // School domain/privacy fields (migration 0011) — only persisted once present.
  if (('student_domains' in b || 'is_private' in b) && (await visibilityColsExist())) {
    if ('student_domains' in b) update.student_domains = j.stringify(b.student_domains ?? [])
    if ('is_private' in b) update.is_private = b.is_private ? 1 : 0
  }

  if (Object.keys(update).length) must(await sb.from('profiles').update(update).eq('id', req.params.id))
  if (affectsMatch) {
    must(await sb.from('ai_match_cache').update({ stale: 1 }).eq('student_id', req.params.id))
    // Re-parse the résumé + recompute the embedding in the background so the next
    // match scores on fresh evidence. Best-effort: the lazy parse in the matcher
    // covers it if this hasn't finished yet.
    refreshStudentEnrichment(req.params.id).catch(() => {})
  }

  const r = must(await sb.from('profiles').select('*').eq('id', req.params.id).maybeSingle())
  res.json(rowToProfile(r))
})
