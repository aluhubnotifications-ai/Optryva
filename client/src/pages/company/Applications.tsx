import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FileText, ShieldCheck, Sparkles, ArrowRight, Eye, ExternalLink, Check, X, CheckSquare, Square } from 'lucide-react'
import { applicationsApi, jobsApi } from '@/lib/api'
import { useCurrentUser } from '@/lib/store'
import type { Application, ApplicationStatus, JobListing } from '@/types'
import { Card, CardBody, Badge, Avatar, Skeleton } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Textarea } from '@/components/ui/primitives'
import { cn, formatDate } from '@/lib/utils'

const statusTone = { pending: 'default', reviewed: 'primary', shortlisted: 'accent', hired: 'success', rejected: 'danger' } as const
const FILTERS: (ApplicationStatus | 'all')[] = ['all', 'pending', 'reviewed', 'shortlisted', 'hired', 'rejected']

function band(score?: number): 'success' | 'accent' | 'default' | 'danger' {
  if (score == null) return 'default'
  return score >= 75 ? 'success' : score >= 55 ? 'accent' : 'danger'
}
function ScorePill({ label, score }: { label: string; score?: number }) {
  if (score == null) return null
  return <Badge tone={band(score)} className="gap-1"><Sparkles className="h-3 w-3" /> {label} {score}</Badge>
}

export default function CompanyApplications({ initialListingId }: { initialListingId?: string }) {
  const user = useCurrentUser()!
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [jobs, setJobs] = useState<JobListing[]>([])
  const [apps, setApps] = useState<Application[]>([])
  const [opens, setOpens] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<ApplicationStatus | 'all'>('all')
  const [listingFilter, setListingFilter] = useState<string>(initialListingId ?? params.get('listing') ?? 'all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [rejectIds, setRejectIds] = useState<string[] | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  useEffect(() => {
    ;(async () => {
      const [j, a, o] = await Promise.all([jobsApi.byCompany(user.id), applicationsApi.byCompany(user.id), jobsApi.openCounts()])
      setJobs(j); setApps(a); setOpens(o); setLoading(false)
    })()
  }, [user.id])

  const jobMap = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs])
  const inAppJobs = useMemo(() => jobs.filter((j) => !j.apply_url), [jobs])
  const externalJobs = useMemo(() => jobs.filter((j) => j.apply_url), [jobs])

  const filtered = useMemo(() => {
    return apps.filter((a) => (filter === 'all' || a.status === filter) && (listingFilter === 'all' || a.job_id === listingFilter))
  }, [apps, filter, listingFilter])

  function chooseListing(id: string) {
    setListingFilter(id)
    setSelected(new Set())
    setParams(id === 'all' ? {} : { listing: id })
  }
  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  async function bulkAccept(ids: string[]) {
    setBusy(true)
    try { await Promise.all(ids.map((aid) => applicationsApi.setStatus(aid, 'shortlisted'))); await reload() } finally { setBusy(false) }
  }
  async function bulkReject(ids: string[], reason: string) {
    setBusy(true)
    try { await Promise.all(ids.map((aid) => applicationsApi.setStatus(aid, 'rejected', reason))); await reload(); setRejectIds(null); setRejectReason('') } finally { setBusy(false) }
  }
  async function reload() {
    const [j, a, o] = await Promise.all([jobsApi.byCompany(user.id), applicationsApi.byCompany(user.id), jobsApi.openCounts()])
    setJobs(j); setApps(a); setOpens(o); setSelected(new Set())
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><FileText className="h-6 w-6 text-primary" /> Applications</h1>
          <p className="text-sm text-muted-foreground">{apps.length} total across {inAppJobs.length} in-app listing{inAppJobs.length === 1 ? '' : 's'}{externalJobs.length ? ` · ${externalJobs.length} external (tracked by views)` : ''}</p>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">You decide — AI only suggests.</span> Fit/test scores help you prioritise; every accept or reject is a human action and is recorded.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Card key={i}><CardBody><Skeleton className="h-4 w-1/3" /><Skeleton className="mt-2 h-3 w-1/4" /></CardBody></Card>)}</div>
      ) : (
        <>
          <div className="-mx-1 flex flex-wrap items-center gap-1.5 overflow-x-auto px-1">
            {FILTERS.map((f) => {
              const count = f === 'all' ? apps.length : apps.filter((a) => a.status === f).length
              return (
                <button key={f} onClick={() => setFilter(f)} className={cn('flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium capitalize transition-colors', filter === f ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}>
                  {f}<span className="rounded-full bg-muted px-1.5 text-xs">{count}</span>
                </button>
              )
            })}
            <select value={listingFilter} onChange={(e) => chooseListing(e.target.value)} className="ml-auto rounded-lg border border-border bg-card px-2 py-1.5 text-sm">
              <option value="all">All listings</option>
              {inAppJobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
            </select>
          </div>

          {/* Bulk actions */}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setSelected(new Set(filtered.map((a) => a.id)))}>Select all ({filtered.length})</Button>
            {selected.size > 0 && (
              <>
                <span className="text-sm text-muted-foreground">{selected.size} selected</span>
                <Button size="sm" variant="success" className="gap-1.5" onClick={() => bulkAccept([...selected])} loading={busy}><Check className="h-4 w-4" /> Accept selected</Button>
                <Button size="sm" variant="danger" className="gap-1.5" onClick={() => setRejectIds([...selected])} loading={busy}><X className="h-4 w-4" /> Reject selected</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
              </>
            )}
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="default" className="gap-1.5" onClick={() => bulkAccept(filtered.map((a) => a.id))} loading={busy}><CheckSquare className="h-4 w-4" /> Accept all</Button>
              <Button size="sm" variant="danger" className="gap-1.5" onClick={() => setRejectIds(filtered.map((a) => a.id))} loading={busy} disabled={filtered.length === 0}><X className="h-4 w-4" /> Reject all</Button>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">No applications{filter !== 'all' ? ` (${filter})` : ''} yet.</div>
          ) : (
            <div className="space-y-3">
              {filtered.map((a) => {
                const job = jobMap.get(a.job_id)
                return (
                  <button key={a.id} onClick={() => navigate(`/app/applicants/${a.id}`)} className={cn('block w-full text-left', selected.has(a.id) && 'ring-2 ring-primary rounded-2xl')}>
                    <Card className="transition-shadow hover:shadow-card">
                      <CardBody className="flex items-center gap-3">
                        <button type="button" onClick={(e) => { e.stopPropagation(); toggle(a.id) }} className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-primary" aria-label="Select">
                          {selected.has(a.id) ? <CheckSquare className="h-5 w-5 text-primary" /> : <Square className="h-5 w-5" />}
                        </button>
                        <Avatar name={a.full_name} size={44} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold">{a.full_name}</p>
                          <p className="truncate text-sm text-muted-foreground">{job?.title ?? 'Listing'} · {a.school}{a.year ? ` · Year ${a.year}` : ''} · {formatDate(a.created_at)}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <div className="flex gap-1.5">
                            <ScorePill label="Fit" score={a.match_score} />
                            <ScorePill label="Test" score={a.assignment_score} />
                          </div>
                          <Badge tone={statusTone[a.status]} className="capitalize">{a.status === 'hired' ? 'Hired' : a.status}</Badge>
                        </div>
                        <ArrowRight className="hidden h-4 w-4 text-muted-foreground sm:block" />
                      </CardBody>
                    </Card>
                  </button>
                )
              })}
            </div>
          )}

          {externalJobs.length > 0 && (
            <div>
              <h2 className="mb-2 mt-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground"><ExternalLink className="h-4 w-4" /> External listings — tracked by views</h2>
              <div className="space-y-2">
                {externalJobs.map((j) => (
                  <Card key={j.id}>
                    <CardBody className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/12 text-accent"><Eye className="h-5 w-5" /></div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{j.title}</p>
                        <p className="truncate text-sm text-muted-foreground">Candidates apply on the company's site</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-accent">{opens[j.id] ?? 0} view{(opens[j.id] ?? 0) === 1 ? '' : 's'}</span>
                        {j.apply_url && (
                          <a href={j.apply_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
                            <ExternalLink className="h-4 w-4" /> Link
                          </a>
                        )}
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <Modal open={rejectIds !== null} onClose={() => setRejectIds(null)} title="Reject applicants" description="A reason is required and recorded for each applicant.">
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{rejectIds?.length} applicant{rejectIds?.length === 1 ? '' : 's'} will be rejected.</p>
          <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Reason for rejection (e.g. role filled, not a fit for this cohort)…" className="min-h-[100px]" />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejectIds(null)}>Cancel</Button>
            <Button variant="danger" disabled={!rejectReason.trim() || busy} loading={busy} onClick={() => rejectIds && bulkReject(rejectIds, rejectReason.trim())}>Reject with reason</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
