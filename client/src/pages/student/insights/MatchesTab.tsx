import { useEffect, useState } from 'react'
import { Sparkles, RefreshCw, Lightbulb, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { jobsApi } from '@/lib/api'
import type { AiMatch, JobListing, Profile } from '@/types'
import { Card, CardBody, Badge, Avatar, Progress } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { ScoreRing } from '@/components/ScoreRing'
import { useMatchProgress } from '@/lib/matchProgress'

export function MatchesTab({ user }: { user: Profile }) {
  const { phase, done, total, label, matches } = useMatchProgress()
  const [jobs, setJobs] = useState<JobListing[]>([])

  // Load jobs once for rendering. Jobs embed company_name/avatar, so no separate
  // directory fetch is needed. Matching is driven by the global store (visible in
  // the AI activity panel) and keeps running even when you switch tabs.
  useEffect(() => {
    jobsApi.list(user).then(setJobs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id])

  const jobsById = new Map(jobs.map((j) => [j.id, j]))
  const rows = matches
    .map((m) => ({ job: jobsById.get(m.job_id), match: m }))
    .filter((r): r is { job: JobListing; match: AiMatch } => !!r.job)
    .sort((a, b) => b.match.score - a.match.score)

  const run = () => useMatchProgress.getState().run(user.id, true)
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  // Idle / first run (or an error with nothing scored yet) — the click target.
  if (phase === 'idle' || (phase !== 'running' && matches.length === 0)) {
    return (
      <Card>
        <CardBody className="flex flex-col items-center justify-center gap-3 py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/12 text-primary"><Sparkles className="h-7 w-7" /></div>
          <h2 className="text-lg font-semibold">Run AI matching</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            We'll read your CV & profile and score every open role 0–99 for fit. You can switch tabs — progress keeps running in the AI activity panel (bottom-right).
            {!user.cv_filename && ' Tip: upload a CV in your profile for stronger, evidence-based scores.'}
          </p>
          {phase === 'error' && <p className="text-sm text-danger">AI is unavailable right now — please try again.</p>}
          <Button size="lg" className="mt-1 gap-2" onClick={run}><Sparkles className="h-4 w-4" /> Run AI matching</Button>
        </CardBody>
      </Card>
    )
  }

  // Running or done — live progress; results stream in as each role is scored.
  return (
    <div className="space-y-3">
      {phase === 'running' && (
        <Card>
          <CardBody className="py-6">
            <div className="mx-auto max-w-md">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 font-medium"><Sparkles className="h-4 w-4 animate-pulse text-primary" /> Scoring your matches…</span>
                <span className="font-semibold text-primary">{pct}%</span>
              </div>
              <Progress value={pct} />
              <p className="mt-2 truncate text-xs text-muted-foreground">{done} of {total} roles{label ? ` · ${label}` : ''}</p>
            </div>
          </CardBody>
        </Card>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-sm text-muted-foreground">{rows.length} role{rows.length === 1 ? '' : 's'} scored{phase === 'running' ? ' so far' : ' · sorted by fit'}</p>
        <Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={run} disabled={phase === 'running'}><RefreshCw className="h-4 w-4" /> {phase === 'running' ? 'Running…' : 'Re-run'}</Button>
      </div>
      {rows.map(({ job, match }) => {
        const brand = job.original_company_name || job.company_name
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
