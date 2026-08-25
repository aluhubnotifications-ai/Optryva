import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useTransitionNavigate } from '@/lib/useTransitionNavigate'
import {
  Briefcase,
  Eye,
  FileText,
  MapPin,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react'
import { useCurrentUser } from '@/lib/store'
import { jobsApi } from '@/lib/api'
import { useCompanyData } from '@/lib/companyData'
import { JobPostingView } from '@/components/JobPostingView'
import type { Application, JobListing } from '@/types'
import { Badge, Card, CardBody, Skeleton } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/toast'
import { ApplicantInbox, ExternalListingPanel, SmartShortlist } from '@/pages/company/reviewShared'
import { cn, daysUntil } from '@/lib/utils'

type PanelTab = 'applicants' | 'details' | 'shortlist'
type Selection = 'all' | string

function listingStats(apps: Application[], jobId: string) {
  const mine = apps.filter((a) => a.job_id === jobId)
  return {
    total: mine.length,
    pending: mine.filter((a) => a.status === 'pending').length,
  }
}

export default function Listings() {
  const { id: routeListingId } = useParams()
  const [params] = useSearchParams()
  const user = useCurrentUser()!
  const navigate = useTransitionNavigate()
  const { toast } = useToast()

  const [tab, setTab] = useState<PanelTab>(params.get('tab') === 'details' ? 'details' : 'applicants')

  const selection: Selection = routeListingId ?? 'all'

  const { jobs, apps, opens, loading, load, invalidate } = useCompanyData()

  const inAppJobs = useMemo(() => jobs.filter((j) => !j.apply_url), [jobs])
  const externalJobs = useMemo(() => jobs.filter((j) => j.apply_url), [jobs])
  const selectedJob = useMemo(
    () => (selection === 'all' ? null : jobs.find((j) => j.id === selection) ?? null),
    [jobs, selection],
  )
  const selectedApps = useMemo(
    () => (selection === 'all' ? apps : apps.filter((a) => a.job_id === selection)),
    [apps, selection],
  )
  const pendingTotal = useMemo(() => apps.filter((a) => a.status === 'pending').length, [apps])

  // Session-cached: returns instantly if we already have data (e.g. navigating
  // back from an applicant); silently revalidates only when stale.
  useEffect(() => {
    load(user.id)
  }, [user.id, load])

  const reload = useCallback(() => load(user.id, true), [load])

  function chooseListing(id: Selection) {
    setTab('applicants')
    // Always navigate via the route (not a query param) so the selected listing is
    // a real URL — browser back/forward steps cleanly between listings and the
    // combined view stays mounted (no jump to a separate page).
    navigate(id === 'all' ? '/app/listings' : `/app/listings/${id}`)
  }

  async function remove(id: string) {
    await jobsApi.remove(id)
    toast({ title: 'Listing removed', tone: 'info' })
    if (selection === id) chooseListing('all')
    reload()
  }

  const brand = selectedJob?.original_company_name || user.company_name || user.full_name
  const logo = selectedJob?.original_company_logo_url || user.avatar_url

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Briefcase className="h-6 w-6 text-primary" /> Listings & applications
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage roles and review every submission — grouped by listing so you always know which job someone applied to.
          </p>
        </div>
        <Button className="w-full gap-1.5 sm:w-auto" onClick={() => navigate('/app/listings/new')}>
          <Plus className="h-4 w-4" /> Create listing
        </Button>
      </div>

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(240px,300px)_1fr]">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      ) : jobs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center">
          <Briefcase className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="font-medium">No listings yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Post your first role to start receiving applications.</p>
          <Button className="mt-4 w-full max-w-xs gap-1.5 sm:w-auto" onClick={() => navigate('/app/listings/new')}>
            <Plus className="h-4 w-4" /> Create listing
          </Button>
        </div>
      ) : (
        <div className="grid min-h-[520px] gap-4 lg:grid-cols-[minmax(240px,300px)_1fr]">
          {/* Left rail — listings picker */}
          <Card className="overflow-hidden lg:sticky lg:top-[7.5rem] lg:h-[calc(100vh-9rem)]">
            <CardBody className="flex h-full flex-col gap-3 p-0">
              <div className="border-b border-border px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your listings</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {inAppJobs.length} in-app · {externalJobs.length} external
                </p>
              </div>

              <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
                <ListingPick
                  active={selection === 'all'}
                  icon={FileText}
                  title="All applications"
                  subtitle={`${apps.length} total · ${pendingTotal} pending`}
                  badge={pendingTotal > 0 ? pendingTotal : undefined}
                  onClick={() => chooseListing('all')}
                />

                {inAppJobs.length > 0 && (
                  <p className="px-2 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">In-app apply</p>
                )}
                {inAppJobs.map((j) => {
                  const stats = listingStats(apps, j.id)
                  const dl = daysUntil(j.deadline)
                  return (
                    <ListingPick
                      key={j.id}
                      active={selection === j.id}
                      icon={Users}
                      title={j.title}
                      subtitle={`${stats.total} applicant${stats.total === 1 ? '' : 's'}${stats.pending ? ` · ${stats.pending} new` : ''}`}
                      badge={stats.pending > 0 ? stats.pending : undefined}
                      meta={
                        <>
                          <span className="inline-flex items-center gap-1 truncate">
                            <MapPin className="h-3 w-3 shrink-0" /> {j.location}
                          </span>
                          {dl !== null && <span>{dl <= 0 ? 'Closed' : `${dl}d left`}</span>}
                        </>
                      }
                      status={j.status}
                      onClick={() => chooseListing(j.id)}
                    />
                  )
                })}

                {externalJobs.length > 0 && (
                  <p className="px-2 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">External apply</p>
                )}
                {externalJobs.map((j) => (
                  <ListingPick
                    key={j.id}
                    active={selection === j.id}
                    icon={Eye}
                    title={j.title}
                    subtitle={`${opens[j.id] ?? 0} opened`}
                    meta={<span className="truncate">{j.location}</span>}
                    status={j.status}
                    external
                    onClick={() => chooseListing(j.id)}
                  />
                ))}
              </div>
            </CardBody>
          </Card>

          {/* Right panel — applicants or listing details */}
          <div className="min-w-0 space-y-4">
            {selection === 'all' ? (
              <>
                <PanelHeader
                  title="All applications"
                  subtitle={`${apps.length} submission${apps.length === 1 ? '' : 's'} across ${inAppJobs.length} in-app listing${inAppJobs.length === 1 ? '' : 's'}`}
                />
                <ApplicantInbox
                  apps={selectedApps}
                  jobs={jobs}
                  loading={false}
                  showListing
                  emptyLabel="No applications yet."
                  onReload={reload}
                />
              </>
            ) : selectedJob ? (
              <>
                <PanelHeader
                  title={selectedJob.title}
                  subtitle={
                    selectedJob.apply_url
                      ? `${opens[selectedJob.id] ?? 0} opened · ${selectedJob.location} · ${selectedJob.listing_type}`
                      : `${selectedApps.length} applicant${selectedApps.length === 1 ? '' : 's'} · ${selectedJob.location} · ${selectedJob.listing_type}`
                  }
                  status={selectedJob.status}
                  external={!!selectedJob.apply_url}
                  actions={
                    <>
                      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate(`/app/listings/${selectedJob.id}/edit`, { state: { job: selectedJob } })}>
                        <Pencil className="h-4 w-4" /> Edit
                      </Button>
                      <Button variant="ghost" size="icon" className="text-danger" onClick={() => remove(selectedJob.id)} aria-label="Remove listing">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  }
                />

                {!selectedJob.apply_url && (
                  <div className="flex gap-1 border-b border-border">
                    {([
                      ['applicants', `Applicants (${selectedApps.length})`, Users],
                      ['shortlist', 'Smart Shortlist', Sparkles],
                      ['details', 'Job details', Briefcase],
                    ] as const).map(([key, label, Icon]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setTab(key)}
                        className={cn(
                          'flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                          tab === key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <Icon className="h-4 w-4" /> {label}
                      </button>
                    ))}
                  </div>
                )}

                {selectedJob.apply_url ? (
                  <ExternalListingPanel job={selectedJob} opens={opens[selectedJob.id] ?? 0} />
                ) : tab === 'details' ? (
                  <Card>
                    <CardBody>
                      <JobPostingView job={selectedJob} brand={brand} logo={logo} />
                    </CardBody>
                  </Card>
                ) : tab === 'shortlist' ? (
                  <SmartShortlist jobId={selectedJob.id} />
                ) : (
                  <ApplicantInbox
                    apps={selectedApps}
                    jobs={jobs}
                    loading={false}
                    emptyLabel="No applicants for this listing yet."
                    onReload={reload}
                  />
                )}
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
                Listing not found. <Link to="/app/listings" className="text-primary hover:underline">Back to all listings</Link>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function PanelHeader({
  title,
  subtitle,
  status,
  external,
  actions,
}: {
  title: string
  subtitle: string
  status?: JobListing['status']
  external?: boolean
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate text-xl font-bold tracking-tight">{title}</h2>
          {status && <Badge tone={status === 'active' ? 'success' : 'default'} className="capitalize">{status}</Badge>}
          {external ? <Badge tone="outline">External apply</Badge> : <Badge tone="primary">In-app apply</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

function ListingPick({
  active,
  icon: Icon,
  title,
  subtitle,
  meta,
  badge,
  status,
  external,
  onClick,
}: {
  active: boolean
  icon: typeof Briefcase
  title: string
  subtitle: string
  meta?: React.ReactNode
  badge?: number
  status?: JobListing['status']
  external?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-xl border px-3 py-2.5 text-left transition-all',
        active ? 'border-primary/40 bg-primary/10 shadow-sm' : 'border-transparent hover:border-border hover:bg-muted/50',
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground')}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-2 text-sm font-semibold leading-snug">{title}</p>
            {badge != null && badge > 0 && (
              <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-accent-foreground">
                {badge}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>
          {meta && <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">{meta}</div>}
          {status && (
            <div className="mt-1.5 flex gap-1">
              <Badge tone={status === 'active' ? 'success' : 'default'} className="text-[10px] capitalize">{status}</Badge>
              {external && <Badge tone="outline" className="text-[10px]">External</Badge>}
            </div>
          )}
        </div>
      </div>
    </button>
  )
}
