import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTransitionNavigate } from '@/lib/useTransitionNavigate'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search,
  MapPin,
  Flame,
  Bookmark,
  Sparkles,
  CheckCircle2,
  DollarSign,
  Clock,
  ExternalLink,
  Rocket,
  Star,
  Code2,
  BarChart3,
  Palette,
  Megaphone,
  Layers,
  Globe,
  Info,
  CalendarClock,
  ChevronDown,
} from 'lucide-react'
import { useCurrentUser } from '@/lib/store'
import { useGeo, useCountryStats } from '@/lib/geo'
import { jobsApi, profilesApi, resumesApi } from '@/lib/api'
import type { AiMatch, JobListing, Profile, ResumeProfile } from '@/types'
import { AIResearchPanel } from '@/components/AIResearchPanel'
import { TrajectorySimulator } from '@/components/TrajectorySimulator'
import { ShowYourWork } from '@/components/ShowYourWork'
import { MatchRunner } from '@/components/MatchRunner'
import { useMatchRun, needsMatchRun } from '@/lib/matchRun'
import { useMatchProgress } from '@/lib/matchProgress'
import { matchReadiness } from '@/lib/matchReady'
import { Drawer } from '@/components/ui/Drawer'
import { Input, Badge, Avatar, Skeleton } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { cn, daysUntil, timeAgo } from '@/lib/utils'
import { buildJobContent } from '@/lib/jobContent'
import { CheckCircle2 as Check2, Gift, ClipboardList, GraduationCap, Flag, Wifi } from 'lucide-react'

/* Internship-focused quick filters */
const TABS = [
  { key: 'for-you', label: 'For You', icon: Star },
  { key: 'tech', label: 'Software', icon: Code2 },
  { key: 'data', label: 'Data', icon: BarChart3 },
  { key: 'design', label: 'Design', icon: Palette },
  { key: 'marketing', label: 'Marketing', icon: Megaphone },
  { key: 'product', label: 'Product', icon: Layers },
  { key: 'remote', label: 'Remote', icon: Globe },
  { key: 'trending', label: 'Trending', icon: Flame },
] as const
type TabKey = (typeof TABS)[number]['key']

const TYPE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'Internship', label: 'Internships' },
  { key: 'Full-time', label: 'Full-time' },
  { key: 'opportunity', label: 'Opportunities' },
] as const
type TypeKey = (typeof TYPE_FILTERS)[number]['key']

function matchesType(job: JobListing, key: TypeKey) {
  if (key === 'all') return true
  if (key === 'opportunity') return ['Fellowship', 'Part-time', 'Contract'].includes(job.listing_type)
  return job.listing_type === key
}

function isTrending(job: JobListing) {
  const d = daysUntil(job.deadline)
  return (d !== null && d <= 14) || Date.now() - +new Date(job.created_at) < 5 * 86400000
}

export default function Jobs() {
  const user = useCurrentUser()!
  const navigate = useTransitionNavigate()
  const { country } = useGeo()
  const [jobs, setJobs] = useState<JobListing[]>([])
  const [companies, setCompanies] = useState<Record<string, Profile>>({})
  const [loading, setLoading] = useState(true)

  // Match scores come from the global live-progress store (single shared run,
  // same numbers as the Dashboard & Insights, real percentage in the activity panel).
  const storeMatches = useMatchProgress((s) => s.matches)
  const matches = useMemo(() => {
    const m: Record<string, AiMatch> = {}
    storeMatches.forEach((x) => (m[x.job_id] = x))
    return m
  }, [storeMatches])

  const [tab, setTab] = useState<TabKey>('for-you')
  const [typeKey, setTypeKey] = useState<TypeKey>('all')
  const [listQ, setListQ] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [researchJob, setResearchJob] = useState<JobListing | null>(null)
  const [mobileDetail, setMobileDetail] = useState<JobListing | null>(null)
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [params, setParams] = useSearchParams()

  // Render the list in pages so we never mount all ~100 rows into the DOM at
  // once (the full set is still fetched once, lean, for filtering + matching).
  // New pages are revealed automatically as the user scrolls (infinite scroll).
  const PAGE = 10
  const [shown, setShown] = useState(PAGE)
  const [hasResume, setHasResume] = useState(
    () => !!(user?.cv_url || user?.cv_text || user?.cv_filename),
  )
  const listRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setShown(PAGE)
  }, [country, tab, typeKey, listQ, jobs])

  // Daily "run AI matching" gate. We also hold the gate OPEN (and never auto-run)
  // until the student has a résumé + preferences — the funnel can't pick a top-40
  // without them, so MatchRunner shows a "complete your profile" prompt instead.
  const lastRun = useMatchRun((s) => s.lastRun[user.id])
  const markRun = useMatchRun((s) => s.markRun)
  const matchReady = matchReadiness(user, hasResume).ready
  const [gateOpen, setGateOpen] = useState(() => !matchReady || needsMatchRun(lastRun))

  useEffect(() => {
    let active = true
    ;(async () => {
      // Show the listings as soon as they (and their companies) arrive — the
      // list is fully usable without AI scores.
      try {
        const [js, cs, sc] = await Promise.all([
          jobsApi.list(user),
          profilesApi.list('company'),
          profilesApi.list('school'),
        ])
        if (!active) return
        const map: Record<string, Profile> = {}
        ;[...cs, ...sc].forEach((c) => (map[c.id] = c))
        setJobs(js)
        setCompanies(map)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [user])

  // Know whether the student has an ACTIVE structured résumé (resume_profiles) —
  // the new résumé system the matcher actually reads. The user object only carries
  // the legacy cv_text, so we fetch the list to recognise résumés added via the
  // Résumés tab / onboarding and stop showing a false "upload your résumé" prompt.
  useEffect(() => {
    let active = true
    resumesApi
      .list()
      .then((rs: ResumeProfile[]) => {
        if (active) setHasResume(rs.some((r) => r.active))
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [user.id])

  // When the daily gate is already closed, make sure scores are loaded — the
  // global runner is idempotent (reuses cached results, no duplicate activity
  // task), and streams a live percentage if anything needs re-scoring.
  useEffect(() => {
    // Never auto-run for a student who isn't ready — keep the gate open so they
    // get the "add your résumé / preferences" prompt instead of a 40-job run.
    if (!gateOpen && matchReady) void useMatchProgress.getState().run(user.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateOpen, matchReady, user.id])

  // Re-open the gate if matching was invalidated (e.g. CV upload), a new day, or
  // the profile is missing the résumé/preferences the matcher needs.
  useEffect(() => {
    if (!matchReady || needsMatchRun(lastRun)) setGateOpen(true)
  }, [lastRun, matchReady])

  const filtered = useMemo(() => {
    let list = jobs.filter((j) => {
      if (!matchesType(j, typeKey)) return false
      if (country !== 'All countries' && j.country !== country) return false
      if (tab === 'tech' && j.type !== 'Software Engineering') return false
      if (tab === 'data' && j.type !== 'Data') return false
      if (tab === 'design' && j.type !== 'Design') return false
      if (tab === 'marketing' && j.type !== 'Marketing') return false
      if (tab === 'product' && j.type !== 'Product') return false
      if (tab === 'remote' && !j.remote) return false
      if (tab === 'trending' && !isTrending(j)) return false
      if (listQ) {
        const hay = `${j.title} ${j.tags.join(' ')} ${companies[j.company_id]?.company_name ?? ''} ${j.original_company_name ?? ''}`.toLowerCase()
        if (!hay.includes(listQ.toLowerCase())) return false
      }
      return true
    })
    list = [...list].sort((a, b) => (matches[b.id]?.score ?? 0) - (matches[a.id]?.score ?? 0))
    return list
  }, [jobs, country, tab, typeKey, listQ, matches, companies])

  // Auto-load the next page when the sentinel scrolls into view. Revealing more
  // rows is pure client-side (data is already loaded), so it's instant.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || shown >= filtered.length) return
    // Desktop: the list scrolls inside its own sticky container, so observe
    // against that container. Mobile: the page scrolls, so use the viewport.
    const isDesktop = window.matchMedia('(min-width: 1024px)').matches
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setShown((s) => Math.min(s + PAGE, filtered.length))
      },
      { root: isDesktop ? listRef.current : null, rootMargin: '200px', threshold: 0 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [shown, filtered.length])

  // Keep a valid selection as filters change.
  useEffect(() => {
    if (!filtered.length) {
      setSelectedId(null)
    } else if (!filtered.some((j) => j.id === selectedId)) {
      setSelectedId(filtered[0].id)
    }
  }, [filtered, selectedId])

  // Publish per-country listing counts (total + internships) so the global
  // country picker can highlight internship countries and show how many roles
  // exist per country.
  const countryStats = useMemo(() => {
    const m: Record<string, { total: number; internships: number }> = {}
    for (const j of jobs) {
      if (!j.country) continue
      if (!m[j.country]) m[j.country] = { total: 0, internships: 0 }
      m[j.country].total++
      if (j.listing_type === 'Internship') m[j.country].internships++
    }
    return m
  }, [jobs])
  useEffect(() => {
    useCountryStats.getState().setStats(countryStats)
  }, [countryStats])

  const selected = filtered.find((j) => j.id === selectedId) ?? filtered[0] ?? null

  function openJob(job: JobListing) {
    setSelectedId(job.id)
    if (window.innerWidth < 1024) setMobileDetail(job)
  }

  function handleApply(job: JobListing) {
    if (job.apply_url) {
      jobsApi.trackOpen(job.id) // count this person as an external apply open
      window.open(job.apply_url, '_blank', 'noopener,noreferrer')
    } else navigate('/app/apply/' + job.id)
  }

  function toggleSave(id: string) {
    setSaved((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  // Deep-link: /app/jobs?job=<id>[&apply=1] (e.g. from AI Sourcing results)
  useEffect(() => {
    const jobId = params.get('job')
    if (jobId && jobs.some((j) => j.id === jobId)) {
      setSelectedId(jobId)
      if (window.innerWidth < 1024) {
        const j = jobs.find((x) => x.id === jobId)!
        setMobileDetail(j)
      }
      if (params.get('apply') === '1') {
        const j = jobs.find((x) => x.id === jobId)!
        handleApply(j)
      }
      params.delete('job')
      params.delete('apply')
      setParams(params, { replace: true })
    }
    // Depend on `params` too, so clicking "View" from AI Sourcing while already
    // on this page (jobs already loaded) still opens the selected role.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, params])

  return (
    <div>
      {/* Heading */}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <CalendarClock className="h-6 w-6 text-primary" /> Opportunities
          </h1>
          <p className="text-sm text-muted-foreground">
            Internships, full-time & more · {country === 'All countries' ? 'Worldwide' : country}
          </p>
        </div>
        {/* Type segmented control */}
        <div className="inline-flex items-center gap-1 rounded-xl border border-border bg-muted/50 p-1">
          {TYPE_FILTERS.map((t) => {
            const active = typeKey === t.key
            return (
              <button
                key={t.key}
                onClick={() => setTypeKey(t.key)}
                className={cn(
                  'relative rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {active && (
                  <motion.span layoutId="type-seg" className="absolute inset-0 rounded-lg bg-card shadow-soft" transition={{ type: 'spring', stiffness: 380, damping: 30 }} />
                )}
                <span className="relative z-10">{t.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {gateOpen ? (
        <div className="mt-2">
          <MatchRunner
            userId={user.id}
            resumePresent={hasResume}
            onComplete={() => { markRun(user.id); setGateOpen(false) }}
            onError={() => setGateOpen(false)}
            title="Today's AI matches"
            subtitle={`Welcome back, ${user.full_name.split(' ')[0]} — let's score today's opportunities against your profile and show your best fits first. You can switch tabs while it runs.`}
          />
        </div>
      ) : (
      <>
      {/* Sticky tabs */}
      <div className="sticky top-16 z-20 -mx-4 mb-4 border-b border-border bg-background/95 px-4 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="-mx-1 flex items-center gap-1 overflow-x-auto px-1">
          {TABS.map((t) => {
            const active = tab === t.key
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  'relative flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
                {active && (
                  <motion.span layoutId="job-tab" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Two-pane: list (sticky/scroll) + detail (sticky/scroll) */}
      <div className="grid gap-6 lg:grid-cols-[minmax(320px,400px)_1fr]">
        {/* List */}
        <section ref={listRef} className="lg:sticky lg:top-[7.5rem] lg:h-[calc(100vh-9rem)] lg:overflow-y-auto lg:pr-1">
          <p className="mb-2 text-sm text-muted-foreground">
            Showing <span className="font-semibold text-foreground">{filtered.length}</span> AI-matched {filtered.length === 1 ? 'role' : 'roles'}
          </p>
          <div className="sticky top-0 z-10 mb-3 bg-background pb-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={listQ} onChange={(e) => setListQ(e.target.value)} placeholder="Filter results…" className="pl-9" />
            </div>
          </div>

           <div className="space-y-2">
             {loading
               ? Array.from({ length: 6 }).map((_, i) => <ListSkeleton key={i} />)
               : filtered.slice(0, shown).map((job) => (
                   <ListRow
                     key={job.id}
                     job={job}
                     company={companies[job.company_id]}
                     match={matches[job.id]}
                     selected={selected?.id === job.id}
                     onClick={() => openJob(job)}
                   />
                 ))}
             {!loading && shown < filtered.length && (
               <div ref={sentinelRef} className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                 <Spinner className="h-4 w-4" /> Loading more…
               </div>
             )}
             {!loading && shown >= filtered.length && filtered.length > 0 && (
               <p className="py-4 text-center text-xs text-muted-foreground">You've reached the end</p>
             )}
             {!loading && filtered.length === 0 && (
               <p className="py-10 text-center text-sm text-muted-foreground">
                 No roles in {country === 'All countries' ? 'this view' : country} yet. Try another country, type, or tab.
               </p>
             )}
           </div>
        </section>

        {/* Detail (desktop) */}
        <section className="hidden lg:block lg:sticky lg:top-[7.5rem] lg:h-[calc(100vh-9rem)] lg:overflow-y-auto lg:pr-1">
          {selected ? (
            <JobDetailContent
              job={selected}
              company={companies[selected.company_id]}
              match={matches[selected.id]}
              saved={saved.has(selected.id)}
              onSave={() => toggleSave(selected.id)}
              onApply={() => handleApply(selected)}
              onResearch={() => setResearchJob(selected)}
            />
          ) : (
            <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
              Select a role to view details
            </div>
          )}
        </section>
      </div>

      {/* Detail (mobile drawer) */}
      <Drawer open={!!mobileDetail} onClose={() => setMobileDetail(null)} width="lg" title="Opportunity details">
        {mobileDetail && (
          <JobDetailContent
            job={mobileDetail}
            company={companies[mobileDetail.company_id]}
            match={matches[mobileDetail.id]}
            saved={saved.has(mobileDetail.id)}
            onSave={() => toggleSave(mobileDetail.id)}
            onApply={() => handleApply(mobileDetail)}
            onResearch={() => setResearchJob(mobileDetail)}
            bare
          />
        )}
      </Drawer>
      </>
      )}

      <AIResearchPanel
        open={!!researchJob}
        onClose={() => setResearchJob(null)}
        job={researchJob}
        company={researchJob ? companies[researchJob.company_id] : undefined}
        user={user}
      />

    </div>
  )
}

/* ----------------- list row ----------------- */
function ScorePill({ score }: { score: number }) {
  const tone =
    score >= 85 ? 'border-success/40 text-success' : score >= 72 ? 'border-accent/40 text-accent' : 'border-border text-muted-foreground'
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold', tone)}>
      <Info className="h-3 w-3" /> {score}
    </span>
  )
}

function ListRow({
  job,
  company,
  match,
  selected,
  onClick,
}: {
  job: JobListing
  company?: Profile
  match?: AiMatch
  selected: boolean
  onClick: () => void
}) {
  const brand = job.original_company_name || company?.company_name
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full rounded-xl border p-3 text-left transition-all',
        selected
          ? 'border-l-[3px] border-l-primary border-primary/30 bg-primary/5'
          : 'border-border hover:border-primary/30 hover:bg-muted/40',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold leading-tight">{job.title}</p>
          <p className="truncate text-sm text-muted-foreground">{brand}</p>
        </div>
        {match && <ScorePill score={match.score} />}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 truncate text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0" /> {job.location}
        </span>
        <span className="shrink-0 text-sm font-semibold text-primary">{job.pay || 'Competitive'}</span>
      </div>
      {isTrending(job) && (
        <span className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary">
          <Flame className="h-3.5 w-3.5" /> Trending
        </span>
      )}
    </button>
  )
}

/* ----------------- detail content ----------------- */
function JobDetailContent({
  job,
  company,
  match,
  saved,
  onSave,
  onApply,
  onResearch,
  bare,
}: {
  job: JobListing
  company?: Profile
  match?: AiMatch
  saved: boolean
  onSave: () => void
  onApply: () => void
  onResearch: () => void
  bare?: boolean
}) {
  const brand = job.original_company_name || company?.company_name
  const external = !!job.apply_url
  const isIntern = job.listing_type === 'Internship' || job.listing_type === 'Fellowship'
  const payLabel = isIntern ? 'Stipend' : 'Salary'
  const content = buildJobContent(job)

  return (
    <div className={cn('space-y-4', !bare && 'animate-fade-in')}>
      {/* Header card */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex gap-3">
            <Link to={`/app/companies/${job.company_id}`} className="shrink-0" title={`View ${brand}`}>
              <Avatar name={brand} src={job.original_company_logo_url || company?.avatar_url} size={48} className="rounded-xl" />
            </Link>
            <div>
              <h1 className="text-xl font-bold tracking-tight">{job.title}</h1>
              <Link to={`/app/companies/${job.company_id}`} className="text-sm text-muted-foreground hover:text-primary hover:underline">{brand}</Link>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" /> {job.location} · {content.workMode}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {match && <ScorePill score={match.score} />}
                <Badge tone="primary">{job.listing_type}</Badge>
                {job.duration && <Badge tone="default">{job.duration}</Badge>}
                {job.tags.slice(0, 2).map((t) => (
                  <Badge key={t} tone="outline">{t}</Badge>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Button className="gap-1.5" onClick={onApply}>
              {external ? <ExternalLink className="h-4 w-4" /> : <Rocket className="h-4 w-4" />}
              {external ? 'Apply on site' : 'Quick Apply'}
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={onSave}>
              <Bookmark className={cn('h-4 w-4', saved && 'fill-current text-primary')} />
              {saved ? 'Saved' : 'Save'}
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-4">
          <Meta icon={DollarSign} label={payLabel} value={job.pay || 'Competitive'} />
          <Meta icon={MapPin} label="Location" value={job.location} />
          <Meta icon={Clock} label="Posted" value={timeAgo(job.created_at)} />
        </div>
      </Card>

      {/* AI Match Analysis (collapsible) */}
      {match && <MatchAnalysis match={match} brand={brand} onResearch={onResearch} />}

      {/* Full job description */}
      <Card>
        <h2 className="mb-4 text-lg font-bold tracking-tight">Job description</h2>

        {/* Description (the role's own text) */}
        {content.intro && (
          <p className="mb-5 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{content.intro}</p>
        )}

        {/* Responsibilities — only when the company provided them */}
        {content.responsibilities.length > 0 && (
          <Section icon={ClipboardList} title="Responsibilities">
            <ul className="space-y-1.5">
              {content.responsibilities.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Check2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> {r}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Qualifications — only when the company provided them */}
        {content.qualifications.length > 0 && (
          <Section icon={GraduationCap} title="Qualifications">
            <ul className="space-y-1.5">
              {content.qualifications.map((q, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Check2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> {q}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Benefits — only when the company provided them */}
        {content.benefits.length > 0 && (
          <Section icon={Gift} title="Benefits">
            <ul className="space-y-1.5">
              {content.benefits.map((b, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Check2 className="h-4 w-4 shrink-0 text-success" /> {b}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {content.wfhNote && (
          <p className="mb-4 inline-flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-sm text-muted-foreground">
            <Wifi className="h-4 w-4 text-primary" /> {content.wfhNote}
          </p>
        )}

        <div className="mt-2 border-t border-border pt-3">
          <button className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-danger">
            <Flag className="h-3.5 w-3.5" /> Report this listing
          </button>
        </div>
      </Card>
    </div>
  )
}

function MatchAnalysis({
  match,
  brand,
  onResearch,
}: {
  match: AiMatch
  brand?: string
  onResearch: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="overflow-hidden rounded-2xl border border-primary/20 bg-primary/5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 p-5 text-left"
      >
        <h2 className="flex items-center gap-2 font-semibold">
          <Sparkles className="h-5 w-5 text-primary" /> AI Match Analysis
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-2xl font-extrabold text-primary">
            {match.score}
            <span className="text-sm font-medium text-muted-foreground">/99</span>
          </span>
          <ChevronDown className={cn('h-5 w-5 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            <div className="space-y-3.5 px-5 pb-5">
              <Bar label="Skills alignment" value={match.breakdown.skills} />
              <Bar label="Experience match" value={match.breakdown.experience} />
              <Bar label="Location fit" value={match.breakdown.location} />
              <Bar label="Compensation match" value={match.breakdown.compensation} />
              <TrajectorySimulator match={match} />
              <ShowYourWork match={match} />
              <Button variant="outline" size="sm" className="mt-1 w-full gap-1.5" onClick={onResearch}>
                <Sparkles className="h-4 w-4 text-primary" /> Ask AI / full research on {brand}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">{children}</div>
}

function Section({ icon: Icon, title, children }: { icon: typeof Gift; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h3 className="mb-2 flex items-center gap-2 font-semibold">
        <Icon className="h-4 w-4 text-primary" /> {title}
      </h3>
      {children}
    </div>
  )
}

function Meta({ icon: Icon, label, value }: { icon: typeof DollarSign; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium">{value}</p>
      </div>
    </div>
  )
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold text-accent">{value}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <motion.div
          className="h-full rounded-full bg-accent"
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
      </div>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex items-start justify-between">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <div className="skeleton h-5 w-10 rounded-full" />
      </div>
      <Skeleton className="mt-2 h-3 w-1/3" />
    </div>
  )
}
