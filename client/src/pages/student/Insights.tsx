import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, Send, Lightbulb, ListChecks, MessageSquare, FileText, ArrowRight, RefreshCw, FileSearch, ScanLine, Trophy, CheckCircle2, Gauge, Target, TrendingUp, GraduationCap } from 'lucide-react'
import { useCurrentUser } from '@/lib/store'
import { aiApi, jobsApi, profilesApi } from '@/lib/api'
import type { InsightsData } from '@/lib/api'
import type { AiMatch, JobListing, Profile } from '@/types'
import { Card, CardBody, Badge, Avatar, Progress } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs'
import { Markdown } from '@/components/Markdown'
import { ScoreRing } from '@/components/ScoreRing'
import { sleep } from '@/lib/utils'

export default function Insights() {
  const user = useCurrentUser()!
  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Sparkles className="h-6 w-6 text-primary" /> AI Insights
        </h1>
        <p className="text-sm text-muted-foreground">Your personal AI career assistant.</p>
      </div>

      <Tabs defaultValue="snapshot">
        <TabsList>
          <TabsTrigger value="snapshot"><span className="inline-flex items-center gap-1.5"><Gauge className="h-4 w-4" /> Snapshot</span></TabsTrigger>
          <TabsTrigger value="chat"><span className="inline-flex items-center gap-1.5"><MessageSquare className="h-4 w-4" /> Chat</span></TabsTrigger>
          <TabsTrigger value="matches"><span className="inline-flex items-center gap-1.5"><ListChecks className="h-4 w-4" /> Job Matches</span></TabsTrigger>
          <TabsTrigger value="tips"><span className="inline-flex items-center gap-1.5"><Lightbulb className="h-4 w-4" /> CV Tips</span></TabsTrigger>
        </TabsList>

        <TabsContent value="snapshot" className="mt-4"><SnapshotTab user={user} /></TabsContent>
        <TabsContent value="chat" className="mt-4"><ChatTab /></TabsContent>
        <TabsContent value="matches" className="mt-4"><MatchesTab user={user} /></TabsContent>
        <TabsContent value="tips" className="mt-4"><TipsTab user={user} /></TabsContent>
      </Tabs>
    </div>
  )
}

/* ---------------- Snapshot (one engine, aggregated) ---------------- */
function readinessLabel(n: number) {
  if (n >= 85) return { label: 'Market-ready', tone: 'text-success' }
  if (n >= 70) return { label: 'Strong', tone: 'text-success' }
  if (n >= 50) return { label: 'Developing', tone: 'text-warning' }
  return { label: 'Early', tone: 'text-muted-foreground' }
}

function SnapshotTab({ user }: { user: Profile }) {
  const [data, setData] = useState<InsightsData | null>(null)
  const [companies, setCompanies] = useState<Record<string, Profile>>({})
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const [jobs, cs, sc] = await Promise.all([jobsApi.list(user), profilesApi.list('company'), profilesApi.list('school')])
    const cmap: Record<string, Profile> = {}
    ;[...cs, ...sc].forEach((c) => (cmap[c.id] = c))
    setCompanies(cmap)
    setData(await aiApi.insights(jobs, user))
    setLoading(false)
  }
  useEffect(() => { void load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user.id])

  if (loading || !data) {
    return (
      <Card>
        <CardBody className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <Sparkles className="h-7 w-7 animate-pulse text-primary" />
          <p className="text-sm text-muted-foreground">Reading your profile and scoring every open role…</p>
        </CardBody>
      </Card>
    )
  }

  const { label, tone } = readinessLabel(data.readiness)
  const maxGap = Math.max(1, ...data.gaps.map((g) => g.count))
  const maxDemand = Math.max(1, ...data.demand.map((d) => d.count))

  return (
    <div className="space-y-4">
      {/* Readiness + distribution */}
      <Card>
        <CardBody className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <ScoreRing score={data.readiness} size={72} showLabel />
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Market readiness</p>
              <p className={`text-lg font-bold ${tone}`}>{label}</p>
              <p className="text-xs text-muted-foreground">Avg of your top {Math.min(5, data.total)} matches across {data.total} roles</p>
            </div>
          </div>
          <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
            <DistCell label="Excellent" hint="85+" value={data.distribution.excellent} tone="bg-success/15 text-success" />
            <DistCell label="Strong" hint="70–84" value={data.distribution.strong} tone="bg-primary/15 text-primary" />
            <DistCell label="Stretch" hint="50–69" value={data.distribution.stretch} tone="bg-warning/15 text-warning" />
            <DistCell label="Reach" hint="<50" value={data.distribution.weak} tone="bg-muted text-muted-foreground" />
          </div>
        </CardBody>
      </Card>

      {/* Do next */}
      {data.doNext.length > 0 && (
        <Card>
          <CardBody>
            <h2 className="flex items-center gap-2 font-semibold"><Target className="h-5 w-5 text-primary" /> Do this next</h2>
            <ul className="mt-3 space-y-2.5">
              {data.doNext.map((d, i) => (
                <li key={i} className="flex gap-2.5 text-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-bold text-primary">{i + 1}</span>
                  <span className="text-muted-foreground">{d}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Skill gaps to learn next */}
        <Card>
          <CardBody>
            <h2 className="flex items-center gap-2 font-semibold"><GraduationCap className="h-5 w-5 text-warning" /> Learn next</h2>
            <p className="text-sm text-muted-foreground">Skills your matched roles want that aren’t evident in your profile yet.</p>
            {data.gaps.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">No major gaps — nicely done.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {data.gaps.map((g) => (
                  <li key={g.name} className="flex items-center gap-3">
                    <span className="w-32 shrink-0 truncate text-sm font-medium">{g.name}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-warning/70" style={{ width: `${(g.count / maxGap) * 100}%` }} />
                    </div>
                    <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">{g.count} role{g.count > 1 ? 's' : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* Market demand */}
        <Card>
          <CardBody>
            <h2 className="flex items-center gap-2 font-semibold"><TrendingUp className="h-5 w-5 text-primary" /> In demand</h2>
            <p className="text-sm text-muted-foreground">What the open roles ask for most right now.</p>
            <ul className="mt-3 space-y-2">
              {data.demand.map((d) => {
                const mine = data.strengths.some((s) => s.name.toLowerCase() === d.name.toLowerCase())
                return (
                  <li key={d.name} className="flex items-center gap-3">
                    <span className="flex w-32 shrink-0 items-center gap-1 truncate text-sm font-medium">
                      {d.name}{mine && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className={`h-full rounded-full ${mine ? 'bg-success/70' : 'bg-accent/60'}`} style={{ width: `${(d.count / maxDemand) * 100}%` }} />
                    </div>
                    <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">{d.count}</span>
                  </li>
                )
              })}
            </ul>
          </CardBody>
        </Card>
      </div>

      {/* Your strengths */}
      {data.strengths.length > 0 && (
        <Card>
          <CardBody>
            <h2 className="flex items-center gap-2 font-semibold"><Sparkles className="h-5 w-5 text-success" /> Your strengths</h2>
            <p className="text-sm text-muted-foreground">Skills that already match what employers are hiring for.</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {data.strengths.map((s) => <Badge key={s.name} tone="success" className="text-[11px]">{s.name} · {s.count}</Badge>)}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Top matches */}
      {data.topMatches.length > 0 && (
        <Card>
          <CardBody>
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold"><Trophy className="h-5 w-5 text-primary" /> Top matches</h2>
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={load}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
            </div>
            <div className="mt-3 space-y-2">
              {data.topMatches.map((t) => {
                const brand = companies[t.company_id]?.company_name ?? companies[t.company_id]?.full_name
                return (
                  <Link key={t.job_id} to={`/app/jobs?job=${t.job_id}`} className="flex items-center gap-3 rounded-xl border border-border p-3 transition-colors hover:border-primary/40">
                    <ScoreRing score={t.score} size={44} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{t.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{brand ? `${brand} · ` : ''}{t.location} · {t.listing_type}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                )
              })}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  )
}

function DistCell({ label, hint, value, tone }: { label: string; hint: string; value: number; tone: string }) {
  return (
    <div className={`rounded-xl px-3 py-2 ${tone}`}>
      <p className="text-xl font-bold leading-none">{value}</p>
      <p className="mt-1 text-[11px] font-medium leading-tight">{label}</p>
      <p className="text-[10px] opacity-70">{hint}</p>
    </div>
  )
}

/* ---------------- Chat ---------------- */
type Msg = { role: 'user' | 'ai'; text: string }
const PROMPTS = [
  'How can I improve my CV?',
  'Build me a 30-day job-search plan',
  'What skills should I learn next?',
  'Draft a career roadmap',
]

function ChatTab() {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])

  // Append a streamed token to the last AI bubble (or start one).
  const pushToken = (t: string) =>
    setMsgs((m) => {
      const last = m[m.length - 1]
      if (last?.role === 'ai') return [...m.slice(0, -1), { role: 'ai', text: last.text + t }]
      return [...m, { role: 'ai', text: t }]
    })

  async function send(text: string) {
    const q = text.trim()
    if (!q || busy) return
    setInput('')
    setMsgs((m) => [...m, { role: 'user', text: q }])
    setBusy(true)
    setStreaming(false)
    // Stream the answer live; fall back to the non-streaming call if nothing streamed.
    const streamed = await aiApi.chatStream(q, (t) => { setStreaming(true); pushToken(t) })
    if (!streamed) {
      const res = await aiApi.chat(q)
      setMsgs((m) => [...m, { role: 'ai', text: res }])
    }
    setBusy(false)
    setStreaming(false)
  }

  return (
    <Card>
      <CardBody className="flex h-[calc(100dvh-15rem)] flex-col">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {msgs.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/12 text-primary"><Sparkles className="h-6 w-6" /></div>
              <p className="font-medium">Ask me anything about your career</p>
              <p className="mb-4 text-sm text-muted-foreground">CV feedback, job strategy, interview prep, and more.</p>
              <div className="flex flex-wrap justify-center gap-2">
                {PROMPTS.map((p) => (
                  <button key={p} onClick={() => send(p)} className="rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground">{p}</button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground">{m.text}</div>
              </div>
            ) : (
              <div key={i} className="flex gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary"><Sparkles className="h-4 w-4" /></div>
                <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-2"><Markdown content={m.text} /></div>
              </div>
            ),
          )}
          {busy && !streaming && (
            <div className="flex gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary"><Sparkles className="h-4 w-4 animate-pulse" /></div>
              <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3 text-sm text-muted-foreground">Thinking…</div>
            </div>
          )}
          <div ref={endRef} />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(input) }} className="mt-3 flex items-center gap-2 border-t border-border pt-3">
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask anything…" className="h-11 flex-1 rounded-full border border-input bg-background px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <Button type="submit" size="icon" className="h-11 w-11 rounded-full" disabled={busy || !input.trim()}><Send className="h-4 w-4" /></Button>
        </form>
      </CardBody>
    </Card>
  )
}

/* ---------------- Job Matches (click to run) ---------------- */
const RUN_STAGES = [
  { icon: FileSearch, label: 'Reading your résumé & profile…' },
  { icon: ScanLine, label: 'Scanning open opportunities…' },
  { icon: Sparkles, label: 'Scoring each role against your skills…' },
  { icon: Trophy, label: 'Ranking your best matches…' },
]

function MatchesTab({ user }: { user: Profile }) {
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle')
  const [stage, setStage] = useState(0)
  const [scanned, setScanned] = useState(0)
  const [rows, setRows] = useState<{ job: JobListing; match: AiMatch; company?: Profile }[]>([])

  async function run() {
    setPhase('running')
    setStage(0)
    setScanned(0)

    // kick off the real (mock) matching
    const dataPromise = (async () => {
      const [jobs, cs, sc] = await Promise.all([jobsApi.list(user), profilesApi.list('company'), profilesApi.list('school')])
      const cmap: Record<string, Profile> = {}
      ;[...cs, ...sc].forEach((c) => (cmap[c.id] = c))
      const matches = await aiApi.matchAll(user, jobs)
      setScanned(jobs.length)
      const byId = new Map(matches.map((m) => [m.job_id, m]))
      const out: { job: JobListing; match: AiMatch; company?: Profile }[] = []
      for (const j of jobs) {
        const match = byId.get(j.id)
        if (match) out.push({ job: j, match, company: cmap[j.company_id] })
      }
      return out.sort((a, b) => b.match.score - a.match.score)
    })()

    // animate the stage labels while it runs
    for (let i = 0; i < RUN_STAGES.length; i++) {
      setStage(i)
      await sleep(650)
    }
    const merged = await dataPromise
    setRows(merged)
    setPhase('done')
  }

  // Idle — the click target
  if (phase === 'idle') {
    return (
      <Card>
        <CardBody className="flex flex-col items-center justify-center gap-3 py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/12 text-primary"><Sparkles className="h-7 w-7" /></div>
          <h2 className="text-lg font-semibold">Run AI matching</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            We'll read your CV & profile and score every open role 0–99 for fit.
            {!user.cv_filename && ' Tip: upload a CV in your profile for stronger, evidence-based scores.'}
          </p>
          <Button size="lg" className="mt-1 gap-2" onClick={run}><Sparkles className="h-4 w-4" /> Run AI matching</Button>
        </CardBody>
      </Card>
    )
  }

  // Running — visible staged loader
  if (phase === 'running') {
    const pct = Math.round(((stage + 1) / RUN_STAGES.length) * 100)
    return (
      <Card>
        <CardBody className="py-12">
          <div className="mx-auto max-w-md">
            <div className="mb-6 flex justify-center">
              <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                <Sparkles className="h-8 w-8 animate-pulse" />
              </div>
            </div>
            <Progress value={pct} />
            <div className="mt-6 space-y-2.5">
              {RUN_STAGES.map((s, i) => {
                const state = i < stage ? 'done' : i === stage ? 'active' : 'pending'
                return (
                  <div key={i} className={`flex items-center gap-2.5 text-sm transition-opacity ${state === 'pending' ? 'opacity-40' : ''}`}>
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full ${state === 'done' ? 'bg-success/15 text-success' : state === 'active' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
                      {state === 'done' ? <CheckCircle2 className="h-4 w-4" /> : <s.icon className={`h-3.5 w-3.5 ${state === 'active' ? 'animate-pulse' : ''}`} />}
                    </span>
                    <span className={state === 'active' ? 'font-medium' : 'text-muted-foreground'}>{s.label}</span>
                  </div>
                )
              })}
            </div>
            <p className="mt-5 text-center text-xs text-muted-foreground">Scored {scanned} roles…</p>
          </div>
        </CardBody>
      </Card>
    )
  }

  // Done — results
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{rows.length} roles scored · sorted by fit</p>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={run}><RefreshCw className="h-4 w-4" /> Re-run</Button>
      </div>
      {rows.map(({ job, match, company }) => {
        const brand = job.original_company_name || company?.company_name
        return (
          <Card key={job.id} className="transition-shadow hover:shadow-card">
            <CardBody className="flex items-center gap-4">
              <ScoreRing score={match.score} size={56} showLabel />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link to={`/app/jobs?job=${job.id}`} className="truncate font-semibold hover:text-primary">{job.title}</Link>
                </div>
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Avatar name={brand} size={16} /> {brand} · {job.location}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {match.matched_skills.slice(0, 4).map((s) => <Badge key={s} tone="success" className="text-[11px]">{s}</Badge>)}
                </div>
                <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground"><Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /> {match.tip}</p>
              </div>
              <Link to={`/app/jobs?job=${job.id}`}><Button variant="outline" size="sm" className="hidden gap-1 sm:inline-flex">View <ArrowRight className="h-3.5 w-3.5" /></Button></Link>
            </CardBody>
          </Card>
        )
      })}
    </div>
  )
}

/* ---------------- CV Tips ---------------- */
function TipsTab({ user }: { user: Profile }) {
  const [tips, setTips] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)

  async function generate() {
    setLoading(true)
    const t = await aiApi.cvTips(user)
    setTips(t)
    setLoading(false)
  }

  return (
    <Card>
      <CardBody>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 font-semibold"><FileText className="h-5 w-5 text-primary" /> Personalized CV Tips</h2>
            <p className="text-sm text-muted-foreground">AI suggestions based on your profile{user.cv_filename ? ` and ${user.cv_filename}` : ''}.</p>
          </div>
          <Button onClick={generate} loading={loading} className="gap-1.5"><Sparkles className="h-4 w-4" /> {tips ? 'Regenerate' : 'Generate tips'}</Button>
        </div>
        {tips && (
          <ol className="mt-5 space-y-3">
            {tips.map((t, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-bold text-primary">{i + 1}</span>
                <p className="text-sm text-muted-foreground">{t}</p>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  )
}
