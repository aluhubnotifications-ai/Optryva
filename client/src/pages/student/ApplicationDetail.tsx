import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  MessageSquare,
  Sparkles,
  Trash2,
  CheckCircle2,
  Clock,
} from 'lucide-react'
import { useCurrentUser } from '@/lib/store'
import { applicationsApi, jobsApi, profilesApi } from '@/lib/api'
import type { Application, JobListing, Profile } from '@/types'
import { Card, CardBody, Badge, Avatar } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { AppProgressSteps } from '@/components/AppProgressSteps'
import { AIResearchPanel } from '@/components/AIResearchPanel'
import { DocumentList } from '@/components/DocumentList'
import { useToast } from '@/components/ui/toast'
import { formatDate, timeAgo } from '@/lib/utils'

const statusTone = {
  pending: 'default',
  reviewed: 'primary',
  shortlisted: 'accent',
  hired: 'success',
  rejected: 'danger',
} as const

export default function ApplicationDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const user = useCurrentUser()!
  const { toast } = useToast()
  const [app, setApp] = useState<Application | null>(null)
  const [job, setJob] = useState<JobListing | null>(null)
  const [company, setCompany] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [research, setResearch] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    ;(async () => {
      if (!id) return
      const a = await applicationsApi.get(id)
      if (!a) { setLoading(false); return }
      const j = await jobsApi.get(a.job_id)
      const c = j ? await profilesApi.get(j.company_id) : null
      setApp(a)
      setJob(j)
      setCompany(c)
      setLoading(false)
    })()
  }, [id])

  if (loading) return <p className="py-20 text-center text-sm text-muted-foreground">Loading…</p>
  if (!app || !job) {
    return (
      <div className="py-20 text-center">
        <p className="font-medium">Application not found.</p>
        <Link to="/app/applications"><Button variant="outline" className="mt-4">Back to applications</Button></Link>
      </div>
    )
  }

  const brand = job.original_company_name || company?.company_name

  async function withdraw() {
    await applicationsApi.remove(app!.id)
    toast({ title: 'Application withdrawn', tone: 'info' })
    navigate('/app/applications')
  }

  return (
    <div className="space-y-5">
      <Link to="/app/applications" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to applications
      </Link>

      {/* Header */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex gap-3">
              <Link to={`/app/companies/${job.company_id}`} className="shrink-0" title={`View ${brand}`}>
                <Avatar name={brand} src={job.original_company_logo_url || company?.avatar_url} size={52} className="rounded-xl" />
              </Link>
              <div>
                <Link to={`/app/jobs?job=${job.id}`} className="text-xl font-bold tracking-tight hover:text-primary">{job.title}</Link>
                <p className="text-sm text-muted-foreground"><Link to={`/app/companies/${job.company_id}`} className="hover:text-primary hover:underline">{brand}</Link> · {job.location}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Applied {formatDate(app.created_at)}</p>
              </div>
            </div>
            <Badge tone={statusTone[app.status]} className="capitalize">{app.status === 'hired' ? 'Accepted' : app.status}</Badge>
          </div>
          <div className="mt-5 border-t border-border pt-5">
            <AppProgressSteps status={app.status} />
          </div>
        </CardBody>
      </Card>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button className="gap-1.5" onClick={() => navigate(`/app/messages?thread=${app.id}&scope=application`)}>
          <MessageSquare className="h-4 w-4" /> Message {brand}
        </Button>
        <Button variant="outline" className="gap-1.5" onClick={() => setResearch(true)}>
          <Sparkles className="h-4 w-4 text-primary" /> AI Research
        </Button>
        <Button variant="ghost" className="gap-1.5 text-danger" onClick={() => setConfirmDelete(true)}>
          <Trash2 className="h-4 w-4" /> Withdraw
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Timeline */}
        <Card className="lg:col-span-2">
          <CardBody>
            <h2 className="mb-4 font-semibold">Timeline</h2>
            <ol className="space-y-4">
              {app.timeline.map((t, i) => (
                <li key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/12 text-primary">
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                    {i < app.timeline.length - 1 && <div className="my-1 w-0.5 flex-1 bg-border" />}
                  </div>
                  <div className="pb-1">
                    <p className="text-sm font-medium capitalize">{t.status === 'applied' ? 'Application submitted' : `Moved to ${t.status}`}</p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" /> {timeAgo(t.at)}</p>
                  </div>
                </li>
              ))}
            </ol>

            {app.cover_note && (
              <div className="mt-6 border-t border-border pt-4">
                <h3 className="mb-2 font-semibold">Your cover note</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{app.cover_note}</p>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Documents */}
        <Card>
          <CardBody>
            <h2 className="mb-3 font-semibold">Submitted documents</h2>
            <DocumentList documents={app.documents} emptyText="No documents." />
          </CardBody>
        </Card>
      </div>

      <AIResearchPanel open={research} onClose={() => setResearch(false)} job={job} company={company ?? undefined} user={user} />

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} size="sm" title="Withdraw application?" description="This can't be undone.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button variant="danger" onClick={withdraw}>Withdraw</Button>
        </div>
      </Modal>
    </div>
  )
}
