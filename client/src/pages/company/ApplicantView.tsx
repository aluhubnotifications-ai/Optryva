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
  ShieldCheck,
  Sparkles,
  UserCheck,
} from 'lucide-react'
import { applicationsApi, jobsApi, profilesApi } from '@/lib/api'
import { useCurrentUser } from '@/lib/store'
import type { Application, ApplicationStatus, JobListing, Profile } from '@/types'
import { Card, CardBody, Badge, Avatar, Label, Textarea, Input } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { AppProgressSteps } from '@/components/AppProgressSteps'
import { DocumentList } from '@/components/DocumentList'
import { useToast } from '@/components/ui/toast'
import { formatDate } from '@/lib/utils'

const statusTone = { pending: 'default', reviewed: 'primary', shortlisted: 'accent', hired: 'success', rejected: 'danger' } as const

function band(score?: number): 'success' | 'accent' | 'default' | 'danger' {
  if (score == null) return 'default'
  return score >= 75 ? 'success' : score >= 55 ? 'accent' : 'danger'
}
function ScorePill({ label, score }: { label: string; score?: number }) {
  if (score == null) return null
  return <Badge tone={band(score)} className="gap-1"><Sparkles className="h-3 w-3" /> {label} {score}</Badge>
}

export default function ApplicantView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const user = useCurrentUser()!
  const [app, setApp] = useState<Application | null>(null)
  const [job, setJob] = useState<JobListing | null>(null)
  const [student, setStudent] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [scoreBusy, setScoreBusy] = useState(false)
  const [overrideScore, setOverrideScore] = useState<string>('')
  const [decisionNote, setDecisionNote] = useState<string>('')

  async function load() {
    if (!id) return
    const a = await applicationsApi.get(id)
    if (!a) { setLoading(false); return }
    const [j, s] = await Promise.all([jobsApi.get(a.job_id), profilesApi.get(a.student_id)])
    setApp(a); setJob(j); setStudent(s); setDecisionNote(a.decision_reason ?? ''); setLoading(false)
  }
  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <p className="py-20 text-center text-sm text-muted-foreground">Loading…</p>
  if (!app) return <div className="py-20 text-center"><p className="font-medium">Applicant not found.</p></div>

  const hasAssignment = !!job?.assignment && (app.assignment_answers?.length ?? 0) > 0

  async function setStatus(s: ApplicationStatus) {
    if (s === 'rejected' && !decisionNote.trim()) {
      toast({ title: 'Add a reason before rejecting', description: 'A rejection reason is required and recorded for audit.', tone: 'error' })
      return
    }
    const updated = await applicationsApi.setStatus(app!.id, s, decisionNote.trim() || undefined)
    if (updated) { setApp(updated); toast({ title: `Marked ${s === 'hired' ? 'hired' : s}`, tone: 'success' }) }
  }

  async function runAiScore() {
    setScoreBusy(true)
    try {
      const updated = await applicationsApi.scoreAssignment(app!.id)
      if (updated) { setApp(updated); toast({ title: 'AI assessment review complete', tone: 'success' }) }
    } catch (e) {
      toast({ title: 'Could not score assignment', description: e instanceof Error ? e.message : undefined, tone: 'error' })
    } finally { setScoreBusy(false) }
  }

  async function saveOverride() {
    const num = Number(overrideScore)
    if (Number.isNaN(num)) return
    const updated = await applicationsApi.review(app!.id, { assignment_score: Math.max(0, Math.min(100, Math.round(num))), decision_reason: decisionNote.trim() || undefined })
    if (updated) { setApp(updated); setOverrideScore(''); toast({ title: 'Score override saved', tone: 'success' }) }
  }

  async function saveNote() {
    const updated = await applicationsApi.review(app!.id, { decision_reason: decisionNote.trim() || undefined })
    if (updated) { setApp(updated); toast({ title: 'Decision note saved', tone: 'success' }) }
  }

  const actions: { label: string; status: ApplicationStatus; icon: typeof Eye; variant: 'outline' | 'default' | 'success' | 'danger' }[] = [
    { label: 'Reviewed', status: 'reviewed', icon: Eye, variant: 'outline' },
    { label: 'Shortlist', status: 'shortlisted', icon: Star, variant: 'default' },
    { label: 'Hire', status: 'hired', icon: CheckCircle2, variant: 'success' },
    { label: 'Reject', status: 'rejected', icon: XCircle, variant: 'danger' },
  ]

  const decidedByMe = app.decision_by === user.id

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
            <div className="flex flex-col items-end gap-2">
              <Badge tone={statusTone[app.status]} className="capitalize">{app.status === 'hired' ? 'Hired' : app.status}</Badge>
              <div className="flex flex-wrap justify-end gap-1.5">
                <ScorePill label="Fit" score={app.match_score} />
                <ScorePill label="Test" score={app.assignment_score} />
              </div>
            </div>
          </div>
          <div className="mt-5 border-t border-border pt-5"><AppProgressSteps status={app.status} /></div>
        </CardBody>
      </Card>

      {/* Human-authority banner */}
      <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">You decide — AI only suggests.</span> Scores and recommendations below are machine-generated aids.
          The final decision is human and recorded with who made it and when.
        </p>
      </div>

      {/* AI scoring */}
      {hasAssignment && (
        <Card>
          <CardBody className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-semibold"><ClipboardCheck className="h-4 w-4 text-accent" /> AI assessment review</h2>
              <div className="flex items-center gap-2">
                {app.ai_recommendation && <Badge tone={app.ai_recommendation === 'advance' ? 'success' : app.ai_recommendation === 'consider' ? 'accent' : 'danger'}>AI suggests: {app.ai_recommendation}</Badge>}
                <Button size="sm" variant="outline" className="gap-1.5" onClick={runAiScore} loading={scoreBusy}>
                  <Sparkles className="h-4 w-4 text-accent" /> {app.assignment_score != null ? 'Re-run AI' : 'Run AI review'}
                </Button>
              </div>
            </div>
            {app.assignment_score == null ? (
              <p className="text-sm text-muted-foreground">No AI score yet. Run the review to score the submitted answers against your rubric — or set a score yourself below.</p>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 text-2xl font-bold text-accent">{app.assignment_score}</div>
                  <p className="min-w-0 flex-1 text-sm leading-relaxed text-muted-foreground">{app.assignment_ai_feedback?.overall}</p>
                </div>
                {app.assignment_ai_feedback?.perQuestion?.length ? (
                  <details className="text-sm">
                    <summary className="cursor-pointer font-medium text-muted-foreground">Per-question feedback</summary>
                    <ul className="mt-2 space-y-1.5">
                      {app.assignment_ai_feedback.perQuestion.map((pq) => (
                        <li key={pq.id} className="rounded-lg border border-border p-2 text-muted-foreground">{pq.feedback}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </>
            )}
            <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
              <div>
                <Label className="text-xs">Human score override (0–100)</Label>
                <Input className="mt-1 w-28" inputMode="numeric" placeholder={app.assignment_score != null ? String(app.assignment_score) : '—'} value={overrideScore} onChange={(e) => setOverrideScore(e.target.value)} />
              </div>
              <Button size="sm" variant="default" onClick={saveOverride} disabled={!overrideScore}>Save override</Button>
              <p className="ml-auto max-w-xs text-xs text-muted-foreground">Override the AI number with your own judgement. Stored as the final score.</p>
            </div>
          </CardBody>
        </Card>
      )}

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

      {/* Human decision note + audit trail */}
      <Card>
        <CardBody className="space-y-3">
          <div className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Human decision note</h2>
          </div>
          <Textarea value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} placeholder="Why this decision? Required when rejecting. Recorded for audit." className="min-h-[80px]" />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={saveNote}>Save note</Button>
            {app.decided_at && (
              <p className="text-xs text-muted-foreground">
                Last updated {formatDate(app.decided_at)} · {decidedByMe ? 'by you' : 'by a reviewer'}
                {app.decision_reason ? ' · reason on file' : ''}
              </p>
            )}
          </div>
        </CardBody>
      </Card>

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
