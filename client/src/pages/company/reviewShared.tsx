import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, CheckSquare, ExternalLink, Eye, ShieldCheck, Sparkles, Square, X } from 'lucide-react'
import { applicationsApi } from '@/lib/api'
import type { Application, ApplicationStatus, JobListing } from '@/types'
import { Avatar, Badge, Card, CardBody, Skeleton, Textarea } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { avatarRingStyle, TagDot } from '@/pages/company/ApplicantView'
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
                      {(a.tags?.length ?? 0) > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {a.tags!.map((t) => (
                            <TagDot key={t} tag={t} active={(a.tags ?? []).includes(t)} />
                          ))}
                        </div>
                      )}
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
