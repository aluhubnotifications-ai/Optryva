import { Router } from '@/lib/http'
import { sb, must, j } from '@/db'
import { requireAuth } from '@/lib/auth'
import { rowToJob } from '@/lib/serialize'
import { uid, now, notify } from '@/lib/util'
import { embedJob } from '@/lib/enrich'
import { jobVisibleTo, schoolGates } from '@/lib/visibility'

export const jobs = Router()
jobs.use(requireAuth)

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
  res.json({ ok: true })
})

jobs.get('/', async (req, res) => {
  const viewer = must(await sb.from('profiles').select('*').eq('id', req.user!.id).maybeSingle()) as any
  const rows = must(await sb.from('job_listings').select('*').eq('status', 'active').order('created_at', { ascending: false })) as any[]
  const gates = await schoolGates(rows.map((r) => r.company_id))
  res.json(rows.filter((r) => jobVisibleTo(r, viewer, gates)).map(rowToJob))
})

jobs.get('/company/:companyId', async (req, res) => {
  const rows = must(await sb.from('job_listings').select('*').eq('company_id', req.params.companyId).order('created_at', { ascending: false })) as any[]
  // The owner manages all of its listings (incl. drafts/closed); everyone else
  // only sees what the domain/privacy/year/school gates allow.
  if (req.user!.id === req.params.companyId) return res.json(rows.map(rowToJob))
  const viewer = must(await sb.from('profiles').select('*').eq('id', req.user!.id).maybeSingle()) as any
  const gates = await schoolGates([req.params.companyId])
  res.json(rows.filter((r) => jobVisibleTo(r, viewer, gates)).map(rowToJob))
})

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
  must(await sb.from('job_listings').delete().eq('id', req.params.id))
  res.json({ ok: true })
})
