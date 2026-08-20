import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  Briefcase,
  CheckCircle2,
  FileText,
  Sparkles,
  TrendingUp,
  Users,
  Crown,
  Eye,
  Send,
  Clock,
  GraduationCap,
} from 'lucide-react'
import { useCurrentUser } from '@/lib/store'
import { applicationsApi, followsApi, jobsApi, profilesApi } from '@/lib/api'
import { useMatchProgress } from '@/lib/matchProgress'
import type { AiMatch, Application, JobListing, Profile } from '@/types'
import { Card, CardBody, Badge, Avatar, Progress, Skeleton } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { ScoreRing } from '@/components/ScoreRing'
import { formatDate, daysUntil } from '@/lib/utils'
import { perf } from '@/lib/perf'

// Recharts-backed analytics is heavy and only used for the company view — load
// it on demand so students never download the charting bundle on the dashboard.
const Analytics = lazy(() => import('@/pages/company/Analytics'))

export default function Dashboard() {
  const user = useCurrentUser()
  if (!user) return null
  return user.user_type === 'student' ? (
    <StudentDashboard user={user} />
  ) : (
    <Suspense fallback={<div className="py-20 text-center text-sm text-muted-foreground">Loading analytics…</div>}>
      <Analytics />
    </Suspense>
  )
}

/* ============================ STUDENT ============================ */

const statusTone = {
  pending: 'default',
  reviewed: 'primary',
  shortlisted: 'accent',
  hired: 'success',
  rejected: 'danger',
} as const

function StudentDashboard({ user }: { user: Profile }) {
  const [jobs, setJobs] = useState<JobListing[]>([])
  const [apps, setApps] = useState<Application[]>([])
  const [companies, setCompanies] = useState<Record<string, Profile>>({})
  const [following, setFollowing] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    perf('StudentDashboard mounted', { userId: user.id })
    const dataStart = performance.now()
    ;(async () => {
      const [j, a, cs, myFollows] = await Promise.all([
        jobsApi.list(user),
        applicationsApi.byStudent(user.id),
        profilesApi.list('company'),
        followsApi.forStudent(user.id),
      ])
      const schoolList = await profilesApi.list('school')
      const map: Record<string, Profile> = {}
      ;[...cs, ...schoolList].forEach((c) => (map[c.id] = c))
      if (!active) return
      setJobs(j)
      setApps(a)
      setCompanies(map)
      setFollowing(new Set(myFollows.map((f) => f.company_id)))
      setLoading(false)
      const ms = Math.round((performance.now() - dataStart) * 10) / 10
      perf('dashboard DATA READY', { jobs: j.length, apps: a.length, companies: cs.length, ms })
    })()

    // Kick off AI matching only once the browser is idle, so it never competes
    // with the dashboard's first paint / data load. The runner itself is
    // idempotent, so navigating back reuses the same scores.
    const startMatching = () => {
      if (!active) return
      perf('idle callback fired → starting AI matching')
      const mStart = performance.now()
      void useMatchProgress
        .getState()
        .run(user.id)
        .then(() => {
          const ms = Math.round((performance.now() - mStart) * 10) / 10
          perf('AI matching COMPLETE', { ms })
        })
        .catch(() => perf('AI matching FAILED'))
    }
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback
    let idleId: number
    if (ric) {
      idleId = ric(startMatching, { timeout: 2000 })
    } else {
      idleId = window.setTimeout(startMatching, 1200)
    }
    return () => {
      active = false
      const cic = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback
      if (ric && cic) cic(idleId)
      else clearTimeout(idleId)
    }
  }, [user.id])

  // Match scores from the shared store (same source as Jobs & Insights).
  const storeMatches = useMatchProgress((s) => s.matches)
  const matches = useMemo(() => [...storeMatches].sort((a, b) => b.score - a.score), [storeMatches])

  // Log once the match scores actually land (Top Picks can render).
  useEffect(() => {
    if (storeMatches.length > 0) {
      perf('dashboard MATCHES READY', { count: storeMatches.length })
    }
  }, [storeMatches])

  const completeness = useMemo(() => profileCompleteness(user), [user])
  const gaps = useMemo(() => profileGaps(user), [user])
  const topPicks = matches.slice(0, 3)

  // Roles the student hasn't applied to that are about to close — nudges action.
  const closingSoon = useMemo(() => {
    const applied = new Set(apps.map((a) => a.job_id))
    return jobs
      .filter((j) => !applied.has(j.id))
      .map((j) => ({ job: j, dl: daysUntil(j.deadline) }))
      .filter((x): x is { job: JobListing; dl: number } => x.dl !== null && x.dl >= 0 && x.dl <= 10)
      .sort((a, b) => a.dl - b.dl)
      .slice(0, 3)
  }, [jobs, apps])

  // Application pipeline: count per stage.
  const pipeline = useMemo(() => {
    const stages: { key: Application['status']; label: string; dot: string }[] = [
      { key: 'pending', label: 'Pending', dot: 'bg-muted-foreground/50' },
      { key: 'reviewed', label: 'Reviewed', dot: 'bg-primary' },
      { key: 'shortlisted', label: 'Shortlisted', dot: 'bg-accent' },
      { key: 'hired', label: 'Hired', dot: 'bg-success' },
    ]
    return stages.map((s) => ({ ...s, count: apps.filter((a) => a.status === s.key).length }))
  }, [apps])

  // Fresh roles from companies the student follows that they haven't applied to.
  const followedRoles = useMemo(() => {
    if (!following.size) return []
    const applied = new Set(apps.map((a) => a.job_id))
    return jobs
      .filter((j) => following.has(j.company_id) && !applied.has(j.id))
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
      .slice(0, 3)
  }, [jobs, apps, following])

  const stats = [
    { label: 'Applications', value: apps.length, icon: FileText, to: '/app/applications' },
    {
      label: 'Shortlisted',
      value: apps.filter((a) => a.status === 'shortlisted' || a.status === 'hired').length,
      icon: CheckCircle2,
      to: '/app/applications',
    },
    { label: 'Open roles', value: jobs.length, icon: Briefcase, to: '/app/jobs' },
    {
      label: 'Avg match',
      value: matches.length ? Math.round(matches.reduce((s, m) => s + m.score, 0) / matches.length) : 0,
      icon: TrendingUp,
      to: '/app/insights',
    },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-sm text-muted-foreground">{greeting()},</p>
          <h1 className="text-2xl font-bold tracking-tight">{user.full_name.split(' ')[0]} 👋</h1>
        </div>
        <div className="flex items-center gap-2">
          {user.plan === 'free' ? (
            <Link to="/app/usage">
              <Button variant="subtle" className="gap-1.5">
                <Crown className="h-4 w-4" /> View usage
              </Button>
            </Link>
          ) : (
            <Badge tone="primary" className="gap-1">
              <Crown className="h-3 w-3" /> {user.plan.toUpperCase()}
            </Badge>
          )}
          <Link to="/app/jobs">
            <Button className="gap-1.5">
              Browse jobs <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
            <Link to={s.to}>
              <Card className="transition-shadow hover:shadow-card">
                <CardBody className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/12 text-primary">
                    <s.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold leading-none text-accent">
                      {loading ? <Skeleton className="h-8 w-12" /> : s.value}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{s.label}</p>
                  </div>
                </CardBody>
              </Card>
            </Link>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* AI Top Picks */}
        <div className="lg:col-span-2">
          <SectionHeader
            icon={Sparkles}
            title="AI Top Picks for you"
            action={<Link to="/app/insights" className="text-sm font-medium text-primary hover:underline">View all matches</Link>}
          />
          <div className="space-y-3">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => <MatchSkeleton key={i} />)
            ) : topPicks.length === 0 ? (
              <TopPicksEmpty hasCv={!!(user.cv_text || user.cv_filename)} />
            ) : (
              topPicks.map((m) => {
                const job = jobs.find((j) => j.id === m.job_id)!
                const company = companies[job.company_id]
                return <MatchRow key={m.job_id} job={job} match={m} company={company} />
              })
            )}
          </div>

          {/* Application pipeline */}
          {!loading && apps.length > 0 && (
            <Card className="mt-6">
              <CardBody>
                <h3 className="mb-3 flex items-center gap-2 font-semibold">
                  <TrendingUp className="h-4 w-4 text-primary" /> Application pipeline
                </h3>
                <div className="grid grid-cols-4 gap-2">
                  {pipeline.map((s) => (
                    <div key={s.key} className="rounded-xl border border-border p-3 text-center">
                      <p className="text-xl font-bold leading-none text-accent">{s.count}</p>
                      <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} /> {s.label}
                      </p>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}
        </div>

        {/* Right rail */}
        <div className="space-y-6">
          {/* Profile completeness */}
          <Card>
            <CardBody>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold">Profile strength</h3>
                <span className="text-sm font-bold text-accent">{completeness}%</span>
              </div>
              <Progress value={completeness} />
              {gaps.length > 0 ? (
                <>
                  <p className="mt-3 text-xs text-muted-foreground">Finish these to improve your match accuracy:</p>
                  <div className="mt-2 space-y-1.5">
                    {gaps.slice(0, 3).map((g) => (
                      <Link
                        key={g.label}
                        to={g.to}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:border-primary/40 hover:bg-muted/50"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <g.icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <span className="truncate">{g.label}</span>
                        </span>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </Link>
                    ))}
                  </div>
                </>
              ) : (
                <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Fully complete — nice work!
                </p>
              )}
              <Link to="/app/profile">
                <Button variant="outline" size="sm" className="mt-4 w-full">
                  Edit profile
                </Button>
              </Link>
            </CardBody>
          </Card>

          {/* Placeholder cards while the first data load is in flight, so the
              right rail doesn't jump around once Closing soon / Followed load. */}
          {loading && (
            <>
              <Card>
                <CardBody>
                  <Skeleton className="mb-3 h-4 w-32" />
                  <div className="space-y-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                </CardBody>
              </Card>
              <Card>
                <CardBody>
                  <Skeleton className="mb-3 h-4 w-32" />
                  <div className="space-y-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                </CardBody>
              </Card>
            </>
          )}

          {/* Closing soon */}
          {!loading && closingSoon.length > 0 && (
            <Card>
              <CardBody>
                <h3 className="mb-3 flex items-center gap-2 font-semibold">
                  <Clock className="h-4 w-4 text-warning" /> Closing soon
                </h3>
                <div className="space-y-1">
                  {closingSoon.map(({ job, dl }) => (
                    <Link
                      key={job.id}
                      to={`/app/jobs?job=${job.id}`}
                      className="-mx-2 flex items-center justify-between gap-2 rounded-lg p-2 hover:bg-muted"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{job.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{job.original_company_name || companies[job.company_id]?.company_name}</p>
                      </div>
                      <Badge tone={dl <= 3 ? 'danger' : 'warning'} className="shrink-0">
                        {dl === 0 ? 'Today' : `${dl}d`}
                      </Badge>
                    </Link>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}

          {/* From companies you follow */}
          {!loading && followedRoles.length > 0 && (
            <Card>
              <CardBody>
                <h3 className="mb-3 flex items-center gap-2 font-semibold">
                  <Users className="h-4 w-4 text-primary" /> From companies you follow
                </h3>
                <div className="space-y-1">
                  {followedRoles.map((job) => (
                    <Link
                      key={job.id}
                      to={`/app/jobs?job=${job.id}`}
                      className="-mx-2 flex items-center gap-3 rounded-lg p-2 hover:bg-muted"
                    >
                      <Avatar name={job.original_company_name || companies[job.company_id]?.company_name} src={job.original_company_logo_url || companies[job.company_id]?.avatar_url} size={32} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{job.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{job.original_company_name || companies[job.company_id]?.company_name} · {job.location}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}

          {/* Recent applications */}
          <Card>
            <CardBody>
              <h3 className="mb-3 font-semibold">Recent applications</h3>
              {apps.length === 0 ? (
                <p className="text-sm text-muted-foreground">No applications yet.</p>
              ) : (
                <div className="space-y-3">
                  {apps.slice(0, 3).map((a) => {
                    const job = jobs.find((j) => j.id === a.job_id)
                    return (
                      <Link
                        key={a.id}
                        to={`/app/applications/${a.id}`}
                        className="flex items-center justify-between gap-2 rounded-lg p-2 -mx-2 hover:bg-muted"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{job?.title ?? 'Role'}</p>
                          <p className="text-xs text-muted-foreground">{formatDate(a.created_at)}</p>
                        </div>
                        <Badge tone={statusTone[a.status]} className="capitalize">
                          {a.status}
                        </Badge>
                      </Link>
                    )
                  })}
                </div>
              )}
              <Link to="/app/applications">
                <Button variant="ghost" size="sm" className="mt-3 w-full">
                  View all
                </Button>
              </Link>
            </CardBody>
          </Card>
        </div>
      </div>

    </div>
  )
}

function MatchRow({
  job,
  match,
  company,
}: {
  job: JobListing
  match: AiMatch
  company?: Profile
}) {
  const dl = daysUntil(job.deadline)
  return (
    <Card className="transition-shadow hover:shadow-card">
      <CardBody className="flex items-center gap-4">
        <Link to={`/app/jobs?job=${job.id}`}>
          <ScoreRing score={match.score} size={58} showLabel />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link to={`/app/jobs?job=${job.id}`} className="truncate font-semibold hover:text-primary">
              {job.title}
            </Link>
            {job.posted_by_role === 'school' && <Badge tone="accent">School</Badge>}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
            <Link to={`/app/companies/${job.company_id}`} className="flex min-w-0 items-center gap-2 hover:text-primary">
              <Avatar name={job.original_company_name || company?.company_name} src={job.original_company_logo_url || company?.avatar_url} size={18} />
              <span className="truncate hover:underline">{job.original_company_name || company?.company_name}</span>
            </Link>
            <span>·</span>
            <span className="truncate">{job.location}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {match.matched_skills.slice(0, 3).map((s) => (
              <Badge key={s} tone="success" className="text-[11px]">
                {s}
              </Badge>
            ))}
            {dl !== null && dl <= 14 && (
              <Badge tone="warning" className="text-[11px]">
                {dl <= 0 ? 'Closing' : `${dl}d left`}
              </Badge>
            )}
          </div>
          {match.reasons[0] && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
              <span className="line-clamp-1">{match.reasons[0]}</span>
            </p>
          )}
        </div>
        <Link to="/app/research" className="hidden shrink-0 sm:block">
          <Button variant="outline" size="sm" className="gap-1.5">
            <Sparkles className="h-4 w-4 text-primary" /> AI Research
          </Button>
        </Link>
      </CardBody>
    </Card>
  )
}

function MatchSkeleton() {
  return (
    <Card>
      <CardBody className="flex items-center gap-4">
        <div className="skeleton h-14 w-14 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </CardBody>
    </Card>
  )
}

function TopPicksEmpty({ hasCv }: { hasCv: boolean }) {
  return (
    <Card>
      <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/12 text-primary">
          <Sparkles className="h-6 w-6" />
        </div>
        {hasCv ? (
          <>
            <p className="font-medium">No matches just yet</p>
            <p className="max-w-xs text-sm text-muted-foreground">As new roles are posted, your best-fit picks will show up here.</p>
            <Link to="/app/jobs"><Button size="sm" className="gap-1.5">Browse all roles <ArrowRight className="h-4 w-4" /></Button></Link>
          </>
        ) : (
          <>
            <p className="font-medium">Upload your CV to unlock matches</p>
            <p className="max-w-xs text-sm text-muted-foreground">Your CV is the strongest signal our AI uses to find roles that fit you.</p>
            <Link to="/app/profile"><Button size="sm" className="gap-1.5"><FileText className="h-4 w-4" /> Upload your CV</Button></Link>
          </>
        )}
      </CardBody>
    </Card>
  )
}

/* ============================ shared ============================ */

function SectionHeader({ icon: Icon, title, action }: { icon: typeof Sparkles; title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        <Icon className="h-5 w-5 text-primary" /> {title}
      </h2>
      {action}
    </div>
  )
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function profileCompleteness(u: Profile) {
  const checks = [u.full_name, u.bio, u.major, u.year, u.cv_text, u.skills?.length, u.desired_roles?.length, u.linkedin]
  const done = checks.filter(Boolean).length
  return Math.round((done / checks.length) * 100)
}

// Specific missing profile items, surfaced as one-tap actions on the dashboard.
// CV first — it's the strongest matching signal.
function profileGaps(u: Profile): { label: string; to: string; icon: typeof FileText }[] {
  const gaps: { label: string; to: string; icon: typeof FileText }[] = []
  if (!u.cv_text && !u.cv_filename) gaps.push({ label: 'Upload your CV', to: '/app/profile', icon: FileText })
  if (!u.skills?.length) gaps.push({ label: 'Add your skills', to: '/app/profile', icon: Sparkles })
  if (!u.desired_roles?.length) gaps.push({ label: 'Add desired roles', to: '/app/profile', icon: Briefcase })
  if (!u.bio) gaps.push({ label: 'Write a short bio', to: '/app/profile', icon: FileText })
  if (!u.major) gaps.push({ label: 'Add your major', to: '/app/profile', icon: GraduationCap })
  if (!u.year) gaps.push({ label: 'Add your study year', to: '/app/profile', icon: GraduationCap })
  if (!u.linkedin) gaps.push({ label: 'Link your LinkedIn', to: '/app/profile', icon: Users })
  return gaps
}
