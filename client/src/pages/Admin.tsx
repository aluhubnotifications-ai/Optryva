import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck, Users, GraduationCap, Building2, Coins, Trash2, Search, FileText, ExternalLink } from 'lucide-react'
import { adminApi, type AdminData, type AdminUserRow, type AdminApplication } from '@/lib/api'
import type { Plan } from '@/types'
import { Card, CardBody, Badge, Avatar, Skeleton, Input } from '@/components/ui/primitives'
import { DancingMascot } from '@/components/DancingMascot'
import { formatDate } from '@/lib/utils'

const MODEL_LABEL: Record<string, string> = {
  'claude-opus-4-8': 'Opus 4.8',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-haiku-4-5': 'Haiku 4.5',
}
const labelFor = (id: string) => MODEL_LABEL[id] ?? id
const fmt = (n: number) => n.toLocaleString()
const PLAN_OPTIONS: Plan[] = ['free', 'pro', 'premium']

const typeTone: Record<string, 'primary' | 'accent' | 'success'> = { student: 'primary', company: 'accent', school: 'success' }
const statusTone: Record<string, 'default' | 'primary' | 'accent' | 'success' | 'danger'> = {
  pending: 'default', reviewed: 'primary', shortlisted: 'accent', hired: 'success', rejected: 'danger',
}
const isOrg = (t: string) => t === 'company' || t === 'school'

/** Admin dashboard (/admin) — gated to admins. Everyone's AI usage, the app's
 *  users (each linked to their own profile), and applications to each org. */
export default function Admin() {
  const [data, setData] = useState<AdminData | null>(null)
  const [apps, setApps] = useState<AdminApplication[] | null>(null)
  const [query, setQuery] = useState('')
  const [orgFilter, setOrgFilter] = useState('all')
  const [busy, setBusy] = useState<string | null>(null)

  const load = () => Promise.all([adminApi.data().then(setData), adminApi.applications().then(setApps)])
  useEffect(() => { load() }, [])

  const loading = data === null

  const users = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    const rows = q
      ? data.users.filter((u) => u.full_name.toLowerCase().includes(q) || (u.company_name ?? '').toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.user_type.includes(q))
      : data.users
    return [...rows].sort((a, b) => b.credits - a.credits || b.applications - a.applications)
  }, [data, query])

  // Orgs that have at least one application, for the Applications filter dropdown.
  const orgOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const a of apps ?? []) if (a.org_id) map.set(a.org_id, a.org_name)
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [apps])

  const filteredApps = useMemo(() => {
    if (!apps) return []
    return orgFilter === 'all' ? apps : apps.filter((a) => a.org_id === orgFilter)
  }, [apps, orgFilter])

  async function setPlan(u: AdminUserRow, plan: Plan) {
    if (plan === u.plan) return
    setBusy(u.id)
    try { await adminApi.setPlan(u.id, plan); await load() } finally { setBusy(null) }
  }
  async function clearUsage(u: AdminUserRow) {
    if (!confirm(`Clear all recorded AI usage for ${u.full_name}? This only deletes usage data.`)) return
    setBusy(u.id)
    try { await adminApi.clearUsage(u.id); await load() } finally { setBusy(null) }
  }

  const cards = data
    ? [
        { icon: Users, label: 'Total users', value: fmt(data.counts.total) },
        { icon: Building2, label: 'Companies / schools', value: fmt(data.counts.companies + data.counts.schools) },
        { icon: FileText, label: 'Applications', value: fmt(data.counts.applications) },
        { icon: Coins, label: 'Credits used', value: fmt(data.totals.credits), hint: `≈ $${data.totals.cost_usd.toFixed(2)}` },
      ]
    : []

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <ShieldCheck className="h-6 w-6 text-primary" /> Admin
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Everyone's AI usage, your app users (open each profile), and applications to each company / school.</p>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardBody className="space-y-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-7 w-2/3" /></CardBody></Card>
          ))}
        </div>
      ) : (
        <>
          {/* Overview */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map((c) => (
              <Card key={c.label}>
                <CardBody>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground"><c.icon className="h-4 w-4 text-primary" /> {c.label}</div>
                  <p className="mt-1 text-2xl font-bold tabular-nums">{c.value}</p>
                  {c.hint && <p className="text-xs text-muted-foreground">{c.hint}</p>}
                </CardBody>
              </Card>
            ))}
          </div>

          {/* Overall usage by model */}
          {data!.models.length > 0 && (
            <>
              <h2 className="mb-3 mt-8 text-lg font-semibold">Usage by model (all users)</h2>
              <Card>
                <CardBody className="overflow-x-auto p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-3 font-medium">Model</th>
                        <th className="px-4 py-3 text-right font-medium">Input</th>
                        <th className="px-4 py-3 text-right font-medium">Output</th>
                        <th className="px-4 py-3 text-right font-medium">Calls</th>
                        <th className="px-4 py-3 text-right font-medium">Credits</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data!.models.map((m) => (
                        <tr key={m.model} className="border-b border-border/60 last:border-0">
                          <td className="px-4 py-3 font-medium">{labelFor(m.model)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{fmt(m.input_tokens)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{fmt(m.output_tokens)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{fmt(m.calls)}</td>
                          <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmt(m.credits)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardBody>
              </Card>
            </>
          )}

          {/* Users */}
          <div className="mb-3 mt-8 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">App users</h2>
            <div className="relative w-64 max-w-[60%]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search users…" className="h-9 pl-9" />
            </div>
          </div>

          {!data!.usageAvailable && (
            <p className="mb-3 text-xs text-muted-foreground">Usage metering not active yet — run migration 0015 to populate credits.</p>
          )}

          <Card>
            <CardBody className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-medium">User</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Activity</th>
                    <th className="px-4 py-3 text-right font-medium">Credits</th>
                    <th className="px-4 py-3 font-medium">Plan</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={u.company_name || u.full_name} src={u.avatar_url ?? undefined} size={28} />
                          <div className="min-w-0">
                            {/* Every user — student, company, school — links to their OWN profile. */}
                            <Link to={`/app/u/${u.id}`} className="flex items-center gap-1 truncate font-medium hover:text-primary">
                              {u.company_name || u.full_name} <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                            </Link>
                            <p className="truncate text-xs text-muted-foreground">{u.email} · joined {formatDate(u.created_at)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3"><Badge tone={typeTone[u.user_type] ?? 'primary'} className="capitalize">{u.user_type}</Badge></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {isOrg(u.user_type)
                          ? <span>{fmt(u.jobs)} jobs · {fmt(u.applications)} apps</span>
                          : <span>{fmt(u.applications)} applications</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmt(u.credits)}</td>
                      <td className="px-4 py-3">
                        <select
                          value={PLAN_OPTIONS.includes(u.plan) ? u.plan : 'free'}
                          disabled={busy === u.id}
                          onChange={(e) => setPlan(u, e.target.value as Plan)}
                          className="h-8 rounded-lg border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {PLAN_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {busy === u.id && <DancingMascot size={16} />}
                          <button
                            onClick={() => clearUsage(u)}
                            disabled={busy === u.id || u.calls === 0}
                            title="Clear this user's usage data"
                            className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-danger/40 hover:text-danger disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Usage
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">No users match your search.</td></tr>
                  )}
                </tbody>
              </table>
            </CardBody>
          </Card>

          {/* Applications — to each company / school */}
          <div className="mb-3 mt-8 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Applications</h2>
            <select
              value={orgFilter}
              onChange={(e) => setOrgFilter(e.target.value)}
              className="h-9 max-w-[60%] rounded-lg border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="all">All companies & schools ({fmt((apps ?? []).length)})</option>
              {orgOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </div>

          <Card>
            <CardBody className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Applicant</th>
                    <th className="px-4 py-3 font-medium">Role</th>
                    <th className="px-4 py-3 font-medium">Organization</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Applied</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredApps.map((a) => (
                    <tr key={a.id} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-3">
                        {/* Opens the applicant's profile + submission (ApplicantView). */}
                        <Link to={`/app/applicants/${a.id}`} className="flex items-center gap-2 font-medium hover:text-primary">
                          <Avatar name={a.applicant_name} src={a.avatar_url ?? undefined} size={26} />
                          <span className="truncate">{a.applicant_name}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-3"><Link to={`/app/jobs?job=${a.job_id}`} className="hover:text-primary">{a.job_title}</Link></td>
                      <td className="px-4 py-3">
                        {a.org_id
                          ? <Link to={`/app/companies/${a.org_id}`} className="hover:text-primary">{a.org_name}</Link>
                          : <span className="text-muted-foreground">{a.org_name}</span>}
                      </td>
                      <td className="px-4 py-3"><Badge tone={statusTone[a.status] ?? 'default'} className="capitalize">{a.status}</Badge></td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{formatDate(a.created_at)}</td>
                    </tr>
                  ))}
                  {filteredApps.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-muted-foreground">No applications {orgFilter === 'all' ? 'yet' : 'for this organization'}.</td></tr>
                  )}
                </tbody>
              </table>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}
