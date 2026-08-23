import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  MessageSquare,
  Sparkles,
  Trash2,
  CheckCircle2,
  Clock,
  ClipboardCheck,
} from 'lucide-react'
import { useCurrentUser } from '@/lib/store'
import { applicationsApi, jobsApi, profilesApi } from '@/lib/api'
import type { Application, JobListing, Profile } from '@/types'
import { Card, CardBody, Badge, Avatar } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { ScoreRing } from '@/components/ScoreRing'
import { AppProgressSteps } from '@/components/AppProgressSteps'
import { AIResearchPanel } from '@/components/AIResearchPanel'
import { DocumentList } from '@/components/DocumentList'
import { AssessmentRunner } from '@/components/AssessmentRunner'
import { useToast } from '@/components/ui/toast'
import { formatDate, timeAgo } from '@/lib/utils'

const statusTone = {
  draft: 'outline',
  pending: 'default',
  reviewed: 'primary',
  shortlisted: 'accent',
  hired: 'success',
  rejected: 'danger',
  cancelled: 'danger',
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
  const [takingTest, setTakingTest] = useState(false)

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

  const when = job.assignment?.required_when ?? 'after_application'
  const eligible = when === 'after_application' || app.status === 'shortlisted'
  const maxAttempts = job.assignment?.max_attempts ?? 10
  const exhausted = (app.attempts ?? 0) >= maxAttempts
  const canTake = !!job.assignment && app.assignment_status !== 'submitted' && eligible && !exhausted
  const deadline = app.test_eligible_at && job.assignment?.window_days
    ? new Date(new Date(app.test_eligible_at).getTime() + job.assignment.window_days * 86400000)
    : null

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
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {canTake && (
          <Button className="w-full gap-1.5 sm:w-auto" onClick={() => setTakingTest(true)}>
            <ClipboardCheck className="h-4 w-4" /> Take assessment
          </Button>
        )}
        <Button className="w-full gap-1.5 sm:w-auto" onClick={() => navigate(`/app/messages?thread=${app.id}&scope=application`)}>
          <MessageSquare className="h-4 w-4" /> Message {brand}
        </Button>
        <Button variant="outline" className="w-full gap-1.5 sm:w-auto" onClick={() => setResearch(true)}>
          <Sparkles className="h-4 w-4 text-primary" /> AI Research
        </Button>
        <Button variant="ghost" className="w-full gap-1.5 text-danger sm:w-auto" onClick={() => setConfirmDelete(true)}>
          <Trash2 className="h-4 w-4" /> Withdraw
        </Button>
      </div>

      {takingTest && job.assignment && (
        <Card>
          <CardBody>
            <AssessmentRunner
              job={job}
              application={app}
              onComplete={(updated) => { setApp(updated); setTakingTest(false) }}
              onClose={() => setTakingTest(false)}
            />
          </CardBody>
        </Card>
      )}

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
                    <p className="text-sm font-medium capitalize">{t.status === 'applied' ? 'Application submitted' : t.status === 'test_return' ? 'Test attempt returned' : t.status === 'test_submitted' ? (t.late ? 'Test submitted (late)' : 'Test submitted') : `Moved to ${t.status}`}</p>
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
            {job.assignment && <div className="mt-6 border-t border-border pt-4"><h3 className="flex items-center gap-2 font-semibold"><ClipboardCheck className="h-4 w-4 text-accent" /> {job.assignment.title}</h3><p className="mt-1 text-xs text-muted-foreground">
                {app.assignment_status === 'submitted'
                  ? app.assignment_late
                    ? 'Submitted after the deadline (marked late).'
                    : 'Submitted.'
                  : eligible
                    ? exhausted
                      ? `No attempts left (used ${app.attempts ?? 0} of ${maxAttempts}).`
                      : 'Pending — take it from the button above.'
                    : "Unlocks once you're shortlisted."}
                {deadline && ` Complete by ${formatDate(deadline.toISOString())}.`}
              </p>
              {app.assignment_status !== 'submitted' && eligible && !exhausted && (
                <Button className="mt-3 gap-1.5" onClick={() => setTakingTest(true)}><ClipboardCheck className="h-4 w-4" /> Take assessment</Button>
              )}
              <div className="mt-3 space-y-2">{(job.assignment.questions?.length ? job.assignment.questions.map((question) => ({ id: question.id, label: question.prompt })) : job.assignment.rubric.map((criterion) => ({ id: criterion.id, label: criterion.label }))).map((item) => { const entry = app.assignment_answers?.find((e) => (e.question_id ?? e.criterion_id) === item.id); const answer = entry?.answer; const text = Array.isArray(answer) ? answer.join(', ') : answer?.startsWith('data:') ? (entry?.file_name ?? 'File attached') : answer; return <div key={item.id}><p className="text-sm font-medium">{item.label}</p><p className="whitespace-pre-wrap text-sm text-muted-foreground">{text || 'No answer submitted.'}</p></div> })}</div></div>}

            {/* Assessment evaluation — shown only once the employer has reviewed,
                and clearly labelled advisory. The human decision (status above +
                employer note) is the actual verdict and may differ from this. */}
            {app.assignment_score != null && (
              <div className="mt-6 border-t border-border pt-4">
                <h3 className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-primary" /> Your assessment evaluation</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  This AI-assisted evaluation is one input the employer used. The final decision shown at the top is made by a human and may differ.
                </p>
                <div className="mt-3 flex items-center gap-4">
                  <ScoreRing score={app.assignment_score} size={64} showLabel />
                  <div className="text-sm">
                    <p className="font-medium">Recommendation: <span className="capitalize">{app.ai_recommendation ?? '—'}</span></p>
                    {app.decision_reason && <p className="mt-1 text-muted-foreground">Employer note: {app.decision_reason}</p>}
                  </div>
                </div>
                {app.assignment_ai_feedback?.overall && (
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{app.assignment_ai_feedback.overall}</p>
                )}
                {app.assignment_ai_feedback?.perQuestion?.length ? (
                  <div className="mt-3 space-y-2">
                    {app.assignment_ai_feedback.perQuestion.map((pq) => {
                      const q = job.assignment?.questions?.find((x) => x.id === pq.id) ?? job.assignment?.rubric?.find((x) => x.id === pq.id)
                      const qLabel = (q as any)?.prompt ?? (q as any)?.label ?? 'Question'
                      return (
                        <div key={pq.id}>
                          <p className="text-sm font-medium">{qLabel}</p>
                          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{pq.feedback}</p>
                        </div>
                      )
                    })}
                  </div>
                ) : null}
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
