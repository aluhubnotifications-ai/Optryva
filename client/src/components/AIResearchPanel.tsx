import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Lightbulb,
  Sparkles,
  ThumbsUp,
  Building2,
  Target,
  Send,
  MessageCircleQuestion,
} from 'lucide-react'
import { Drawer } from '@/components/ui/Drawer'
import { Badge, Skeleton, Avatar } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { ScoreRing, scoreBand } from '@/components/ScoreRing'
import { aiApi } from '@/lib/api'
import type { AiMatch, JobListing, Profile } from '@/types'

type Research = Awaited<ReturnType<typeof aiApi.companyResearch>>
type QA = { role: 'user' | 'ai'; text: string }

const SUGGESTED = [
  'What is the interview process like?',
  'Do they sponsor visas / relocation?',
  'What salary should I expect?',
  'What is the team culture like?',
  'How is career growth here?',
]

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
  const [research, setResearch] = useState<Research | null>(null)
  const [match, setMatch] = useState<AiMatch | null>(null)
  const [loading, setLoading] = useState(true)

  const [thread, setThread] = useState<QA[]>([])
  const [input, setInput] = useState('')
  const [asking, setAsking] = useState(false)
  const [streamingAns, setStreamingAns] = useState(false)
  const threadEndRef = useRef<HTMLDivElement>(null)

  const companyName = job?.original_company_name || company?.company_name || 'this company'

  useEffect(() => {
    if (!open || !job) return
    setLoading(true)
    setResearch(null)
    setMatch(null)
    setThread([])
    setInput('')
    let active = true
    ;(async () => {
      const [r, m] = await Promise.all([
        aiApi.companyResearch(companyName, job.title),
        user.user_type === 'student' ? aiApi.match(user, job) : Promise.resolve(null),
      ])
      if (!active) return
      setResearch(r)
      setMatch(m)
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [open, job, companyName, user])

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread, asking])

  async function ask(question: string) {
    const q = question.trim()
    if (!q || !job || asking) return
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
      {loading ? (
        <ResearchSkeleton />
      ) : (
        <div className="space-y-6 animate-fade-in">
          {/* ---- Ask AI (you describe what to research) ---- */}
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

          {/* ---- Company research ---- */}
          {research && (
            <div className="space-y-5">
              <div className="flex items-center gap-2">
                <Avatar name={companyName} size={28} className="rounded-lg" />
                <h3 className="font-semibold">About {companyName}</h3>
              </div>
              <Section icon={Building2} title="What they do">
                <p className="text-sm text-muted-foreground">{research.overview}</p>
              </Section>
              <Section icon={ThumbsUp} title="What it's like to work there">
                <p className="text-sm text-muted-foreground">{research.culture}</p>
              </Section>
              <Section icon={Target} title="Why it's a fit for you">
                <p className="text-sm text-muted-foreground">{research.opportunity}</p>
              </Section>
              <Section icon={AlertTriangle} title="Honest red flags" tone="warning">
                <p className="text-sm text-muted-foreground">{research.red_flags}</p>
              </Section>
              <Section icon={HelpCircle} title="Smart questions to ask">
                <ul className="space-y-1.5">
                  {research.questions.map((q, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="font-semibold text-primary">{i + 1}.</span>
                      <button onClick={() => ask(q)} className="text-left hover:text-foreground hover:underline">
                        {q}
                      </button>
                    </li>
                  ))}
                </ul>
              </Section>
              <div className="rounded-xl border border-success/30 bg-success/10 p-4">
                <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-success">
                  <CheckCircle2 className="h-4 w-4" /> Bottom line
                </p>
                <p className="text-sm text-muted-foreground">{research.verdict}</p>
              </div>
              <p className="text-center text-[11px] text-muted-foreground">
                AI-generated research · verify key facts before applying
              </p>
            </div>
          )}
        </div>
      )}
    </Drawer>
  )
}

function Dot() {
  return <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.2s] [&:nth-child(2)]:[animation-delay:-0.1s]" />
}

function Section({
  icon: Icon,
  title,
  children,
  tone = 'primary',
}: {
  icon: typeof Sparkles
  title: string
  children: React.ReactNode
  tone?: 'primary' | 'warning'
}) {
  return (
    <div>
      <h3 className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
        <Icon className={tone === 'warning' ? 'h-4 w-4 text-warning' : 'h-4 w-4 text-primary'} />
        {title}
      </h3>
      {children}
    </div>
  )
}

function ResearchSkeleton() {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
        <Skeleton className="mb-2 h-5 w-1/2" />
        <Skeleton className="mb-3 h-3 w-3/4" />
        <Skeleton className="h-10 w-full rounded-full" />
      </div>
      <div className="rounded-2xl border border-border p-4">
        <div className="flex items-center gap-4">
          <div className="skeleton h-16 w-16 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        </div>
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      ))}
      <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Sparkles className="h-4 w-4 animate-pulse text-primary" /> Researching…
      </p>
    </div>
  )
}
