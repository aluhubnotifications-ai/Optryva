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
   Clock,
  GraduationCap,
  Target,
  Loader2,
} from 'lucide-react'
import { useCurrentUser } from '@/lib/store'
import { applicationsApi, followsApi, jobsApi } from '@/lib/api'
import { useMatchProgress } from '@/lib/matchProgress'
import { profileCompletion } from '@/lib/onboarding'
import { NudgeModal, type NudgeItem } from '@/components/NudgeModal'
import type { AiMatch, Application, JobListing, Profile } from '@/types'
import { Card, CardBody, Badge, Avatar, Progress, Skeleton } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
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
    <Suspense
      fallback={
        <div className="flex flex-col items-center gap-3 py-24 text-muted-foreground">
          <Spinner className="h-6 w-6" />
          <p className="text-sm">Loading your analytics…</p>
        </div>
      }
    >
      <Analytics />
    </Suspense>
  )
}

/* ============================ STUDENT ============================ */

const statusTone = {
  draft: 'outline',
  pending: 'default',
  reviewed: 'primary',
  shortlisted: 'accent',
  hired: 'success',
  rejected: 'danger',
  cancelled: 'danger',
  withdrawn: 'outline',
} as const

function StudentDashboard({ user }: { user: Profile }) {
  const [jobs, setJobs] = useState<JobListing[]>([])
  const [apps, setApps] = useState<Application[]>([])
  const [following, setFollowing] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  // Post-onboarding nudge: the router sends users who HAVEN'T finished onboarding
  // back into the wizard, so by the time we're here the required steps are done.
  // This only surfaces the still-missing *important optional* items (portfolio,
  // preferences, skills…) as a friendly animated modal.
  // Re-shown on every login: this state resets when the Dashboard mounts (i.e. on
  // each fresh login / page load), so the reminder always comes back until the
  // student has actually completed the important optional items.
  const [nudgeHidden, setNudgeHidden] = useState(false)
  const nudgeItems = useMemo<NudgeItem[]>(() => {
    const map: Record<string, { label: string; cta: string; to: string }> = {
      work: { label: 'Set your work preferences', cta: 'Add', to: '/app/profile?focus=preferences' },
      skills: { label: 'Add your skills', cta: 'Add', to: '/app/profile?focus=preferences' },
      resume: { label: 'Upload your résumé', cta: 'Add', to: '/app/profile?tab=resumes' },
      evidence: { label: 'Build your portfolio & evidence', cta: 'Add', to: '/app/profile?tab=gallery' },
      bio: { label: 'Write a short bio', cta: 'Add', to: '/app/profile?focus=about' },
    }
    const c = profileCompletion(user)
    return Object.entries(map)
      .filter(([k]) => {
        const step = [...c.required, ...c.optional].find((s) => s.key === k)
        return step ? !step.done : false
      })
      .map(([k, v]) => ({ key: k, ...v }))
  }, [user])
  const showNudge = !nudgeHidden && nudgeItems.length > 0

  useEffect(() => {
    let active = true
    perf('StudentDashboard mounted', { userId: user.id })
    const dataStart = performance.now()
    ;(async () => {
      // Jobs now carry company_name + company_avatar_url, so the dashboard no
      // longer needs a separate directory fetch — just jobs + apps + follows.
      const [j, a, myFollows] = await Promise.all([
        jobsApi.list(user),
        applicationsApi.byStudent(user.id),
        followsApi.forStudent(user.id),
      ])
      if (!active) return
      setJobs(j)
      setApps(a)
      setFollowing(new Set(myFollows.map((f) => f.company_id)))
      setLoading(false)
      const ms = Math.round((performance.now() - dataStart) * 10) / 10
      perf('dashboard DATA READY', { jobs: j.length, apps: a.length, ms })
    })()

    // Kick off AI matching only once the browser is idle, so it never competes
    // with the dashboard's first paint / data load. The runner itself is
    // idempotent, so navigating back reuses the same scores.
    void useMatchProgress.getState().hydrate(user.id)

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
  const matchPhase = useMatchProgress((s) => s.phase)
  const matchDone = useMatchProgress((s) => s.done)
  const matchTotal = useMatchProgress((s) => s.total)
  const matches = useMemo(() => [...storeMatches].sort((a, b) => b.score - a.score), [storeMatches])

  // Log once the match scores actually land (Top Picks can render).
  useEffect(() => {
    if (storeMatches.length > 0) {
      perf('dashboard MATCHES READY', { count: storeMatches.length })
    }
  }, [storeMatches])

  const completeness = useMemo(() => profileCompleteness(user), [user])
  const gaps = useMemo(() => profileGaps(user), [user])
  const hasCv = !!(user.cv_text || user.cv_filename)
  const topPicks = matches.slice(0, 6)

  // Roles the student hasn't applied to that are about to close — nudges action.
  const closingSoon = useMemo(() => {
    const applied = new Set(apps.map((a) => a.job_id))
    return jobs
      .filter((j) => !applied.has(j.id))
      .map((j) => ({ job: j, dl: daysUntil(j.deadline) }))
      .filter((x): x is { job: JobListing; dl: number } => x.dl !== null && x.dl >= 0 && x.dl <= 10)
      .sort((a, b) => a.dl - b.dl)
      .slice(0, 4)
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
      .slice(0, 4)
  }, [jobs, apps, following])

  const stats = [
    {
      label: 'Applications',
      value: apps.length,
      icon: FileText,
      to: '/app/applications',
      sub: jobs.length ? `${jobs.length} open roles` : 'No open roles',
    },
    {
      label: 'Shortlisted',
      value: apps.filter((a) => a.status === 'shortlisted' || a.status === 'hired').length,
      icon: CheckCircle2,
      to: '/app/applications',
      sub: apps.length ? `${apps.length} applied` : 'No applications',
    },
    { label: 'Open roles', value: jobs.length, icon: Briefcase, to: '/app/jobs', sub: 'Live now' },
    {
      label: 'Avg match',
      value: matches.length ? Math.round(matches.reduce((s, m) => s + m.score, 0) / matches.length) : 0,
      icon: TrendingUp,
      to: '/app/insights',
      sub: matches.length ? `${matches.length} scored` : 'Pending',
    },
  ]

  return (
    <div className="space-y-6">
      {showNudge && <NudgeModal items={nudgeItems} onClose={() => setNudgeHidden(true)} />}
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s, i) => (
          <motion.div key={s.label} className="min-w-0" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
            <Link to={s.to} className="group block">
              <Card className="relative transition-all hover:border-primary/25 hover:shadow-card active:scale-[.99]">
                <CardBody className="flex items-center gap-2.5 p-4 sm:gap-3 sm:p-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary sm:h-11 sm:w-11">
                    <s.icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-2xl font-bold leading-none text-accent">
                      {loading ? <Skeleton className="h-8 w-12" /> : s.value}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{s.label}</p>
                    {!loading && <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">{s.sub}</p>}
                  </div>
                  <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
                </CardBody>
              </Card>
            </Link>
          </motion.div>
        ))}
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {/* AI Top Picks — horizontal, scannable */}
          <section>
            <SectionHeader
              icon={Sparkles}
              title="AI Top Picks for you"
              action={<Link to="/app/insights" className="text-sm font-medium text-primary hover:underline">View all matches</Link>}
            />
            {loading ? (
              <div className="-mx-1 flex gap-3 overflow-hidden pb-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <MatchSkeleton key={i} />
                ))}
              </div>
            ) : matchPhase === 'running' ? (
              <TopPicksLoading done={matchDone} total={matchTotal} />
            ) : topPicks.length === 0 ? (
              <TopPicksEmpty hasCv={hasCv} />
            ) : (
              <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
                {topPicks.map((m) => {
                  const job = jobs.find((j) => j.id === m.job_id)!
                  return <MatchCard key={m.job_id} job={job} match={m} />
                })}
              </div>
            )}
          </section>

          {/* Application pipeline */}
          {!loading && apps.length > 0 && (
            <Card>
              <CardBody>
                <h3 className="mb-3 flex items-center gap-2 font-semibold">
                  <TrendingUp className="h-4 w-4 text-primary" /> Application pipeline
                </h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {pipeline.map((s) => (
                    <div key={s.key} className="rounded-xl border border-border p-2.5 text-center sm:p-3">
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

          {/* Recent applications */}
          <Card>
            <CardBody>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold">Recent applications</h3>
                <Link to="/app/applications" className="text-sm font-medium text-primary hover:underline">View all</Link>
              </div>
              {apps.length === 0 ? (
                <p className="text-sm text-muted-foreground">No applications yet — your applied roles will appear here.</p>
              ) : (
                <div className="space-y-3">
                  {apps.slice(0, 4).map((a) => {
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
            </CardBody>
          </Card>
        </div>

        {/* Right rail */}
        <div className="min-w-0 space-y-6">
          {/* Profile strength (slim) */}
          <Card>
            <CardBody>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold">Profile strength</h3>
                <span className="text-sm font-bold text-accent">{completeness}%</span>
              </div>
              <Progress value={completeness} />
              <p className="mt-3 text-xs text-muted-foreground">
                {completeness === 100
                  ? 'Fully complete — nice work!'
                  : `Finish your profile to get more accurate matches.`}
              </p>
              <Link to="/app/profile">
                <Button variant="outline" size="sm" className="mt-4 w-full">
                  Edit profile
                </Button>
              </Link>
            </CardBody>
          </Card>

          {/* Opportunities — consolidates Closing soon + Following */}
          <Card>
            <CardBody className="space-y-4">
              <h3 className="font-semibold">Opportunities</h3>
              {!loading && closingSoon.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Closing soon</p>
                  <div className="space-y-1">
                    {closingSoon.map(({ job, dl }) => (
                      <Link
                        key={job.id}
                        to={`/app/jobs?job=${job.id}`}
                        className="-mx-2 flex items-center justify-between gap-2 rounded-lg p-2 hover:bg-muted"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{job.title}</p>
                          <p className="truncate text-xs text-muted-foreground">{job.original_company_name || job.company_name}</p>
                        </div>
                        <Badge tone={dl <= 3 ? 'danger' : 'warning'} className="shrink-0">
                          {dl === 0 ? 'Today' : `${dl}d`}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              {!loading && followedRoles.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">From companies you follow</p>
                  <div className="space-y-1">
                    {followedRoles.map((job) => (
                      <Link
                        key={job.id}
                        to={`/app/jobs?job=${job.id}`}
                        className="-mx-2 flex items-center gap-3 rounded-lg p-2 hover:bg-muted"
                      >
                        <Avatar name={job.original_company_name || job.company_name} src={job.original_company_logo_url || job.company_avatar_url} size={32} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{job.title}</p>
                          <p className="truncate text-xs text-muted-foreground">{job.original_company_name || job.company_name} · {job.location}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              {!loading && closingSoon.length === 0 && followedRoles.length === 0 && (
                <p className="text-sm text-muted-foreground">Nothing urgent right now — check back later.</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}

/* ============================ new blocks ============================ */

// Hero banner (profile picture + browse jobs) removed per user request

// NextBestAction promotional banner removed per user request

// Compact, reason-led match card for the horizontal Top Picks row.
function MatchCard({ job, match }: { job: JobListing; match: AiMatch }) {
  const dl = daysUntil(job.deadline)
  const company = job.original_company_name || job.company_name
  return (
    <Link to={`/app/jobs?job=${job.id}`} className="group relative w-[calc(100vw-3rem)] max-w-[280px] shrink-0 snap-start sm:w-[280px]">
      <Card className="h-[300px] transition-shadow hover:shadow-card">
        <CardBody className="flex h-full flex-col gap-2.5 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Avatar name={company} src={job.original_company_logo_url || job.company_avatar_url} size={24} />
              <span className="truncate text-xs text-muted-foreground">{company}</span>
            </div>
            <ScoreRing score={match.score} size={40} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight group-hover:text-primary">{job.title}</p>
            <p className="truncate text-xs text-muted-foreground">{job.location}</p>
          </div>
          {match.reasons[0] && (
            <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground line-clamp-3">
              <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
              <span className="min-w-0">{match.reasons[0]}</span>
            </p>
          )}
          <div className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-1">
            <div className="flex min-w-0 flex-1 flex-wrap gap-1">
              {match.matched_skills.slice(0, 2).map((s) => (
                <Badge key={s} tone="success" className="max-w-[160px] truncate whitespace-nowrap text-[11px]">
                  {s}
                </Badge>
              ))}
              {dl !== null && dl <= 14 && (
                <Badge tone="warning" className="text-[11px]">
                  {dl <= 0 ? 'Closing' : `${dl}d left`}
                </Badge>
              )}
            </div>
            <span className="shrink-0 text-xs font-medium text-primary group-hover:underline">View more →</span>
          </div>
        </CardBody>
      </Card>
    </Link>
  )
}

function MatchSkeleton() {
  return (
    <div className="w-[calc(100vw-3rem)] max-w-[280px] shrink-0 sm:w-[280px]">
      <Card className="h-[300px]">
        <CardBody className="flex h-full flex-col gap-2.5 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="skeleton h-6 w-6 rounded-full" />
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="skeleton h-10 w-10 rounded-full" />
          </div>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-full" />
          <div className="mt-auto flex items-center justify-between gap-2 pt-1">
            <div className="flex gap-1">
              <Skeleton className="h-5 w-12 rounded-full" />
              <Skeleton className="h-5 w-12 rounded-full" />
            </div>
            <Skeleton className="h-3 w-16" />
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

function TopPicksLoading({ done, total }: { done: number; total: number }) {
  return (
    <Card>
      <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="font-medium">Finding your top picks…</p>
        <p className="text-sm text-muted-foreground">
          {total > 0 ? `Scoring ${done} of ${total} roles` : 'Reading your profile…'}
        </p>
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
            <p className="max-w-xs text-sm text-muted-foreground">As new roles are posted, your best-fit picks will show up here automatically.</p>
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
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold tracking-tight">
        <Icon className="h-5 w-5 text-primary" /> {title}
      </h2>
      <div className="shrink-0">{action}</div>
    </div>
  )
}

// greeting() helper removed along with the Hero banner

function profileCompleteness(u: Profile) {
  const checks = [u.full_name, u.bio, u.major, u.year, u.cv_text, u.skills?.length, u.desired_roles?.length, u.linkedin]
  const done = checks.filter(Boolean).length
  return Math.round((done / checks.length) * 100)
}

// Specific missing profile items, surfaced as one-tap actions on the dashboard.
// CV first — it's the strongest matching signal.
function profileGaps(u: Profile): { label: string; to: string; icon: typeof FileText }[] {
  const gaps: { label: string; to: string; icon: typeof FileText }[] = []
  if (!u.cv_text && !u.cv_filename) gaps.push({ label: 'Upload your CV', to: '/app/profile?tab=resumes', icon: FileText })
  if (!u.skills?.length) gaps.push({ label: 'Add your skills', to: '/app/profile?focus=preferences', icon: Sparkles })
  if (!u.desired_roles?.length) gaps.push({ label: 'Add desired roles', to: '/app/profile?focus=preferences', icon: Briefcase })
  if (!u.bio) gaps.push({ label: 'Write a short bio', to: '/app/profile?focus=about', icon: FileText })
  if (!u.major) gaps.push({ label: 'Add your major', to: '/app/profile?focus=about', icon: GraduationCap })
  if (!u.year && !u.graduated) gaps.push({ label: 'Add your study year', to: '/app/profile?focus=about', icon: GraduationCap })
  if (!u.linkedin) gaps.push({ label: 'Link your LinkedIn', to: '/app/profile?focus=links', icon: Users })
  return gaps
}
