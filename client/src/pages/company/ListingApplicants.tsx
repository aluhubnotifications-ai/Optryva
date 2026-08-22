import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Users, ArrowRight, FileText, Eye, ExternalLink, ShieldCheck, Sparkles, Check, X, CheckSquare, Square } from 'lucide-react'
import { applicationsApi, jobsApi } from '@/lib/api'
import { useCurrentUser } from '@/lib/store'
import type { Application, ApplicationStatus, JobListing } from '@/types'
import { Card, CardBody, Badge, Avatar, Skeleton, Textarea } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { JobPostingView } from '@/components/JobPostingView'
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

export default function ListingApplicants() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const user = useCurrentUser()!
  const [job, setJob] = useState<JobListing | null>(null)
  const [apps, setApps] = useState<Application[]>([])
  const [opens, setOpens] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<ApplicationStatus | 'all'>('all')
  const [tab, setTab] = useState<'details' | 'applicants'>(params.get('tab') === 'applicants' ? 'applicants' : 'details')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [rejectIds, setRejectIds] = useState<string[] | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  async function load() {
    if (!id) return
    const [j, a, o] = await Promise.all([jobsApi.get(id), applicationsApi.byJob(id), jobsApi.openCounts()])
    setJob(j); setApps(a); setOpens(o[id] ?? 0); setLoading(false)
  }
  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // External listings apply off-platform, so applications never reach Optryva —
  // we report unique people who opened the apply link ("views") instead.
  const external = !!job?.apply_url
  const filtered = useMemo(() => (filter === 'all' ? apps : apps.filter((a) => a.status === filter)), [apps, filter])
  const brand = job?.original_company_name || user.company_name || user.full_name
  const logo = job?.original_company_logo_url || user.avatar_url

  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function selectAllFiltered() { setSelected(new Set(filtered.map((a) => a.id))) }
  function clearSelection() { setSelected(new Set()) }

  async function bulkAccept(ids: string[]) {
    setBusy(true)
    try {
      await Promise.all(ids.map((aid) => applicationsApi.setStatus(aid, 'shortlisted')))
      await load(); clearSelection()
    } finally { setBusy(false) }
  }
  async function bulkReject(ids: string[], reason: string) {
    setBusy(true)
    try {
      await Promise.all(ids.map((aid) => applicationsApi.setStatus(aid, 'rejected', reason)))
      await load(); clearSelection(); setRejectIds(null); setRejectReason('')
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <Link to="/app/listings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to listings</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{job?.title ?? 'Listing'}</h1>
          <p className="text-sm text-muted-foreground">
            {job?.location}{job ? ` · ${job.listing_type}` : ''} · {external ? `${opens} view${opens === 1 ? '' : 's'}` : `${apps.length} applicant${apps.length === 1 ? '' : 's'}`}
          </p>
        </div>
        {job && <Badge tone={job.status === 'active' ? 'success' : 'default'} className="capitalize">{job.status}</Badge>}
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 border-b border-border">
        {([['details', 'Job details'], ['applicants', external ? `Views (${opens})` : `Applicants (${apps.length})`]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {key === 'details' ? <FileText className="h-4 w-4" /> : external ? <Eye className="h-4 w-4" /> : <Users className="h-4 w-4" />} {label}
          </button>
        ))}
      </div>

      {loading || !job ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Card key={i}><CardBody><Skeleton className="h-4 w-1/3" /><Skeleton className="mt-2 h-3 w-1/4" /></CardBody></Card>)}</div>
      ) : tab === 'details' ? (
        <Card><CardBody><JobPostingView job={job} brand={brand} logo={logo} /></CardBody></Card>
      ) : external ? (
        // External apply: applications happen on the company's own site, so we
        // can't list applicants — we report how many people opened the apply link.
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/12 text-accent"><Eye className="h-7 w-7" /></div>
            <p className="text-3xl font-bold text-accent">{opens}</p>
            <p className="text-sm font-medium">{opens === 1 ? 'person' : 'people'} opened the apply link</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              This is an external listing — candidates apply on the company's own site, so Optryva tracks
              clicks to the apply link instead of receiving applications here.
            </p>
            {job.apply_url && (
              <a href={job.apply_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
                <ExternalLink className="h-4 w-4" /> View apply destination
              </a>
            )}
          </CardBody>
        </Card>
      ) : (
        <>
          {/* Human-authority banner */}
          <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">You decide — AI only suggests.</span> AI fit/test scores help you prioritise, but every accept or reject is a
              human action and is recorded. Rejections require a reason.
            </p>
          </div>

          <div className="-mx-1 flex flex-wrap items-center gap-1.5 overflow-x-auto px-1">
            {FILTERS.map((f) => {
              const count = f === 'all' ? apps.length : apps.filter((a) => a.status === f).length
              return (
                <button key={f} onClick={() => setFilter(f)} className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium capitalize transition-colors ${filter === f ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}>
                  {f}<span className="rounded-full bg-muted px-1.5 text-xs">{count}</span>
                </button>
              )
            })}
          </div>

          {/* Bulk actions */}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={selectAllFiltered}>Select all ({filtered.length})</Button>
            {selected.size > 0 && (
              <>
                <span className="text-sm text-muted-foreground">{selected.size} selected</span>
                <Button size="sm" variant="success" className="gap-1.5" onClick={() => bulkAccept([...selected])} loading={busy}><Check className="h-4 w-4" /> Accept selected</Button>
                <Button size="sm" variant="danger" className="gap-1.5" onClick={() => setRejectIds([...selected])} loading={busy}><X className="h-4 w-4" /> Reject selected</Button>
                <Button size="sm" variant="ghost" onClick={clearSelection}>Clear</Button>
              </>
            )}
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="default" className="gap-1.5" onClick={() => bulkAccept(filtered.map((a) => a.id))} loading={busy}><CheckSquare className="h-4 w-4" /> Accept all</Button>
              <Button size="sm" variant="danger" className="gap-1.5" onClick={() => setRejectIds(filtered.map((a) => a.id))} loading={busy} disabled={filtered.length === 0}><X className="h-4 w-4" /> Reject all</Button>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">No applicants{filter !== 'all' ? ` (${filter})` : ' yet'}.</div>
          ) : (
            <div className="space-y-3">
              {filtered.map((a) => (
                <Link key={a.id} to={`/app/applicants/${a.id}`} className="block">
                  <Card className={cn('transition-shadow hover:shadow-card', selected.has(a.id) && 'ring-2 ring-primary')}>
                    <CardBody className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); toggle(a.id) }}
                        className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-primary"
                        aria-label="Select applicant"
                      >
                        {selected.has(a.id) ? <CheckSquare className="h-5 w-5 text-primary" /> : <Square className="h-5 w-5" />}
                      </button>
                      <Avatar name={a.full_name} size={44} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{a.full_name}</p>
                        <p className="truncate text-sm text-muted-foreground">{a.school}{a.year ? ` · Year ${a.year}` : ''} · {formatDate(a.created_at)}</p>
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
                </Link>
              ))}
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
