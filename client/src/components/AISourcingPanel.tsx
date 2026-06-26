import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, Send, ArrowRight, Rocket, ExternalLink } from 'lucide-react'
import { Drawer } from '@/components/ui/Drawer'
import { Badge, Avatar, Skeleton } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { aiApi, jobsApi, profilesApi } from '@/lib/api'
import { useCurrentUser } from '@/lib/store'
import { useSourcing } from '@/lib/sourcing'
import type { JobListing, Profile } from '@/types'

type SourceResult = Awaited<ReturnType<typeof aiApi.sourceOpportunities>>
type Turn = { query: string; result?: SourceResult }

/** Global AI-sourcing drawer. Triggered from the navbar search bar. */
export function AISourcingPanel() {
  const { open, query, close } = useSourcing()
  const user = useCurrentUser()
  const navigate = useNavigate()

  const [jobs, setJobs] = useState<JobListing[]>([])
  const [companies, setCompanies] = useState<Record<string, Profile>>({})
  const [ready, setReady] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  // Load the catalog once the panel first opens.
  useEffect(() => {
    if (!open || ready || !user) return
    ;(async () => {
      const [j, cs, sc] = await Promise.all([
        jobsApi.list(user),
        profilesApi.list('company'),
        profilesApi.list('school'),
      ])
      const map: Record<string, Profile> = {}
      ;[...cs, ...sc].forEach((c) => (map[c.id] = c))
      setJobs(j)
      setCompanies(map)
      setReady(true)
    })()
  }, [open, ready, user])

  // Run the incoming query each time the panel opens with a query.
  useEffect(() => {
    if (open && query && ready && user) {
      setTurns([])
      run(query)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, ready])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns, busy])

  async function run(q: string) {
    const text = q.trim()
    if (!text || busy || !user) return
    setInput('')
    setTurns((t) => [...t, { query: text }])
    setBusy(true)
    const result = await aiApi.sourceOpportunities(text, jobs, user)
    setTurns((t) => {
      const copy = [...t]
      copy[copy.length - 1] = { query: text, result }
      return copy
    })
    setBusy(false)
  }

  function view(job: JobListing) {
    close()
    navigate(`/app/jobs?job=${job.id}`)
  }
  function apply(job: JobListing) {
    if (job.apply_url) {
      jobsApi.trackOpen(job.id) // count this person as an external apply open
      window.open(job.apply_url, '_blank', 'noopener,noreferrer')
    } else {
      close()
      navigate(`/app/jobs?job=${job.id}&apply=1`)
    }
  }

  if (!user) return null

  return (
    <Drawer
      open={open}
      onClose={close}
      width="xl"
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" /> AI Sourcing
        </span>
      }
      description="Describe what you want — the AI finds it for you"
    >
      <div className="space-y-5">
        {turns.map((turn, i) => (
          <div key={i} className="space-y-3">
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                {turn.query}
              </div>
            </div>

            {turn.result ? (
              <div className="flex gap-2">
                <AiAvatar />
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-3.5 py-2.5 text-sm leading-relaxed">
                    {turn.result.summary}
                  </div>
                  {turn.result.results.map(({ job, why, score }) => (
                    <ResultCard
                      key={job.id}
                      job={job}
                      company={companies[job.company_id]}
                      why={why}
                      score={score}
                      onView={() => view(job)}
                      onApply={() => apply(job)}
                    />
                  ))}
                </div>
              </div>
            ) : (
              busy &&
              i === turns.length - 1 && (
                <div className="flex gap-2">
                  <AiAvatar pulse />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-10 w-full rounded-2xl" />
                    <Skeleton className="h-20 w-full rounded-2xl" />
                    <Skeleton className="h-20 w-full rounded-2xl" />
                  </div>
                </div>
              )
            )}
          </div>
        ))}
        <div ref={endRef} />

        <form
          onSubmit={(e) => {
            e.preventDefault()
            run(input)
          }}
          className="sticky bottom-0 -mx-5 border-t border-border bg-card px-5 pt-3"
        >
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Refine… e.g. 'only remote' or 'higher pay'"
              className="h-11 flex-1 rounded-full border border-input bg-background px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button type="submit" size="icon" className="h-11 w-11 rounded-full" disabled={busy || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </form>
      </div>
    </Drawer>
  )
}

function AiAvatar({ pulse }: { pulse?: boolean }) {
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
      <Sparkles className={pulse ? 'h-4 w-4 animate-pulse' : 'h-4 w-4'} />
    </div>
  )
}

function ResultCard({
  job,
  company,
  why,
  score,
  onView,
  onApply,
}: {
  job: JobListing
  company?: Profile
  why: string[]
  score: number
  onView: () => void
  onApply: () => void
}) {
  const brand = job.original_company_name || company?.company_name
  const external = !!job.apply_url
  return (
    <div className="rounded-2xl border border-border bg-card p-3.5 transition-shadow hover:shadow-soft">
      <div className="flex items-start gap-3">
        <Avatar name={brand} src={job.original_company_logo_url || company?.avatar_url} size={40} className="rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-semibold leading-tight">{job.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {brand} · {job.location}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-primary/12 px-2 py-0.5 text-xs font-bold text-primary">
              {score}% fit
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {why.slice(0, 4).map((w, i) => (
              <Badge key={i} tone="success" className="text-[11px]">
                {w}
              </Badge>
            ))}
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <span className="mr-auto text-sm font-semibold text-primary">{job.pay || 'Competitive'}</span>
            <Button variant="outline" size="sm" className="gap-1" onClick={onView}>
              View <ArrowRight className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" className="gap-1" onClick={onApply}>
              {external ? <ExternalLink className="h-3.5 w-3.5" /> : <Rocket className="h-3.5 w-3.5" />} Apply
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
