import { useEffect, useState } from 'react'
import { Sparkles, TrendingUp, Trophy, Lightbulb, Target, GraduationCap, CheckCircle2, ArrowRight, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { aiApi, jobsApi } from '@/lib/api'
import type { AiMatch, JobListing, Profile } from '@/types'
import { Card, CardBody, Badge, Progress } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { ScoreRing } from '@/components/ScoreRing'
import { useMatchProgress } from '@/lib/matchProgress'
import { readinessLabel, DistCell } from './shared'

export function SnapshotTab({ user }: { user: Profile }) {
  const { phase, done, total, label, matches } = useMatchProgress()
  const selectedResumeId = useMatchProgress((s) => s.selectedResumeId)
  const [jobs, setJobs] = useState<JobListing[]>([])
  const [nudges, setNudges] = useState<{ title: string; message: string; status: string }[]>([])

  // Jobs + the cheap, AI-free "application progress" nudges. No re-scoring here.
  useEffect(() => {
    let active = true
    Promise.all([jobsApi.list(user), aiApi.outcomeNudges()])
      .then(([js, ns]) => {
        if (!active) return
        setJobs(js)
        setNudges(Array.isArray(ns) ? ns : [])
      })
      .catch(() => {})
    return () => { active = false }
  }, [user.id])

  // Reuse the GLOBAL match run (same source as Job Matches + the dashboard idle
  // task) instead of scoring every role again. Kick it off if it hasn't started —
  // but run() is idempotent, so we never double-score.
  useEffect(() => {
    if (phase === 'idle' && matches.length === 0) useMatchProgress.getState().run(user.id, false, selectedResumeId ?? undefined)
  }, [phase, matches.length, user.id])

  const jobsById = new Map(jobs.map((j) => [j.id, j]))
  const rows = matches
    .map((m) => { const job = jobsById.get(m.job_id); return job ? { job, match: m } : null })
    .filter((r): r is { job: JobListing; match: AiMatch } => !!r)
    .sort((a, b) => b.match.score - a.match.score)

  // Everything below is derived client-side from the already-computed matches +
  // job tags — no extra AI calls, no duplicate scoring.
  const scores = rows.map((r) => r.match.score)
  const readiness = scores.length ? Math.round(scores.slice(0, 5).reduce((a, b) => a + b, 0) / Math.min(5, scores.length)) : 0
  const distribution = {
    excellent: scores.filter((s) => s >= 85).length,
    strong: scores.filter((s) => s >= 70 && s < 85).length,
    stretch: scores.filter((s) => s >= 50 && s < 70).length,
    weak: scores.filter((s) => s < 50).length,
  }
  const gapCount = new Map<string, number>()
  const strengthCount = new Map<string, number>()
  const demandCount = new Map<string, number>()
  for (const { job, match } of rows) {
    const tags = (job.tags ?? []) as string[]
    const matched = match.matched_skills
    for (const t of tags) demandCount.set(t, (demandCount.get(t) ?? 0) + 1)
    for (const s of matched) strengthCount.set(s, (strengthCount.get(s) ?? 0) + 1)
    for (const t of tags) if (!matched.includes(t)) gapCount.set(t, (gapCount.get(t) ?? 0) + 1)
  }
  const rank = (mp: Map<string, number>, n: number) => [...mp.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }))
  const gaps = rank(gapCount, 8)
  const strengths = rank(strengthCount, 8)
  const demand = rank(demandCount, 10)
  const topMatches = rows.slice(0, 5).map((r) => ({ job_id: r.job.id, title: r.job.title, company_id: r.job.company_id, listing_type: r.job.listing_type, location: r.job.location, score: r.match.score }))
  const reachableAll = rows
    .filter((r) => r.match.score >= 52 && r.match.score < 80)
    .map((r) => ({ job: r.job, score: r.match.score, missing: ((r.job.tags ?? []) as string[]).filter((t) => !r.match.matched_skills.includes(t)) }))
    .filter((r) => r.missing.length >= 1 && r.missing.length <= 3)
  const reachable = reachableAll
    .sort((a, b) => a.missing.length - b.missing.length || b.score - a.score)
    .slice(0, 6)
    .map((r) => ({ job_id: r.job.id, title: r.job.title, company_id: r.job.company_id, listing_type: r.job.listing_type, location: r.job.location, score: r.score, missing: r.missing, bridge: `Add ${r.missing.join(' & ')} to qualify.` }))
  const unlockMap = new Map<string, string[]>()
  for (const r of reachableAll) for (const s of r.missing) (unlockMap.get(s) ?? unlockMap.set(s, []).get(s)!).push(r.job.title)
  const unlocks = [...unlockMap.entries()].map(([skill, titles]) => ({ skill, count: titles.length, roles: titles.slice(0, 4) })).sort((a, b) => b.count - a.count).slice(0, 5)

  const noCv = !(user.cv_filename || (user as { cv_text?: string }).cv_text)
  const doNext: string[] = []
  if (noCv) doNext.push('Upload your CV — without it every match is capped at 60.')
  if (gaps[0]) doNext.push(`Learn ${gaps[0].name} — it’s asked for in ${gaps[0].count} of your matched roles.`)
  if (gaps[1]) doNext.push(`Build a small project using ${gaps[1].name} to close your second-biggest gap.`)
  if (topMatches[0]) doNext.push(`Apply to your strongest match: ${topMatches[0].title} (${topMatches[0].score}% fit).`)
  if ((user.skills?.length ?? 0) < 4) doNext.push('Add a few more skills to your profile so the matcher can find more roles for you.')

  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  if (jobs.length === 0) {
    return (
      <Card>
        <CardBody className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <Sparkles className="h-7 w-7 animate-pulse text-primary" />
          <p className="text-sm text-muted-foreground">Loading your roles…</p>
        </CardBody>
      </Card>
    )
  }
  if (matches.length === 0) {
    if (phase === 'notReady') {
      return (
        <Card>
          <CardBody className="flex flex-col items-center justify-center gap-3 py-14 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/12 text-primary"><Sparkles className="h-7 w-7" /></div>
            <h2 className="text-lg font-semibold">Finish your profile first</h2>
            <p className="max-w-sm text-sm text-muted-foreground">Add a CV and your preferences so we can match you to open roles.</p>
            <Link to="/app/profile"><Button size="lg" className="mt-1 gap-2"><Sparkles className="h-4 w-4" /> Complete profile</Button></Link>
          </CardBody>
        </Card>
      )
    }
    if (phase === 'running' || phase === 'idle') {
      return (
        <Card>
          <CardBody className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Sparkles className="h-7 w-7 animate-pulse text-primary" />
            <p className="text-sm text-muted-foreground">{total ? `Scoring your ${total} open role${total === 1 ? '' : 's'}…` : 'Reading your profile and scoring every open role…'}</p>
            <div className="w-56">
              <Progress value={pct} />
              <p className="mt-1.5 text-xs font-medium text-muted-foreground">{pct}%{label ? ` · ${label}` : ''}</p>
            </div>
          </CardBody>
        </Card>
      )
    }
    return (
      <Card>
        <CardBody className="flex flex-col items-center justify-center gap-3 py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/12 text-primary"><Sparkles className="h-7 w-7" /></div>
          <h2 className="text-lg font-semibold">No matches yet</h2>
          <p className="max-w-sm text-sm text-muted-foreground">We couldn’t find open roles to match you against right now.</p>
        </CardBody>
      </Card>
    )
  }

  const { label: rLabel, tone } = readinessLabel(readiness)
  const maxGap = Math.max(1, ...gaps.map((g) => g.count))
  const maxDemand = Math.max(1, ...demand.map((d) => d.count))

  return (
    <div className="space-y-4">
      {/* Readiness + distribution */}
      <Card>
        <CardBody className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <ScoreRing score={readiness} size={72} showLabel />
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Market readiness</p>
              <p className={`text-lg font-bold ${tone}`}>{rLabel}</p>
              <p className="text-xs text-muted-foreground">Avg of your top {Math.min(5, rows.length)} matches across {rows.length} roles</p>
            </div>
          </div>
          <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
            <DistCell label="Excellent" hint="85+" value={distribution.excellent} tone="bg-success/15 text-success" />
            <DistCell label="Strong" hint="70–84" value={distribution.strong} tone="bg-primary/15 text-primary" />
            <DistCell label="Stretch" hint="50–69" value={distribution.stretch} tone="bg-warning/15 text-warning" />
            <DistCell label="Reach" hint="<50" value={distribution.weak} tone="bg-muted text-muted-foreground" />
          </div>
        </CardBody>
      </Card>

      {/* Application progress — what we learned after you applied (outcome tracking) */}
      {(nudges?.length ?? 0) > 0 && (
        <Card>
          <CardBody>
            <h2 className="flex items-center gap-2 font-semibold"><TrendingUp className="h-5 w-5 text-success" /> Your application progress</h2>
            <p className="text-sm text-muted-foreground">What we’re seeing since you applied — and how to keep moving toward the offer.</p>
            <ul className="mt-3 space-y-2.5">
              {nudges!.map((n, i) => (
                <li key={i} className="flex gap-2.5 text-sm">
                  {n.status === 'likely_hired'
                    ? <Trophy className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    : <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
                  <span className="text-muted-foreground">{n.message}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {/* Roles within reach — trajectory: stretch roles a few learnable skills away */}
      {(reachable?.length ?? 0) > 0 && (
        <Card>
          <CardBody>
            <h2 className="flex items-center gap-2 font-semibold"><Lightbulb className="h-5 w-5 text-warning" /> Roles within reach</h2>
            <p className="text-sm text-muted-foreground">You’re close on these — a few learnable skills away from qualifying.</p>
            {(unlocks?.[0]?.count ?? 0) > 1 && (
              <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-sm">
                <span className="font-medium text-foreground">Highest-leverage move:</span> learning{' '}
                <span className="font-semibold text-warning">{unlocks![0].skill}</span> unlocks {unlocks![0].count} of these roles.
              </p>
            )}
            <ul className="mt-3 space-y-3">
              {reachable!.map((r) => (
                <li key={r.job_id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{r.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{r.score}% now</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Add</span>
                    {r.missing.map((s) => (
                      <span key={s} className="rounded-full bg-warning/12 px-2 py-0.5 text-xs font-medium text-warning">{s}</span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {/* Do next */}
      {doNext.length > 0 && (
        <Card>
          <CardBody>
            <h2 className="flex items-center gap-2 font-semibold"><Target className="h-5 w-5 text-primary" /> Do this next</h2>
            <ul className="mt-3 space-y-2.5">
              {doNext.map((d, i) => (
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
            {gaps.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">No major gaps — nicely done.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {gaps.map((g) => (
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
              {demand.map((d) => {
                const mine = strengths.some((s) => s.name.toLowerCase() === d.name.toLowerCase())
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
      {strengths.length > 0 && (
        <Card>
          <CardBody>
            <h2 className="flex items-center gap-2 font-semibold"><Sparkles className="h-5 w-5 text-success" /> Your strengths</h2>
            <p className="text-sm text-muted-foreground">Skills that already match what employers are hiring for.</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {strengths.map((s) => <Badge key={s.name} tone="success" className="text-[11px]">{s.name} · {s.count}</Badge>)}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Top matches */}
      {topMatches.length > 0 && (
        <Card>
          <CardBody>
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold"><Trophy className="h-5 w-5 text-primary" /> Top matches</h2>
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => useMatchProgress.getState().run(user.id, true, selectedResumeId ?? undefined)}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
            </div>
            <div className="mt-3 space-y-2">
              {topMatches.map((t) => {
                const jt = jobsById.get(t.job_id)
                const brand = jt?.original_company_name || jt?.company_name
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
