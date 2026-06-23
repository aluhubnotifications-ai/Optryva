import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Users, ArrowRight, FileText } from 'lucide-react'
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
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<ApplicationStatus | 'all'>('all')
  const [tab, setTab] = useState<'details' | 'applicants'>(params.get('tab') === 'applicants' ? 'applicants' : 'details')

  useEffect(() => {
    ;(async () => {
      if (!id) return
      const [j, a] = await Promise.all([jobsApi.get(id), applicationsApi.byJob(id)])
      setJob(j); setApps(a); setLoading(false)
    })()
  }, [id])

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
            {job?.location}{job ? ` · ${job.listing_type}` : ''} · {apps.length} applicant{apps.length === 1 ? '' : 's'}
          </p>
        </div>
        {job && <Badge tone={job.status === 'active' ? 'success' : 'default'} className="capitalize">{job.status}</Badge>}
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 border-b border-border">
        {([['details', 'Job details'], ['applicants', `Applicants (${apps.length})`]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {key === 'details' ? <FileText className="h-4 w-4" /> : <Users className="h-4 w-4" />} {label}
          </button>
        ))}
      </div>

      {loading || !job ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Card key={i}><CardBody><Skeleton className="h-4 w-1/3" /><Skeleton className="mt-2 h-3 w-1/4" /></CardBody></Card>)}</div>
      ) : tab === 'details' ? (
        <Card><CardBody><JobPostingView job={job} brand={brand} logo={logo} /></CardBody></Card>
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
