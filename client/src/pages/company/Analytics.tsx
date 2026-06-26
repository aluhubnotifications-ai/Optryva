import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Briefcase, Users, Star, TrendingUp, UserCheck, Eye } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'
import { useCurrentUser } from '@/lib/store'
import { applicationsApi, followsApi, jobsApi } from '@/lib/api'
import type { Application, JobListing } from '@/types'
import { Card, CardBody, Skeleton } from '@/components/ui/primitives'

export default function Analytics() {
  const user = useCurrentUser()!
  const [jobs, setJobs] = useState<JobListing[]>([])
  const [apps, setApps] = useState<Application[]>([])
  const [opens, setOpens] = useState<Record<string, number>>({})
  const [followers, setFollowers] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      const [j, a, f, o] = await Promise.all([
        jobsApi.byCompany(user.id),
        applicationsApi.byCompany(user.id),
        followsApi.followerCount(user.id),
        jobsApi.openCounts(),
      ])
      setJobs(j); setApps(a); setFollowers(f); setOpens(o); setLoading(false)
    })()
  }, [user])

  // External listings apply off-platform, so their engagement is "views" (opens
  // of the apply link), not applications received here.
  const totalViews = jobs.reduce((sum, j) => (j.apply_url ? sum + (opens[j.id] ?? 0) : sum), 0)

  const shortlisted = apps.filter((a) => a.status === 'shortlisted' || a.status === 'hired').length
  const hired = apps.filter((a) => a.status === 'hired').length
  const pending = apps.filter((a) => a.status === 'pending').length
  const shortlistRate = apps.length ? Math.round((shortlisted / apps.length) * 100) : 0

  const kpis = [
    { label: 'Active listings', value: jobs.filter((j) => j.status === 'active').length, icon: Briefcase },
    { label: 'Followers', value: followers, icon: UserCheck },
    { label: 'Total applications', value: apps.length, icon: Users },
    { label: 'External views', value: totalViews, icon: Eye },
    { label: 'Shortlist rate', value: `${shortlistRate}%`, icon: Star },
    { label: 'Shortlisted', value: shortlisted, icon: TrendingUp },
  ]

  const funnel = [
    { stage: 'Applications', value: apps.length },
    { stage: 'Pending', value: pending },
    { stage: 'Shortlisted', value: shortlisted },
    { stage: 'Hired', value: hired },
  ]

  // 6-week trend
  const trend = useMemo(() => {
    const weeks = Array.from({ length: 6 }, (_, i) => ({ week: `W${i + 1}`, value: 0 }))
    const now = Date.now()
    apps.forEach((a) => {
      const diffWeeks = Math.floor((now - +new Date(a.created_at)) / (7 * 86400000))
      if (diffWeeks >= 0 && diffWeeks < 6) weeks[5 - diffWeeks].value += 1
    })
    return weeks
  }, [apps])

  const perListing = jobs.map((j) => ({
    name: j.title.length > 18 ? j.title.slice(0, 18) + '…' : j.title,
    applications: apps.filter((a) => a.job_id === j.id).length,
    shortlisted: apps.filter((a) => a.job_id === j.id && (a.status === 'shortlisted' || a.status === 'hired')).length,
  }))

  if (loading) return <div className="space-y-4"><Skeleton className="h-8 w-48" /><div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <Card key={i}><CardBody><Skeleton className="h-10 w-full" /></CardBody></Card>)}</div></div>

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><BarChart3 className="h-6 w-6 text-primary" /> Analytics</h1>
        <p className="text-sm text-muted-foreground">Performance across your listings.</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardBody>
              <k.icon className="mb-2 h-5 w-5 text-primary" />
              <p className="text-2xl font-bold leading-none">{k.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{k.label}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Hiring funnel */}
        <Card>
          <CardBody>
            <h2 className="mb-4 font-semibold">Hiring funnel</h2>
            <div className="space-y-3">
              {funnel.map((f) => {
                const pct = funnel[0].value ? Math.round((f.value / funnel[0].value) * 100) : 0
                return (
                  <div key={f.stage}>
                    <div className="mb-1 flex justify-between text-sm"><span className="text-muted-foreground">{f.stage}</span><span className="font-semibold text-accent">{f.value}</span></div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /></div>
                  </div>
                )
              })}
            </div>
          </CardBody>
        </Card>

        {/* 6-week trend */}
        <Card>
          <CardBody>
            <h2 className="mb-4 font-semibold">Applications · last 6 weeks</h2>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="week" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 }} cursor={{ fill: 'hsl(var(--muted))' }} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]} fill="hsl(var(--primary))" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Per-listing */}
      <Card>
        <CardBody>
          <h2 className="mb-4 font-semibold">Per-listing breakdown</h2>
          {perListing.length === 0 ? (
            <p className="text-sm text-muted-foreground">No listings yet.</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={perListing} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} interval={0} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 }} cursor={{ fill: 'hsl(var(--muted))' }} />
                  <Bar dataKey="applications" radius={[6, 6, 0, 0]} fill="hsl(var(--primary))" />
                  <Bar dataKey="shortlisted" radius={[6, 6, 0, 0]} fill="hsl(var(--accent))">
                    {perListing.map((_, i) => <Cell key={i} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
