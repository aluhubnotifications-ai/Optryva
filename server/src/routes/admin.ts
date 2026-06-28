import { Router } from '@/lib/http'
import { sb, must } from '@/db'
import { now } from '@/lib/util'
import { requireAuth } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin'
import { getUsageByUser, type UserUsage } from '@/lib/usage'

export const admin = Router()
admin.use(requireAuth)
admin.use(requireAdmin)

const VALID_PLANS = ['free', 'pro', 'premium'] as const
const ZERO: UserUsage = { user_id: '', input_tokens: 0, output_tokens: 0, calls: 0, cost_usd: 0, credits: 0 }

// One call powers the admin dashboard: every app user joined with their AI usage,
// their own jobs/applications counts, plus overall per-model totals.
admin.get('/data', async (_req, res) => {
  const usage = await getUsageByUser()
  const profiles = (must(
    await sb.from('profiles').select('id, full_name, email, user_type, plan, avatar_url, company_name, created_at').order('created_at', { ascending: false }),
  ) as any[]) ?? []
  const jobRows = (must(await sb.from('job_listings').select('id, company_id')) as any[]) ?? []
  const appRows = (must(await sb.from('applications').select('job_id, student_id')) as any[]) ?? []

  // Each org posts under its OWN profile (job.company_id === org id); count jobs
  // and the applications made to those jobs, per org. Students: their own apps.
  const orgOfJob = new Map<string, string>(jobRows.map((j) => [j.id, j.company_id]))
  const jobsByOrg = new Map<string, number>()
  for (const j of jobRows) jobsByOrg.set(j.company_id, (jobsByOrg.get(j.company_id) ?? 0) + 1)
  const appsByOrg = new Map<string, number>()
  const appsByStudent = new Map<string, number>()
  for (const a of appRows) {
    const org = orgOfJob.get(a.job_id)
    if (org) appsByOrg.set(org, (appsByOrg.get(org) ?? 0) + 1)
    if (a.student_id) appsByStudent.set(a.student_id, (appsByStudent.get(a.student_id) ?? 0) + 1)
  }

  const users = profiles.map((p) => {
    const u = usage.byUser[p.id] ?? ZERO
    const isOrg = p.user_type === 'company' || p.user_type === 'school'
    return {
      id: p.id,
      full_name: p.full_name,
      email: p.email,
      user_type: p.user_type,
      plan: p.plan ?? 'free',
      avatar_url: p.avatar_url ?? null,
      company_name: p.company_name ?? null,
      created_at: p.created_at,
      jobs: isOrg ? jobsByOrg.get(p.id) ?? 0 : 0,
      applications: isOrg ? appsByOrg.get(p.id) ?? 0 : appsByStudent.get(p.id) ?? 0,
      input_tokens: u.input_tokens,
      output_tokens: u.output_tokens,
      calls: u.calls,
      credits: u.credits,
    }
  })

  const counts = users.reduce<Record<string, number>>((acc, u) => {
    acc[u.user_type] = (acc[u.user_type] ?? 0) + 1
    return acc
  }, {})

  res.json({
    usageAvailable: usage.available,
    counts: { total: users.length, students: counts.student ?? 0, companies: counts.company ?? 0, schools: counts.school ?? 0, applications: appRows.length },
    totals: usage.totals,
    models: usage.models,
    users,
  })
})

// Every application across the platform, joined to the applicant, the role, and
// the org it was posted under — so admin can see applications to each company/school.
admin.get('/applications', async (_req, res) => {
  const apps = (must(
    await sb.from('applications').select('id, student_id, job_id, full_name, email, status, created_at').order('created_at', { ascending: false }),
  ) as any[]) ?? []
  const jobIds = [...new Set(apps.map((a) => a.job_id))]
  const studentIds = [...new Set(apps.map((a) => a.student_id))]
  const jobs = jobIds.length ? ((must(await sb.from('job_listings').select('id, title, company_id').in('id', jobIds)) as any[]) ?? []) : []
  const orgIds = [...new Set(jobs.map((j) => j.company_id))]
  const orgs = orgIds.length ? ((must(await sb.from('profiles').select('id, full_name, company_name, user_type').in('id', orgIds)) as any[]) ?? []) : []
  const students = studentIds.length ? ((must(await sb.from('profiles').select('id, full_name, avatar_url').in('id', studentIds)) as any[]) ?? []) : []

  const jobById = new Map(jobs.map((j) => [j.id, j]))
  const orgById = new Map(orgs.map((o) => [o.id, o]))
  const studentById = new Map(students.map((s) => [s.id, s]))

  const rows = apps.map((a) => {
    const job = jobById.get(a.job_id)
    const org = job ? orgById.get(job.company_id) : null
    const student = studentById.get(a.student_id)
    return {
      id: a.id,
      student_id: a.student_id,
      applicant_name: student?.full_name ?? a.full_name,
      applicant_email: a.email,
      avatar_url: student?.avatar_url ?? null,
      job_id: a.job_id,
      job_title: job?.title ?? 'Removed role',
      org_id: org?.id ?? null,
      org_name: org?.company_name ?? org?.full_name ?? 'Unknown org',
      org_type: org?.user_type ?? null,
      status: a.status,
      created_at: a.created_at,
    }
  })
  res.json({ applications: rows })
})

// Action: change a user's plan.
admin.post('/users/:id/plan', async (req, res) => {
  const plan = String(req.body?.plan ?? '')
  if (!VALID_PLANS.includes(plan as any)) return res.status(400).json({ error: 'invalid_plan' })
  const r = must(await sb.from('profiles').select('id').eq('id', req.params.id).maybeSingle()) as any
  if (!r) return res.status(404).json({ error: 'not_found' })
  must(await sb.from('profiles').update({ plan, plan_activated_at: plan === 'free' ? null : now() }).eq('id', req.params.id))
  res.json({ ok: true, plan })
})

// Action: wipe a user's recorded AI usage (data only — resets their meter).
admin.post('/users/:id/clear-usage', async (req, res) => {
  await sb.from('ai_usage').delete().eq('user_id', req.params.id)
  res.json({ ok: true })
})
