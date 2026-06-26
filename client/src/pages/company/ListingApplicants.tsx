import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Users, ArrowRight, FileText, Eye, ExternalLink } from 'lucide-react'
import { applicationsApi, jobsApi } from '@/lib/api'
import { useCurrentUser } from '@/lib/store'
import type { Application, ApplicationStatus, JobListing } from '@/types'
import { Card, CardBody, Badge, Avatar, Skeleton } from '@/components/ui/primitives'
import { JobPostingView } from '@/components/JobPostingView'
import { cn, formatDate } from '@/lib/utils'

const statusTone = { pending: 'default', reviewed: 'primary', shortlisted: 'accent', hired: 'success', rejected: 'danger' } as const
const FILTERS: (ApplicationStatus | 'all')[] = ['all', 'pending', 'reviewed', 'shortlisted', 'hired', 'rejected']

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

  useEffect(() => {
    ;(async () => {
      if (!id) return
      const [j, a, o] = await Promise.all([jobsApi.get(id), applicationsApi.byJob(id), jobsApi.openCounts()])
      setJob(j); setApps(a); setOpens(o[id] ?? 0); setLoading(false)
    })()
  }, [id])

  // External listings apply off-platform, so applications never reach Optryva —
  // we report unique people who opened the apply link ("views") instead.
  const external = !!job?.apply_url
  const filtered = useMemo(() => (filter === 'all' ? apps : apps.filter((a) => a.status === filter)), [apps, filter])
  const brand = job?.original_company_name || user.company_name || user.full_name
  const logo = job?.original_company_logo_url || user.avatar_url

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
              This is an external listing — candidates apply on your own site, so Optryva tracks
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
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1">
            {FILTERS.map((f) => {
              const count = f === 'all' ? apps.length : apps.filter((a) => a.status === f).length
              return (
                <button key={f} onClick={() => setFilter(f)} className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium capitalize transition-colors ${filter === f ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}>
                  {f}<span className="rounded-full bg-muted px-1.5 text-xs">{count}</span>
                </button>
              )
            })}
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">No applicants{filter !== 'all' ? ` (${filter})` : ' yet'}.</div>
          ) : (
            <div className="space-y-3">
              {filtered.map((a) => (
                <Link key={a.id} to={`/app/applicants/${a.id}`}>
                  <Card className="transition-shadow hover:shadow-card">
                    <CardBody className="flex items-center gap-3">
                      <Avatar name={a.full_name} size={44} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{a.full_name}</p>
                        <p className="truncate text-sm text-muted-foreground">{a.school}{a.year ? ` · Year ${a.year}` : ''} · {formatDate(a.created_at)}</p>
                      </div>
                      <Badge tone={statusTone[a.status]} className="capitalize">{a.status === 'hired' ? 'Hired' : a.status}</Badge>
                      <ArrowRight className="hidden h-4 w-4 text-muted-foreground sm:block" />
                    </CardBody>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
