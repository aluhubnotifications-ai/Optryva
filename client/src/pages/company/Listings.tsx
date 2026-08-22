import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Briefcase, Plus, Users, MapPin, Pencil, Trash2, Eye } from 'lucide-react'
import { useCurrentUser } from '@/lib/store'
import { applicationsApi, jobsApi } from '@/lib/api'
import { JobPostingView } from '@/components/JobPostingView'
import type { JobListing } from '@/types'
import { Card, CardBody, Badge, Avatar, Skeleton } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/toast'
import { daysUntil } from '@/lib/utils'

export default function Listings() {
  const user = useCurrentUser()!
  const navigate = useNavigate()
  const { toast } = useToast()
  const [jobs, setJobs] = useState<JobListing[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [opens, setOpens] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [previewJob, setPreviewJob] = useState<JobListing | null>(null)

  async function load() {
    const [j, apps, o] = await Promise.all([
      jobsApi.byCompany(user.id),
      applicationsApi.byCompany(user.id),
      jobsApi.openCounts(), // unique people who opened external apply links
    ])
    const c: Record<string, number> = {}
    apps.forEach((a) => (c[a.job_id] = (c[a.job_id] ?? 0) + 1))
    setJobs(j)
    setCounts(c)
    setOpens(o)
    setLoading(false)
  }
  useEffect(() => { load() }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  async function remove(id: string) {
    await jobsApi.remove(id)
    toast({ title: 'Listing removed', tone: 'info' })
    load()
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Briefcase className="h-6 w-6 text-primary" /> My Listings</h1>
          <p className="text-sm text-muted-foreground">Post roles and manage applicants.</p>
        </div>
        <Button className="w-full gap-1.5 sm:w-auto" onClick={() => navigate('/app/listings/new')}><Plus className="h-4 w-4" /> Create listing</Button>
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Card key={i}><CardBody><Skeleton className="h-4 w-1/2" /><Skeleton className="mt-2 h-3 w-1/3" /></CardBody></Card>)}</div>
      ) : jobs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center">
          <Briefcase className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="font-medium">No listings yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Post your first role to start receiving applicants.</p>
          <Button className="mt-4 w-full max-w-xs gap-1.5 sm:w-auto" onClick={() => navigate('/app/listings/new')}><Plus className="h-4 w-4" /> Create listing</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => {
            const dl = daysUntil(j.deadline)
            return (
              <Card key={j.id}>
                <CardBody className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setPreviewJob(j)} className="truncate font-semibold hover:text-primary hover:underline" title="View details">{j.title}</button>
                      <Badge tone={j.status === 'active' ? 'success' : 'default'} className="capitalize">{j.status}</Badge>
                      {j.apply_url ? <Badge tone="outline">External</Badge> : <Badge tone="primary">In-app</Badge>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {j.location}</span>
                      <span>{j.listing_type}</span>
                      {dl !== null && <span>{dl <= 0 ? 'Closed' : `${dl}d left`}</span>}
                      {j.allowed_years.length > 0 && <span>Years: {j.allowed_years.join(', ')}</span>}
                      {(j.allowed_schools?.length ?? 0) > 0 && <Badge tone="accent" className="text-[10px]">{j.allowed_schools!.length} school{j.allowed_schools!.length > 1 ? 's' : ''} only</Badge>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setPreviewJob(j)}><Eye className="h-4 w-4" /> View</Button>
                    {j.apply_url ? (
                      // External listings apply off-platform, so Optryva never
                      // receives applications — show unique people who opened the
                      // apply link instead of a misleading "0 applicants".
                      <span
                        className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium"
                        title="Unique people who opened the external apply link"
                      >
                        <Eye className="h-4 w-4" /> {opens[j.id] ?? 0} opened
                      </span>
                    ) : (
                      <Link to={`/app/listings/${j.id}?tab=applicants`} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted">
                        <Users className="h-4 w-4" /> {counts[j.id] ?? 0} applicants
                      </Link>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => navigate(`/app/listings/${j.id}/edit`, { state: { job: j } })}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="text-danger" onClick={() => remove(j.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}

      <Modal open={!!previewJob} onClose={() => setPreviewJob(null)} size="xl" title="Job details">
        {previewJob && (
          <div className="space-y-5">
            <JobPostingView
              job={previewJob}
              brand={previewJob.original_company_name || user.company_name || user.full_name}
              logo={previewJob.original_company_logo_url || user.avatar_url}
            />
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button variant="ghost" onClick={() => setPreviewJob(null)}>Close</Button>
              <Button className="gap-1.5" onClick={() => navigate(`/app/listings/${previewJob.id}/edit`, { state: { job: previewJob } })}><Pencil className="h-4 w-4" /> Edit</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
