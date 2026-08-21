import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Sparkles, Search, Loader2, X } from 'lucide-react'
import { useCurrentUser } from '@/lib/store'
import { aiApi, jobsApi, profilesApi } from '@/lib/api'
import { useMatchProgress } from '@/lib/matchProgress'
import { useMatchRun, needsMatchRun } from '@/lib/matchRun'
import type { JobListing, Profile } from '@/types'
import { Card, CardBody, Skeleton } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { OpportunityRow } from '@/components/OpportunityRow'

type SourceResult = Awaited<ReturnType<typeof aiApi.sourceOpportunities>>

const SUGGESTIONS = [
  'Remote software internship',
  'Data science roles in Rwanda',
  'Fellowships for new grads',
  'Product design, paid',
]

/** Research — open to anyone in the navbar. Browse every opportunity the viewer is
 *  allowed to see (the server gates restricted listings out), or describe what you
 *  want and let AI find + rank them. Research any role inline; students can score. */
export default function Research() {
  const user = useCurrentUser()
  const isStudent = user?.user_type === 'student'

  const [jobs, setJobs] = useState<JobListing[]>([])
  const [companies, setCompanies] = useState<Record<string, Profile>>({})
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)

  // The active (submitted) query lives in the URL so the navbar search can deep-link
  // here; the input box is local until submitted, so AI isn't fired on every keystroke.
  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.get('q')?.trim() ?? ''
  const [input, setInput] = useState(query)

  // AI sourcing state for the active query.
  const [sourcing, setSourcing] = useState(false)
  const [result, setResult] = useState<SourceResult | null>(null)

  // Shared match store — same scores as Dashboard/Jobs/Insights.
  const storeMatches = useMatchProgress((s) => s.matches)
  const scoring = useMatchProgress((s) => s.scoring)
  const scoreOne = useMatchProgress((s) => s.scoreOne)
  const matchPhase = useMatchProgress((s) => s.phase)
  const matchById = useMemo(() => new Map(storeMatches.map((m) => [m.job_id, m])), [storeMatches])

  useEffect(() => {
    if (!user) return
    let active = true
    ;(async () => {
      // jobsApi.list hits GET /jobs, which already filters out listings the
      // viewer isn't allowed to see (school/year/privacy gates).
      const [j, cs, schools] = await Promise.all([
        jobsApi.list(user),
        profilesApi.list('company'),
        profilesApi.list('school'),
      ])
      if (!active) return
      const map: Record<string, Profile> = {}
      ;[...cs, ...schools].forEach((c) => (map[c.id] = c))
      setJobs(j)
      setCompanies(map)
      setLoading(false)
    })()
    // Students get auto-matched scores via the shared runner (idempotent).
    if (isStudent && needsMatchRun(useMatchRun.getState().lastRun[user.id])) void useMatchProgress.getState().run(user.id)
    return () => {
      active = false
    }
  }, [user, isStudent])

  // Keep the input in sync when the active query changes from outside (navbar/back).
  useEffect(() => setInput(query), [query])

  // Run AI sourcing whenever there's an active query and the catalog is loaded.
  // The engine ranks by honest fit and returns "why" chips; visibility is gated
  // server-side. With no query we fall back to plain browsing below.
  useEffect(() => {
    if (!user || loading) return
    if (!query) {
      setResult(null)
      setSourcing(false)
      return
    }
    let active = true
    setSourcing(true)
    ;(async () => {
      const r = await aiApi.sourceOpportunities(query, jobs, user)
      if (active) {
        setResult(r)
        setSourcing(false)
      }
    })()
    return () => {
      active = false
    }
  }, [query, user, jobs, loading])

  const submit = (q: string) => setSearchParams(q.trim() ? { q: q.trim() } : {}, { replace: false })
  const clear = () => {
    setInput('')
    setSearchParams({}, { replace: false })
  }

  // Browse mode (no query): every visible role, scored first.
  const browseJobs = useMemo(
    () => [...jobs].sort((a, b) => (matchById.get(b.id)?.score ?? -1) - (matchById.get(a.id)?.score ?? -1)),
    [jobs, matchById],
  )

  // Keyword fallback so "just explain what you want" always returns something to
  // research, even when the AI engine is unavailable or finds no strong match.
  const keywordJobs = useMemo(() => {
    const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2)
    if (!terms.length) return []
    const hay = (job: JobListing) =>
      `${job.title} ${job.original_company_name || companies[job.company_id]?.company_name || ''} ${job.location || ''} ${(job.tags || []).join(' ')} ${job.type || ''} ${job.listing_type || ''}`.toLowerCase()
    return jobs
      .map((job) => ({ job, hits: terms.filter((t) => hay(job).includes(t)).length }))
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits || (matchById.get(b.job.id)?.score ?? -1) - (matchById.get(a.job.id)?.score ?? -1))
      .map((x) => x.job)
  }, [jobs, query, companies, matchById])

  if (!user) return null

  const aiMode = !!query
  // The AI found nothing rankable, but keyword matches exist → show those instead.
  const usingKeywordFallback = aiMode && !sourcing && (!result || result.results.length === 0) && keywordJobs.length > 0

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Sparkles className="h-6 w-6 text-primary" /> Research opportunities
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Describe what you want and AI finds &amp; ranks the best-fit roles — then research any of
          them inline.{isStudent && ' Not auto-matched yet? Score it to see your honest fit.'}
        </p>
      </div>

      {/* Styled AI search bar */}
      <form onSubmit={(e) => { e.preventDefault(); submit(input) }} className="mb-3">
        <div className="flex items-center gap-2 rounded-2xl border border-primary/30 bg-gradient-to-r from-primary/5 to-accent/5 p-1.5 shadow-soft focus-within:ring-2 focus-within:ring-primary/40">
          <div className="relative flex-1">
            <Sparkles className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. “remote data internship that pays, uses Python”"
              className="h-11 w-full rounded-xl bg-transparent pl-9 pr-9 text-sm focus-visible:outline-none"
            />
            {input && (
              <button type="button" onClick={clear} aria-label="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button type="submit" className="shrink-0 gap-1.5 rounded-xl" disabled={sourcing}>
            {sourcing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            <span className="hidden sm:inline">{sourcing ? 'Searching…' : 'Search with AI'}</span>
          </Button>
        </div>
      </form>

      {/* Suggestion chips (browse mode only) */}
      {!aiMode && (
        <div className="mb-5 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => { setInput(s); submit(s) }}
              className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* AI summary banner */}
      {aiMode && (result || sourcing || usingKeywordFallback) && (
        <div className="mb-5 flex items-start gap-2.5 rounded-2xl border border-primary/25 bg-primary/5 p-4">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="text-sm">
            <p className="font-semibold">AI search</p>
            <p className="text-muted-foreground">
              {sourcing
                ? `Finding the best-fit roles for “${query}”…`
                : usingKeywordFallback
                  ? `Here are roles matching “${query}”. Open any of them to research it in depth.`
                  : result?.summary}
            </p>
          </div>
        </div>
      )}

      {/* Results */}
      {(loading || sourcing) ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <CardBody className="flex items-center gap-4">
                <div className="skeleton h-[50px] w-[50px] rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      ) : aiMode ? (
        result && result.results.length > 0 ? (
          <div className="space-y-3">
            {result.results.map(({ job, why }) => (
              <OpportunityRow
                key={job.id}
                job={job}
                user={user}
                match={matchById.get(job.id)}
                company={companies[job.company_id]}
                scoring={scoring.includes(job.id)}
                autoRunning={matchPhase === 'running'}
                researchOpen={openId === job.id}
                aiReasons={why}
                onScore={isStudent ? () => scoreOne(job) : undefined}
                onToggleResearch={() => setOpenId((cur) => (cur === job.id ? null : job.id))}
              />
            ))}
          </div>
        ) : usingKeywordFallback ? (
          <div className="space-y-3">
            {keywordJobs.map((job) => (
              <OpportunityRow
                key={job.id}
                job={job}
                user={user}
                match={matchById.get(job.id)}
                company={companies[job.company_id]}
                scoring={scoring.includes(job.id)}
                autoRunning={matchPhase === 'running'}
                researchOpen={openId === job.id}
                onScore={isStudent ? () => scoreOne(job) : undefined}
                onToggleResearch={() => setOpenId((cur) => (cur === job.id ? null : job.id))}
              />
            ))}
          </div>
        ) : (
          <Card>
            <CardBody className="py-12 text-center text-sm text-muted-foreground">
              No matches for “{query}”. Try different words, or{' '}
              <button onClick={clear} className="font-medium text-primary hover:underline">browse all opportunities</button>.
            </CardBody>
          </Card>
        )
      ) : browseJobs.length === 0 ? (
        <Card>
          <CardBody className="py-12 text-center text-sm text-muted-foreground">
            No opportunities available to you yet.
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-3">
          {browseJobs.map((job) => (
            <OpportunityRow
              key={job.id}
              job={job}
              user={user}
              match={matchById.get(job.id)}
              company={companies[job.company_id]}
              scoring={scoring.includes(job.id)}
              autoRunning={matchPhase === 'running'}
              researchOpen={openId === job.id}
              onScore={isStudent ? () => scoreOne(job) : undefined}
              onToggleResearch={() => setOpenId((cur) => (cur === job.id ? null : job.id))}
            />
          ))}
        </div>
      )}
    </div>
  )
}
