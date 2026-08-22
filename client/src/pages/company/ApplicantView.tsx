import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Mail,
  Phone,
  GraduationCap,
  Link2,
  MessageSquare,
  Eye,
  Star,
  CheckCircle2,
  XCircle,
  ClipboardCheck,
} from 'lucide-react'
import { applicationsApi, jobsApi, profilesApi } from '@/lib/api'
import type { Application, ApplicationStatus, JobListing, Profile } from '@/types'
import { Card, CardBody, Badge, Avatar } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { AppProgressSteps } from '@/components/AppProgressSteps'
import { DocumentList } from '@/components/DocumentList'
import { useToast } from '@/components/ui/toast'
import { formatDate } from '@/lib/utils'

const statusTone = { pending: 'default', reviewed: 'primary', shortlisted: 'accent', hired: 'success', rejected: 'danger' } as const

export default function ApplicantView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [app, setApp] = useState<Application | null>(null)
  const [job, setJob] = useState<JobListing | null>(null)
  const [student, setStudent] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    if (!id) return
    const a = await applicationsApi.get(id)
    if (!a) { setLoading(false); return }
    const [j, s] = await Promise.all([jobsApi.get(a.job_id), profilesApi.get(a.student_id)])
    setApp(a); setJob(j); setStudent(s); setLoading(false)
  }
  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <p className="py-20 text-center text-sm text-muted-foreground">Loading…</p>
  if (!app) return <div className="py-20 text-center"><p className="font-medium">Applicant not found.</p></div>

  async function setStatus(s: ApplicationStatus) {
    await applicationsApi.setStatus(app!.id, s)
    toast({ title: `Marked ${s === 'hired' ? 'hired' : s}`, tone: 'success' })
    load()
  }

  const actions: { label: string; status: ApplicationStatus; icon: typeof Eye; variant: 'outline' | 'default' | 'success' | 'danger' }[] = [
    { label: 'Reviewed', status: 'reviewed', icon: Eye, variant: 'outline' },
    { label: 'Shortlist', status: 'shortlisted', icon: Star, variant: 'default' },
    { label: 'Hire', status: 'hired', icon: CheckCircle2, variant: 'success' },
    { label: 'Reject', status: 'rejected', icon: XCircle, variant: 'danger' },
  ]

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back</button>

      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex gap-3">
              <Avatar name={app.full_name} src={student?.avatar_url} size={56} />
              <div>
                <h1 className="text-xl font-bold tracking-tight">{app.full_name}</h1>
                <p className="text-sm text-muted-foreground">Applied to {job?.title} · {formatDate(app.created_at)}</p>
                {student?.bio && <p className="mt-1 max-w-xl text-sm text-muted-foreground">{student.bio}</p>}
              </div>
            </div>
            <Badge tone={statusTone[app.status]} className="capitalize">{app.status === 'hired' ? 'Hired' : app.status}</Badge>
          </div>
          <div className="mt-5 border-t border-border pt-5"><AppProgressSteps status={app.status} /></div>
        </CardBody>
      </Card>

      {/* Status actions */}
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <Button key={a.status} variant={a.variant} className="gap-1.5" onClick={() => setStatus(a.status)} disabled={app.status === a.status}>
            <a.icon className="h-4 w-4" /> {a.label}
          </Button>
        ))}
        <Button variant="ghost" className="ml-auto gap-1.5" onClick={() => navigate(`/app/messages?thread=${app.id}&scope=application`)}>
          <MessageSquare className="h-4 w-4" /> Message
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Contact + profile */}
        <Card className="lg:col-span-1">
          <CardBody className="space-y-3">
            <h2 className="font-semibold">Candidate</h2>
            <Info icon={Mail} value={app.email} />
            {app.phone && <Info icon={Phone} value={app.phone} />}
            <Info icon={GraduationCap} value={`${app.school ?? '—'}${app.year ? ` · Year ${app.year}` : ''}`} />
            {app.linkedin && <Info icon={Link2} value={app.linkedin} link />}
            {student?.skills && student.skills.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Skills</p>
                <div className="flex flex-wrap gap-1">{student.skills.map((s) => <Badge key={s} tone="primary" className="text-[11px]">{s}</Badge>)}</div>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Cover + documents */}
        <div className="space-y-5 lg:col-span-2">
          {app.cover_note && (
            <Card><CardBody><h2 className="mb-2 font-semibold">Cover note</h2><p className="text-sm leading-relaxed text-muted-foreground">{app.cover_note}</p></CardBody></Card>
          )}
          {job?.assignment && <AssignmentReview assignment={job.assignment} answers={app.assignment_answers ?? []} status={app.assignment_status} />}
          <Card>
            <CardBody>
              <h2 className="mb-3 font-semibold">Documents</h2>
              <DocumentList documents={app.documents} />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}

function AssignmentReview({ assignment, answers, status }: { assignment: NonNullable<JobListing['assignment']>; answers: NonNullable<Application['assignment_answers']>; status?: Application['assignment_status'] }) {
  const answerMap = new Map(answers.map((answer) => [answer.question_id ?? answer.criterion_id, answer.answer]))
  const items = assignment.questions?.length ? assignment.questions.map((question) => ({ id: question.id, label: question.prompt, points: undefined })) : assignment.rubric.map((criterion) => ({ id: criterion.id, label: criterion.label, points: criterion.points }))
  return <Card><CardBody><div className="flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 font-semibold"><ClipboardCheck className="h-4 w-4 text-accent" /> Assignment answers</h2><Badge tone={status === 'submitted' ? 'success' : 'default'} className="capitalize">{status === 'submitted' ? 'Submitted' : 'Pending'}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{assignment.title}</p><div className="mt-4 space-y-3">{items.map((item) => { const answer = answerMap.get(item.id); const text = Array.isArray(answer) ? answer.join(', ') : answer?.startsWith('data:') ? 'File attached' : answer; return <div key={item.id} className="rounded-lg border border-border p-3"><div className="flex justify-between gap-3 text-sm font-medium"><span>{item.label}</span>{item.points !== undefined && <span className="shrink-0 text-xs text-muted-foreground">{item.points} pts</span>}</div><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{text || 'No answer submitted.'}</p></div> })}</div></CardBody></Card>
}

function Info({ icon: Icon, value, link }: { icon: typeof Mail; value: string; link?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      {link ? <a href={value} target="_blank" rel="noreferrer" className="truncate text-primary hover:underline">{value}</a> : <span className="truncate text-muted-foreground">{value}</span>}
    </div>
  )
}
