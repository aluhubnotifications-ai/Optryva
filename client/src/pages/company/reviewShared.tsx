import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, CheckSquare, ExternalLink, Eye, RefreshCw, ShieldCheck, Sparkles, Square, X } from 'lucide-react'
import { applicationsApi, jobsApi } from '@/lib/api'
import type { SmartShortlistResponse } from '@/lib/api'
import type { Application, ApplicationStatus, JobListing } from '@/types'
import { Avatar, Badge, Card, CardBody, Skeleton, Textarea } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { avatarRingStyle } from '@/pages/company/ApplicantView'
import { cn, formatDate } from '@/lib/utils'

export const statusTone = { draft: 'outline', pending: 'default', reviewed: 'primary', shortlisted: 'accent', hired: 'success', rejected: 'danger', cancelled: 'danger' } as const
export const FILTERS: (ApplicationStatus | 'all')[] = ['all', 'pending', 'reviewed', 'shortlisted', 'hired', 'rejected']

export function band(score?: number): 'success' | 'accent' | 'default' | 'danger' {
  if (score == null) return 'default'
  return score >= 75 ? 'success' : score >= 55 ? 'accent' : 'danger'
}

export function ScorePill({ label, score }: { label: string; score?: number }) {
  if (score == null) return null
  return (
    <Badge tone={band(score)} className="gap-1">
      <Sparkles className="h-3 w-3" /> {label} {score}
    </Badge>
  )
}

export function HumanAuthorityBanner() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
      <p className="text-muted-foreground">
        <span className="font-medium text-foreground">You decide — AI only suggests.</span> Fit and test scores help you prioritise; every accept or reject is a human action and is recorded.
      </p>
    </div>
  )
}

export function ApplicantInbox({
  apps,
  jobs,
  loading,
  showListing = false,
  emptyLabel = 'No applications yet.',
  onReload,
}: {
  apps: Application[]
  jobs: JobListing[]
  loading: boolean
  showListing?: boolean
  emptyLabel?: string
  onReload: () => Promise<void>
}) {
  const [filter, setFilter] = useState<ApplicationStatus | 'all'>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [rejectIds, setRejectIds] = useState<string[] | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const jobMap = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs])
  const filtered = useMemo(
    () => (filter === 'all' ? apps : apps.filter((a) => a.status === filter)),
    [apps, filter],
  )

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function bulkAccept(ids: string[]) {
    setBusy(true)
    try {
      await Promise.all(ids.map((aid) => applicationsApi.setStatus(aid, 'shortlisted')))
      await onReload()
      setSelected(new Set())
    } finally {
      setBusy(false)
    }
  }

  async function bulkReject(ids: string[], reason: string) {
    setBusy(true)
    try {
      await Promise.all(ids.map((aid) => applicationsApi.setStatus(aid, 'rejected', reason)))
      await onReload()
      setSelected(new Set())
      setRejectIds(null)
      setRejectReason('')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardBody>
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="mt-2 h-3 w-1/4" />
            </CardBody>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <>
      <HumanAuthorityBanner />

      <div className="-mx-1 flex flex-wrap items-center gap-1.5 overflow-x-auto px-1">
        {FILTERS.map((f) => {
          const count = f === 'all' ? apps.length : apps.filter((a) => a.status === f).length
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium capitalize transition-colors',
                filter === f ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {f}
              <span className="rounded-full bg-muted px-1.5 text-xs">{count}</span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setSelected(new Set(filtered.map((a) => a.id)))}>
          Select all ({filtered.length})
        </Button>
        {selected.size > 0 && (
          <>
            <span className="text-sm text-muted-foreground">{selected.size} selected</span>
            <Button size="sm" variant="success" className="gap-1.5" onClick={() => bulkAccept([...selected])} loading={busy}>
              <Check className="h-4 w-4" /> Shortlist selected
            </Button>
            <Button size="sm" variant="danger" className="gap-1.5" onClick={() => setRejectIds([...selected])} loading={busy}>
              <X className="h-4 w-4" /> Reject selected
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </>
        )}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="default" className="gap-1.5" onClick={() => bulkAccept(filtered.map((a) => a.id))} loading={busy} disabled={filtered.length === 0}>
            <CheckSquare className="h-4 w-4" /> Shortlist all
          </Button>
          <Button size="sm" variant="danger" className="gap-1.5" onClick={() => setRejectIds(filtered.map((a) => a.id))} loading={busy} disabled={filtered.length === 0}>
            <X className="h-4 w-4" /> Reject all
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          {emptyLabel}
          {filter !== 'all' ? ` (${filter})` : ''}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => {
            const job = jobMap.get(a.job_id)
            return (
              <Link
                key={a.id}
                to={`/app/applicants/${a.id}`}
                className={cn('block', selected.has(a.id) && 'rounded-2xl ring-2 ring-primary')}
              >
                <Card className="transition-shadow hover:shadow-card">
                  <CardBody className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        toggle(a.id)
                      }}
                      className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-primary"
                      aria-label="Select applicant"
                    >
                      {selected.has(a.id) ? <CheckSquare className="h-5 w-5 text-primary" /> : <Square className="h-5 w-5" />}
                    </button>
                    <Avatar name={a.full_name} src={a.student_avatar_url} size={44} style={avatarRingStyle(a.tags)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{a.full_name}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {showListing && job ? (
                          <>
                            <span className="font-medium text-foreground">{job.title}</span>
                            {' · '}
                          </>
                        ) : null}
                        {a.school}
                        {a.year ? ` · Year ${a.year}` : ''} · {formatDate(a.created_at)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <div className="flex gap-1.5">
                        <ScorePill label="Fit" score={a.match_score} />
                        <ScorePill label="Test" score={a.assignment_score} />
                      </div>
                      <Badge tone={statusTone[a.status]} className="capitalize">
                        {a.status === 'hired' ? 'Hired' : a.status}
                      </Badge>
                    </div>
                    <ArrowRight className="hidden h-4 w-4 text-muted-foreground sm:block" />
                  </CardBody>
                </Card>
              </Link>
            )
          })}
        </div>
      )}

      <Modal open={rejectIds !== null} onClose={() => setRejectIds(null)} title="Reject applicants" description="A reason is required and recorded for each applicant.">
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {rejectIds?.length} applicant{rejectIds?.length === 1 ? '' : 's'} will be rejected.
          </p>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason for rejection (e.g. role filled, not a fit for this cohort)…"
            className="min-h-[100px]"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejectIds(null)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={!rejectReason.trim() || busy} loading={busy} onClick={() => rejectIds && bulkReject(rejectIds, rejectReason.trim())}>
              Reject with reason
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

export function ExternalListingPanel({ job, opens }: { job: JobListing; opens: number }) {
  return (
    <Card>
      <CardBody className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/12 text-accent">
          <Eye className="h-7 w-7" />
        </div>
        <p className="text-3xl font-bold text-accent">{opens}</p>
        <p className="text-sm font-medium">{opens === 1 ? 'person' : 'people'} opened the apply link</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          This listing applies on the company&apos;s own site — Optryva tracks clicks to the apply link instead of receiving applications here.
        </p>
        {job.apply_url && (
          <a href={job.apply_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
            <ExternalLink className="h-4 w-4" /> View apply destination
          </a>
        )}
      </CardBody>
    </Card>
  )
}

export function SmartShortlist({ jobId }: { jobId: string }) {
  const [data, setData] = useState<SmartShortlistResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [retries, setRetries] = useState(0)

  const load = useCallback(() => {
    setLoading(true)
    jobsApi
      .shortlist(jobId)
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [jobId])

  useEffect(() => {
    let alive = true
    const run = () => jobsApi.shortlist(jobId).then((d) => alive && setData(d)).catch(() => alive && setData(null)).finally(() => alive && setLoading(false))
    setLoading(true)
    setRetries(0)
    run()
    return () => {
      alive = false
    }
  }, [jobId])

  // If scoring is still incomplete (some candidates unscored), keep retrying in the
  // background so the ranking fills in while the employer waits. Silent (no loading
  // flicker) — the result just updates to scored when the scorer succeeds.
  useEffect(() => {
    if (data && data.total && data.scored != null && data.scored < data.total && retries < 4) {
      const t = setTimeout(() => {
        setRetries((r) => r + 1)
        jobsApi.shortlist(jobId).then(setData).catch(() => {})
      }, 2500)
      return () => clearTimeout(t)
    }
  }, [data, retries, jobId])

  async function act(applicationId: string, status: string) {
    setBusyId(applicationId)
    try {
      await applicationsApi.setStatus(applicationId, status as any)
      load()
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" /> Scoring candidates against this role…
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardBody>
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="mt-2 h-3 w-1/4" />
            </CardBody>
          </Card>
        ))}
      </div>
    )
  }

  if (!data || !data.candidates.length) {
    return (
      <Card>
        <CardBody className="py-12 text-center text-sm text-muted-foreground">
          <p className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Sparkles className="h-6 w-6" />
          </p>
          {data?.note ?? 'No applicants for this role yet.'}
        </CardBody>
      </Card>
    )
  }

  return (
    <>
      <HumanAuthorityBanner />
      {/* Cache status + employer re-score action. (Scoring progress is shown only
          during loading; the loaded view just shows the result — cached or fresh.) */}
      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium">Smart Shortlist</p>
          <div className="flex items-center gap-2">
            {data.cached && (
              <Badge tone="outline">
                Cached{data.computed_at ? ` · ${formatDate(data.computed_at)}` : ''}
              </Badge>
            )}
            {data.rescored && <Badge tone="success">Re-scored</Badge>}
            <Button size="sm" variant="outline" onClick={async () => { setBusyId('rescore'); try { setData(await jobsApi.rescoreShortlist(jobId)) } finally { setBusyId(null) } }} disabled={busyId === 'rescore'}>
              <RefreshCw className="h-3.5 w-3.5" /> Rescore
            </Button>
          </div>
        </CardBody>
      </Card>
      {data.mistral && data.summary && (
        <Card>
          <CardBody>
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Sparkles className="h-4 w-4 text-primary" /> AI shortlist summary
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{data.summary}</p>
          </CardBody>
        </Card>
      )}
      {!data.mistral && (
        <div className="rounded-xl border border-amber-300/40 bg-amber-50/60 p-3 text-xs text-amber-700">
          Mistral isn’t configured, so this shortlist shows the matching model’s scores and reasons only. Add a Mistral key to get per-candidate fit verdicts and decision notes.
        </div>
      )}
       <div className="space-y-3">
        {data.candidates.map((c) => {
          const displayScore = Math.round(c.fit_score ?? c.score * 100)
          const categoryTone = c.category === 'not_qualified' ? 'danger' : c.category === 'potential_fit' ? 'success' : 'accent'
          const categoryLabel =
            c.category === 'not_qualified' ? 'Not qualified on evidence' : c.category === 'insufficient_evidence' ? 'Insufficient evidence' : c.category === 'potential_fit' ? 'Potential fit' : null
          return (
            <Card key={c.student_id}>
              <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
                <Avatar name={c.name} src={c.avatar_url ?? undefined} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="font-semibold">{c.name}</p>
                    {c.major && <span className="text-sm text-muted-foreground">{c.major}</span>}
                    {c.location && <span className="text-xs text-muted-foreground">· {c.location}</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {c.score_unavailable ? (
                      <>
                        <Badge tone="outline">Not scored</Badge>
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                          Match score unavailable — AI estimate only
                        </span>
                      </>
                    ) : (
                      <ScorePill label="Fit" score={displayScore} />
                    )}
                    {c.verdict && (
                      <Badge tone={c.verdict === 'strong' ? 'success' : c.verdict === 'weak' ? 'danger' : 'accent'} className="capitalize">
                        {c.verdict}
                      </Badge>
                    )}
                    {categoryLabel && <Badge tone={categoryTone}>{categoryLabel}</Badge>}
                    {c.applied && c.application_id && (
                      <Link to={`/app/applicants/${c.application_id}`} className="text-xs font-medium text-primary hover:underline">
                        View application
                      </Link>
                    )}
                    {c.resume_changed && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                        <RefreshCw className="h-3 w-3" /> Résumé edited since applying
                      </span>
                    )}
                  </div>

                  {/* Assessment status */}
                  {c.assessment_status && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                      <Badge tone={c.assessment_status === 'completed' ? 'success' : c.assessment_status === 'started' ? 'accent' : 'outline'}>
                        Assessment: {c.assessment_status}
                      </Badge>
                      {c.assessment_score != null && <span className="font-medium text-foreground">Score {c.assessment_score}</span>}
                      {c.assessment_status !== 'completed' && <span className="text-muted-foreground">· Request assessment before deciding</span>}
                    </div>
                  )}

                  {c.decision_note && <p className="mt-2 text-sm text-foreground">{c.decision_note}</p>}
                  {c.matched_skills.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {c.matched_skills.map((s) => (
                        <Badge key={s} tone="primary" className="text-xs">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Score breakdown (when available) */}
                  {c.breakdown && (
                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
                      {Object.entries(c.breakdown).map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between gap-1">
                          <span className="capitalize">{k}</span>
                          <span className="font-medium text-foreground">{Math.round((v as number) * 100)}%</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {c.reasons.length > 0 && (
                    <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                      {c.reasons.slice(0, 3).map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  )}

                  {/* Employer actions */}
                  {c.applied && c.application_id && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="subtle" onClick={() => act(c.application_id!, 'shortlisted')} disabled={busyId === c.application_id}>
                        <CheckSquare className="h-3.5 w-3.5" /> Shortlist
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => act(c.application_id!, 'rejected')} disabled={busyId === c.application_id}>
                        <X className="h-3.5 w-3.5" /> Pass
                      </Button>
                      <Link to={`/app/applicants/${c.application_id}`}>
                        <Button size="sm" variant="ghost">
                          <Eye className="h-3.5 w-3.5" /> Review
                        </Button>
                      </Link>
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>
          )
        })}
      </div>
    </>
  )
}
