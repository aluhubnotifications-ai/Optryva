import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Lightbulb,
   Sparkles,
   Send,
   Gauge,
   RefreshCw,
  MessageCircleQuestion,
} from 'lucide-react'
import { Drawer } from '@/components/ui/Drawer'
import { Badge, Skeleton, Avatar } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { Markdown } from '@/components/Markdown'
import { DancingMascot } from '@/components/DancingMascot'
import { ScoreRing, scoreBand } from '@/components/ScoreRing'
import { aiApi } from '@/lib/api'
import { useResearchStream } from '@/lib/researchStream'
import type { AiMatch, JobListing, Profile } from '@/types'

type QA = { role: 'user' | 'ai'; text: string }

const SUGGESTED = [
  'What is the interview process like?',
  'Do they sponsor visas / relocation?',
  'What salary should I expect?',
  'What is the team culture like?',
  'How is career growth here?',
]

/** Drawer wrapper — kept for pages that open research as a modal (Jobs,
 *  ApplicationDetail). The Dashboard renders <ResearchBody> inline instead. */
export function AIResearchPanel({
  open,
  onClose,
  job,
  company,
  user,
}: {
  open: boolean
  onClose: () => void
  job: JobListing | null
  company?: Profile
  user: Profile
}) {
  const companyName = job?.original_company_name || company?.company_name || 'this company'
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="xl"
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" /> AI Research
        </span>
      }
      description={job ? `${job.title} · ${companyName}` : undefined}
    >
      {open && job && <ResearchBody job={job} company={company} user={user} />}
    </Drawer>
  )
}

/** The research content itself — no Drawer. Renders inline (Dashboard) or inside
 *  the Drawer (above). When `match` is passed it shows that verdict and never
 *  re-scores; pass `onScore` to let an unscored role be scored on demand. With
 *  neither (`autoMatch`, the default for the Drawer) it fetches its own score. */
export function ResearchBody({
  job,
  company,
  user,
  match: matchProp,
  autoMatch = true,
  onScore,
  scoring = false,
}: {
  job: JobListing
  company?: Profile
  user: Profile
  match?: AiMatch | null
  autoMatch?: boolean
  onScore?: () => void
  scoring?: boolean
}) {
  // Company research streams from a global store so it keeps going — and stays
  // visible — when the drawer closes or the user switches tabs. The match is a
  // separate, fast/cached fetch.
  const rsCompany = useResearchStream((s) => s.company)
  const rsText = useResearchStream((s) => s.text)
  const rsPhase = useResearchStream((s) => s.phase)
  const rsFromCache = useResearchStream((s) => s.fromCache)
  const rsCachedAt = useResearchStream((s) => s.cachedAt)
  const [fetchedMatch, setFetchedMatch] = useState<AiMatch | null>(null)
  const [matchLoading, setMatchLoading] = useState(true)

  const [thread, setThread] = useState<QA[]>([])
  const [input, setInput] = useState('')
  const [asking, setAsking] = useState(false)
  const [streamingAns, setStreamingAns] = useState(false)
  const threadEndRef = useRef<HTMLDivElement>(null)

  const companyName = job.original_company_name || company?.company_name || 'this company'
  const logoUrl = job.original_company_logo_url || company?.avatar_url
  // Caller-supplied score wins (shared store); else our own auto-fetched one.
  const match = matchProp ?? fetchedMatch

  useEffect(() => {
    setThread([])
    setInput('')
    // Kick off (or reuse) the streaming company research in the global store.
    void useResearchStream.getState().run(companyName, job.title)
    // Match score — local, fast, usually cached.
    let active = true
    setMatchLoading(true)
    setFetchedMatch(null)
    ;(async () => {
      const m =
        autoMatch && matchProp == null && user.user_type === 'student' ? await aiApi.match(user, job) : null
      if (!active) return
      setFetchedMatch(m)
      setMatchLoading(false)
    })()
    return () => {
      active = false
    }
  }, [job, companyName, user, autoMatch, matchProp])

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread, asking])

  async function ask(question: string) {
    const q = question.trim()
    if (!q || asking) return
    setInput('')
    setThread((t) => [...t, { role: 'user', text: q }])
    setAsking(true)
    setStreamingAns(false)
    // Append each streamed token to the last AI bubble (or start one).
    const push = (tok: string) =>
      setThread((t) => {
        const last = t[t.length - 1]
        if (last?.role === 'ai') return [...t.slice(0, -1), { role: 'ai', text: last.text + tok }]
        return [...t, { role: 'ai', text: tok }]
      })
    const streamed = await aiApi.researchAskStream(companyName, job.title, q, (tok) => { setStreamingAns(true); push(tok) })
    if (!streamed) {
      const answer = await aiApi.researchAsk(companyName, job.title, q)
      setThread((t) => [...t, { role: 'ai', text: answer }])
    }
    setAsking(false)
    setStreamingAns(false)
  }

  const showResearch = rsCompany === companyName

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
          {/* ---- Top content: match verdict, company research ---- */}
          <div className="space-y-6">
            {/* ---- Match score loading ---- */}
            {matchLoading && !match && !onScore && (
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center gap-4">
                  <div className="skeleton h-16 w-16 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-5 w-1/2" />
                  </div>
                </div>
              </div>
            )}

            {/* ---- Score prompt (unscored role on the dashboard) ---- */}
            {!match && onScore && (
              <div className="flex flex-col items-start gap-2 rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold">See if you qualify</p>
                  <p className="text-sm text-muted-foreground">
                    This role isn't in your auto-matched set yet. Score it to get your honest fit.
                  </p>
                </div>
                <Button className="gap-1.5" disabled={scoring} onClick={onScore}>
                  {scoring ? <DancingMascot size={16} /> : <Gauge className="h-4 w-4" />}
                  {scoring ? 'Scoring…' : 'Score this role'}
                </Button>
              </div>
            )}

            {/* ---- Match verdict ---- */}
            {match && (
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center gap-4">
                  <ScoreRing score={match.score} size={70} showLabel />
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Your fit for this role
                    </p>
                    <p className="text-lg font-bold" style={{ color: scoreBand(match.score).color }}>
                      {scoreBand(match.score).label} match
                    </p>
                    {match.matched_skills.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {match.matched_skills.slice(0, 4).map((s) => (
                          <Badge key={s} tone="success" className="text-[11px]">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {match.reasons.map((r, i) => (
                    <li key={i} className="flex gap-2 text-sm">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                      <span className="text-muted-foreground">{r}</span>
                    </li>
                  ))}
                  {match.mismatch_flags.map((f, i) => (
                    <li key={`f${i}`} className="flex gap-2 text-sm">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                      <span className="text-muted-foreground">{f}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex gap-2 rounded-xl bg-primary/10 p-3 text-sm">
                  <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{match.tip}</span>
                </div>
              </div>
            )}

            {/* ---- Company research (streamed, live web-grounded) ---- */}
            {showResearch && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Avatar src={logoUrl} name={companyName} size={28} className="rounded-lg" />
                  <h3 className="font-semibold">About {companyName}</h3>
                  {rsPhase === 'running' && <DancingMascot size={16} />}
                </div>

                {rsText ? (
                  <div className="rounded-2xl border border-border bg-card p-4">
                    <Markdown content={rsText} />
                  </div>
                ) : rsPhase === 'running' ? (
                  <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
                    <Sparkles className="h-4 w-4 animate-pulse text-primary" />
                    Searching the web for the latest on {companyName}…
                  </div>
                ) : null}

                {rsPhase === 'error' && !rsText && (
                  <div className="rounded-2xl border border-danger/30 bg-danger/5 p-4 text-sm">
                    <p className="text-danger">Couldn't reach the research AI.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 gap-1.5"
                      onClick={() => useResearchStream.getState().run(companyName, job.title, true)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Retry
                    </Button>
                  </div>
                )}

                {rsText && rsPhase === 'done' && (
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <p className="text-center text-[11px] text-muted-foreground">
                        AI-generated research · verify key facts before applying
                      </p>
                      {rsFromCache && rsCachedAt && (
                        <span className="text-[10px] text-muted-foreground/70">
                          Cached {new Date(rsCachedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => useResearchStream.getState().run(companyName, job.title, true)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Re-search
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ---- Bottom: Ask AI chat ---- */}
          <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
            <h3 className="mb-1 flex items-center gap-2 font-semibold">
              <MessageCircleQuestion className="h-5 w-5 text-primary" /> Ask AI about this role
            </h3>
            <p className="mb-3 text-sm text-muted-foreground">
              Describe anything you want to know about {companyName} or the {job?.title} role.
            </p>

            {/* thread */}
            {thread.length > 0 && (
              <div className="mb-3 space-y-3">
                {thread.map((m, i) =>
                  m.role === 'user' ? (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                        {m.text}
                      </div>
                    </div>
                  ) : (
                    <div key={i} className="flex gap-2">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                        <Sparkles className="h-4 w-4" />
                      </div>
                      <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-border bg-card px-3.5 py-2 text-sm leading-relaxed">
                        {m.text}
                      </div>
                    </div>
                  ),
                )}
                {asking && !streamingAns && (
                  <div className="flex gap-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                      <Sparkles className="h-4 w-4 animate-pulse" />
                    </div>
                    <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-3.5 py-2.5">
                      <span className="flex gap-1">
                        <Dot /> <Dot /> <Dot />
                      </span>
                    </div>
                  </div>
                )}
                <div ref={threadEndRef} />
              </div>
            )}

            {/* suggestions */}
            {thread.length === 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {SUGGESTED.map((s) => (
                  <button
                    key={s}
                    onClick={() => ask(s)}
                    className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* input */}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                ask(input)
              }}
              className="flex items-center gap-2"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type your question…"
                className="h-10 flex-1 rounded-full border border-input bg-background px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button type="submit" size="icon" className="rounded-full" disabled={asking || !input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>
  )
}

function Dot() {
  return <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.2s] [&:nth-child(2)]:[animation-delay:-0.1s]" />
}
