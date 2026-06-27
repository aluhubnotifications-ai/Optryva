import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Compass as CompassIcon, Send, Sparkles, Target, TrendingUp, ListChecks, RefreshCw, ArrowRight } from 'lucide-react'
import { useCurrentUser } from '@/lib/store'
import { aiApi, jobsApi, profilesApi } from '@/lib/api'
import type { JobListing, Profile } from '@/types'
import { Card, CardBody, Badge, Avatar } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { ScoreRing } from '@/components/ScoreRing'

type Msg = { role: 'user' | 'ai'; text: string }
type Rec = Awaited<ReturnType<typeof aiApi.compassRecommend>>['recs'][number]
type Prep = Awaited<ReturnType<typeof aiApi.compassPrep>>

export default function Compass() {
  const user = useCurrentUser()!
  const [jobs, setJobs] = useState<JobListing[]>([])
  const [companies, setCompanies] = useState<Record<string, Profile>>({})
  const [phase, setPhase] = useState<'interview' | 'loading' | 'results'>('interview')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [answers, setAnswers] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [intro, setIntro] = useState('')
  const [signals, setSignals] = useState<string[]>([])
  const [recs, setRecs] = useState<Rec[]>([])
  const [prepJob, setPrepJob] = useState<JobListing | null>(null)
  const [prep, setPrep] = useState<Prep | null>(null)
  const [prepLoading, setPrepLoading] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ;(async () => {
      const [j, cs, sc] = await Promise.all([jobsApi.list(user), profilesApi.list('company'), profilesApi.list('school')])
      const cmap: Record<string, Profile> = {}
      ;[...cs, ...sc].forEach((c) => (cmap[c.id] = c))
      setJobs(j)
      setCompanies(cmap)
      const first = await aiApi.compassInterview([])
      setMsgs([{ role: 'ai', text: first.message }])
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy, phase])

  async function answer(text: string) {
    const a = text.trim()
    if (!a || busy) return
    setInput('')
    setMsgs((m) => [...m, { role: 'user', text: a }])
    const next = [...answers, a]
    setAnswers(next)
    setBusy(true)
    setStreaming(false)
    // Stream the next question live; the greeting/closing turns fall back to the
    // plain endpoint (which also tells us when the interview is done).
    let done = false
    const pushTok = (t: string) =>
      setMsgs((m) => {
        const last = m[m.length - 1]
        if (last?.role === 'ai') return [...m.slice(0, -1), { role: 'ai', text: last.text + t }]
        return [...m, { role: 'ai', text: t }]
      })
    const streamed = await aiApi.compassInterviewStream(next, (t) => { setStreaming(true); pushTok(t) }, (meta) => { done = !!meta?.done })
    if (!streamed) {
      const res = await aiApi.compassInterview(next)
      setMsgs((m) => [...m, { role: 'ai', text: res.message }])
      done = res.done
    }
    setBusy(false)
    setStreaming(false)
    if (done) {
      setPhase('loading')
      const r = await aiApi.compassRecommend(next, jobs, user)
      setIntro(r.intro)
      setSignals(r.signals ?? [])
      setRecs(r.recs)
      setPhase('results')
    }
  }

  async function openPrep(job: JobListing) {
    setPrepJob(job)
    setPrep(null)
    setPrepLoading(true)
    const p = await aiApi.compassPrep(job, user)
    setPrep(p)
    setPrepLoading(false)
  }

  function restart() {
    setPhase('interview')
    setAnswers([])
    setRecs([])
    setSignals([])
    setMsgs([])
    aiApi.compassInterview([]).then((f) => setMsgs([{ role: 'ai', text: f.message }]))
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><CompassIcon className="h-6 w-6 text-primary" /> Career Compass</h1>
          <p className="text-sm text-muted-foreground">A guided AI conversation to find your direction.</p>
        </div>
        {phase === 'results' && <Button variant="outline" size="sm" className="gap-1.5" onClick={restart}><RefreshCw className="h-4 w-4" /> Start over</Button>}
      </div>

      {phase !== 'results' ? (
        <Card>
          <CardBody className="flex h-[calc(100dvh-14rem)] flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
              {msgs.map((m, i) =>
                m.role === 'user' ? (
                  <div key={i} className="flex justify-end"><div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground">{m.text}</div></div>
                ) : (
                  <div key={i} className="flex gap-2">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary"><CompassIcon className="h-4 w-4" /></div>
                    <div className="max-w-[80%] rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-2 text-sm leading-relaxed">{m.text}</div>
                  </div>
                ),
              )}
              {((busy && !streaming) || phase === 'loading') && (
                <div className="flex gap-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary"><Sparkles className="h-4 w-4 animate-pulse" /></div>
                  <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3 text-sm text-muted-foreground">{phase === 'loading' ? 'Finding your matches…' : 'Thinking…'}</div>
                </div>
              )}
              <div ref={endRef} />
            </div>
            <form onSubmit={(e) => { e.preventDefault(); answer(input) }} className="mt-3 flex items-center gap-2 border-t border-border pt-3">
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type your answer…" disabled={phase === 'loading'} className="h-11 flex-1 rounded-full border border-input bg-background px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" />
              <Button type="submit" size="icon" className="h-11 w-11 rounded-full" disabled={busy || phase === 'loading' || !input.trim()}><Send className="h-4 w-4" /></Button>
            </form>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm">
            {intro}
            {signals.length > 0 && (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Weighted for:</span>
                {signals.map((s) => <Badge key={s} tone="primary" className="text-[11px] capitalize">{s}</Badge>)}
              </div>
            )}
          </div>
          {recs.map((rec, i) => {
            const company = companies[rec.job.company_id]
            const brand = rec.job.original_company_name || company?.company_name
            return (
              <motion.div key={rec.job.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}>
                <Card>
                  <CardBody>
                    <div className="flex items-start gap-4">
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-xs font-bold text-muted-foreground">#{i + 1}</span>
                        <ScoreRing score={rec.score} size={52} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Avatar name={brand} src={rec.job.original_company_logo_url || company?.avatar_url} size={28} className="rounded-lg" />
                          <Link to={`/app/jobs?job=${rec.job.id}`} className="font-semibold hover:text-primary">{rec.job.title}</Link>
                        </div>
                        <p className="text-sm text-muted-foreground">{brand} · {rec.job.location}</p>

                        <div className="mt-3 space-y-2 text-sm">
                          <p className="flex gap-2"><Target className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> <span className="text-muted-foreground">{rec.why}</span></p>
                          <p className="flex gap-2"><TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> <span className="text-muted-foreground">{rec.stretch}</span></p>
                        </div>

                        <div className="mt-3 rounded-xl bg-muted/50 p-3">
                          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold"><ListChecks className="h-4 w-4 text-primary" /> Prep actions</p>
                          <ul className="space-y-1">
                            {rec.actions.map((a, ai) => <li key={ai} className="flex gap-1.5 text-xs text-muted-foreground"><span className="text-primary">•</span> {a}</li>)}
                          </ul>
                        </div>

                        <div className="mt-3 flex gap-2">
                          <Button size="sm" className="gap-1.5" onClick={() => openPrep(rec.job)}><Sparkles className="h-4 w-4" /> One-page prep plan</Button>
                          <Link to={`/app/jobs?job=${rec.job.id}`}><Button variant="outline" size="sm" className="gap-1">View role <ArrowRight className="h-3.5 w-3.5" /></Button></Link>
                        </div>
                      </div>
                    </div>
                  </CardBody>
                </Card>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Prep plan modal */}
      <Modal open={!!prepJob} onClose={() => setPrepJob(null)} size="lg" title={prepJob ? `Prep plan — ${prepJob.title}` : 'Prep plan'}>
        {prepLoading || !prep ? (
          <p className="py-10 text-center text-sm text-muted-foreground"><Sparkles className="mx-auto mb-2 h-5 w-5 animate-pulse text-primary" /> Building your plan…</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-success/30 bg-success/5 p-3 text-sm"><span className="font-semibold text-success">Fit. </span>{prep.fit}</div>
            <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 text-sm"><span className="font-semibold text-warning">Gap. </span>{prep.gap}</div>
            <PrepList title="Skills to brush up" items={prep.skills} />
            <PrepList title="Talking points (use in cover letters / interviews)" items={prep.talkingPoints} />
            <PrepList title="Likely interview questions" items={prep.questions} />
            <PrepList title="Do these today" items={prep.actions} />
          </div>
        )}
      </Modal>
    </div>
  )
}

function PrepList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="mb-1.5 text-sm font-semibold">{title}</h3>
      <ul className="space-y-1">
        {items.map((it, i) => <li key={i} className="flex gap-2 text-sm text-muted-foreground"><span className="text-primary">•</span> {it}</li>)}
      </ul>
    </div>
  )
}
