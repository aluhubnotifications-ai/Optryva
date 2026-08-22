import { Router } from '@/lib/http'
import { sb, must, j } from '@/db'
import { requireAuth } from '@/lib/auth'
import { rowToProfile } from '@/lib/serialize'
import { refreshStudentEnrichment, hasResumeCols } from '@/lib/enrich'
import { extractDocumentText } from '@/lib/claude'
import { documentUrl, storeDocument, validateDocumentUrl } from '@/lib/documents'
import { schoolHiddenFrom, visibilityColsExist, parseDomains } from '@/lib/visibility'
import { cacheGet, cacheSet } from '@/lib/cache'

export const profiles = Router()
profiles.use(requireAuth)

// Lean column set for list views — the private cv_* columns are never needed by
// list/directory callers (and cv_text can be very large), so excluding them
// keeps the payload small and the parse fast. Full rows are still served by the
// single-profile PATCH/GET-by-id paths.
const LIST_COLUMNS =
  'id,user_type,full_name,email,avatar_url,cover_url,bio,school,major,year,location,country,linkedin,github,twitter,website,desired_roles,preferred_industries,work_type,location_pref,open_to_internship,open_to_fulltime,pref_listing_types,pref_countries,monitoring_consent,skills,company_name,industry,company_size,student_domains,is_private,posted_by_role,plan,plan_activated_at,created_at'

profiles.get('/', async (req, res) => {
  const type = req.query.type as string | undefined
  // Optional `types` fetches several user_types in one scan (e.g. company+school).
  const typesRaw = req.query.types as string | undefined
  const types = typesRaw ? typesRaw.split(',').filter(Boolean) : null
  // Optional `ids` lets callers (e.g. the dashboard) fetch only the specific
  // profiles they need instead of scanning the whole directory table.
  const idsRaw = req.query.ids as string | undefined
  const ids = idsRaw ? idsRaw.split(',').filter(Boolean) : null
  // Pagination: callers load a page at a time instead of the entire directory.
  const limitRaw = req.query.limit as string | undefined
  const offsetRaw = req.query.offset as string | undefined
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 60, 1), 200) : null
  const offset = offsetRaw ? Math.max(parseInt(offsetRaw, 10) || 0, 0) : 0
  const cacheKey = `profiles:${type ?? 'all'}:${types ? types.join(',') : ''}:${ids ? ids.join(',') : 'all'}:${limit ?? ''}:${offset}`
  const cached = cacheGet<any[]>(cacheKey)
  if (cached) return res.json(cached)
  let q = sb.from('profiles').select(LIST_COLUMNS).order('created_at', { ascending: false })
  if (type) q = q.eq('user_type', type)
  if (types) q = q.in('user_type', types)
  if (ids) q = q.in('id', ids)
  if (limit != null) q = q.range(offset, offset + limit - 1)
  const rows = must(await q) as any[]
  // Hide private schools from viewers outside their student domains.
  const viewer = must(await sb.from('profiles').select('id,user_type,email,student_domains,is_private').eq('id', req.user!.id).maybeSingle()) as any
  const payload = rows.filter((r) => !schoolHiddenFrom(r, viewer)).map((r) => rowToProfile(r))
  cacheSet(cacheKey, payload, 20_000)
  res.json(payload)
})

profiles.get('/:id', async (req, res) => {
  const r = must(await sb.from('profiles').select('*').eq('id', req.params.id).maybeSingle()) as any
  if (!r) return res.status(404).json({ error: 'not_found' })
  if (req.user!.id !== r.id) {
    const viewer = must(await sb.from('profiles').select('*').eq('id', req.user!.id).maybeSingle()) as any
    if (schoolHiddenFrom(r, viewer)) return res.status(404).json({ error: 'not_found' })
  }
  res.json(rowToProfile(r, req.user!.id === r.id))
})

const EDITABLE = [
  'full_name', 'avatar_url', 'cover_url', 'bio', 'school', 'major', 'year', 'location', 'country', 'gpa',
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
let hasCvStorageCol = false
async function cvUrlColExists(): Promise<boolean> {
  if (hasCvUrlCol) return true
  const { error } = await sb.from('profiles').select('cv_url').limit(1)
  hasCvUrlCol = !error
  return hasCvUrlCol
}

async function cvStorageColExists(): Promise<boolean> {
  if (hasCvStorageCol) return true
  const { error } = await sb.from('profiles').select('cv_storage_path').limit(1)
  if (!error) hasCvStorageCol = true
  return !error
}

// pref_listing_types / pref_countries arrive with migration 0013 — detect once so
// saves don't 500 on a schema that hasn't been migrated yet.
let hasPrefCols = false
async function prefColsExist(): Promise<boolean> {
  if (hasPrefCols) return true
  const { error } = await sb.from('profiles').select('pref_listing_types').limit(1)
  hasPrefCols = !error
  return hasPrefCols
}

// monitoring_consent arrives with migration 0014 (opt-in outcome tracking).
let hasConsentCol = false
async function consentColExists(): Promise<boolean> {
  if (hasConsentCol) return true
  const { error } = await sb.from('profiles').select('monitoring_consent').limit(1)
  hasConsentCol = !error
  return hasConsentCol
}

profiles.patch('/:id', async (req, res) => {
  if (req.params.id !== req.user!.id) return res.status(403).json({ error: 'forbidden' })
  const b = req.body ?? {}
  const update: Record<string, any> = {}
  let affectsMatch = false
  const incomingCvUrl = typeof b.cv_url === 'string' && b.cv_url.startsWith('data:') ? b.cv_url : null

  if (incomingCvUrl) {
    const documentError = validateDocumentUrl(b.cv_url)
    if (documentError) return res.status(400).json({ error: documentError })
    if (!await cvStorageColExists()) return res.status(503).json({ error: 'document_storage_unavailable' })
    const stored = await storeDocument(req.user!.id, 'cv', b.cv_filename ?? 'resume', incomingCvUrl)
    update.cv_url = documentUrl(stored.path)
    update.cv_storage_path = stored.path
  }

  const cvUrlOk = await cvUrlColExists()
  for (const f of EDITABLE) {
    if (!(f in b)) continue
    if (f === 'cv_url' && !cvUrlOk) continue // skip until migration 0007 is run
    if (f === 'cv_url' && incomingCvUrl) continue
    update[f] = b[f] ?? null
    if (MATCH_AFFECTING.has(f)) affectsMatch = true
  }
  for (const f of ARRAY_FIELDS) if (f in b) { update[f] = j.stringify(b[f] ?? []); if (MATCH_AFFECTING.has(f)) affectsMatch = true }
  for (const f of BOOL_FIELDS) if (f in b) { update[f] = b[f] ? 1 : 0 }

  // A new résumé file arrived but the client didn't send extracted text → pull the
  // plain text out of the PDF so the AI (chat, matches, insights) can read it.
  if (cvUrlOk && incomingCvUrl && !(b.cv_text ?? '').trim()) {
    const text = await extractDocumentText(incomingCvUrl)
    if (text) { update.cv_text = text; affectsMatch = true }
  }

  // Removing the résumé (client clears cv_url / cv_text) → also drop the derived
  // resume_profile + extracted text, so the AI doesn't keep matching on a CV the
  // student deleted (and the "needs a résumé" gate fires again).
  const clearingCv = ('cv_url' in b && !b.cv_url) || ('cv_text' in b && !(b.cv_text ?? '').trim())
  if (clearingCv) {
    update.cv_text = null
    if (await cvStorageColExists()) update.cv_storage_path = null
    affectsMatch = true
    if (await hasResumeCols()) update.resume_profile = null
  }

  // Opportunity-type / country preferences (migration 0013) — these change WHICH
  // jobs the matcher considers, not any single job's score, so no cache bust.
  if (('pref_listing_types' in b || 'pref_countries' in b) && (await prefColsExist())) {
    if ('pref_listing_types' in b) update.pref_listing_types = j.stringify(b.pref_listing_types ?? [])
    if ('pref_countries' in b) update.pref_countries = j.stringify(b.pref_countries ?? [])
  }

  // Opt-in outcome monitoring (migration 0014). Default off; the student controls it.
  if ('monitoring_consent' in b && (await consentColExists())) {
    update.monitoring_consent = b.monitoring_consent ? 1 : 0
  }

  // School domain/privacy fields (migration 0011) — only persisted once present.
  if (('student_domains' in b || 'is_private' in b) && (await visibilityColsExist())) {
    // A private school with no domains is invisible to everyone (incl. its own
    // students and the messaging UI), so refuse to save that state. The school
    // must name at least one student email domain before going private.
    const cur = must(
      await sb.from('profiles').select('user_type, is_private, student_domains').eq('id', req.user!.id).maybeSingle(),
    ) as any
    const willPrivate = 'is_private' in b ? (b.is_private ? 1 : 0) : (cur?.is_private ?? 0)
    const domainsRaw = 'student_domains' in b ? (b.student_domains ?? []) : (cur?.student_domains ?? [])
    if (cur?.user_type === 'school' && willPrivate === 1 && parseDomains(domainsRaw).length === 0) {
      return res.status(400).json({
        error: 'private_requires_domains',
        message: 'A private school must list at least one student email domain (student_domains).',
      })
    }
    if ('student_domains' in b) update.student_domains = j.stringify(domainsRaw)
    if ('is_private' in b) update.is_private = willPrivate
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
  res.json(rowToProfile(r, true))
})
