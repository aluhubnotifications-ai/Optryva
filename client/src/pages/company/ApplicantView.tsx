import { Fragment, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Mail,
  MapPin,
  Phone,
  GraduationCap,
  Link2,
  MessageSquare,
  Star,
  CheckCircle2,
  XCircle,
  ClipboardCheck,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Check,
  Users,
} from 'lucide-react'
import { applicationsApi, jobsApi, profilesApi } from '@/lib/api'
import { useCurrentUser } from '@/lib/store'
import type { Application, ApplicationStatus, JobListing, Profile } from '@/types'
import { Card, CardBody, Badge, Avatar, Label, Textarea, Input } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { AppProgressSteps } from '@/components/AppProgressSteps'
import { DocumentList } from '@/components/DocumentList'
import { useToast } from '@/components/ui/toast'
import { cn, daysUntil, formatDate } from '@/lib/utils'

const statusTone = { pending: 'default', reviewed: 'primary', shortlisted: 'accent', hired: 'success', rejected: 'danger' } as const
type StepId = 'candidate' | 'assessment' | 'scoring' | 'decision'

function band(score?: number): 'success' | 'accent' | 'default' | 'danger' {
  if (score == null) return 'default'
  return score >= 75 ? 'success' : score >= 55 ? 'accent' : 'danger'
}
function bandLabel(score?: number): string {
  if (score == null) return 'No score'
  return score >= 75 ? 'Strong' : score >= 55 ? 'Consider' : 'Weak'
}
function ScorePill({ label, score }: { label: string; score?: number }) {
  if (score == null) return null
  return <Badge tone={band(score)} className="gap-1"><Sparkles className="h-3 w-3" /> {label} {score}</Badge>
}

/* Consistent AI-score visual: a color-banded ring. Color (not just the number)
 * carries the signal — following the ATS pattern of color/symbol scales to keep
 * human ratings comparable and reduce bias. */
function ScoreRing({ score, label, hint }: { score?: number; label: string; hint?: string }) {
  const r = 34
  const c = 2 * Math.PI * r
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100
  const color = score == null ? 'var(--border)' : band(score) === 'success' ? 'hsl(var(--success))' : band(score) === 'accent' ? 'hsl(var(--warning))' : 'hsl(var(--danger))'
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-[84px] w-[84px]">
        <svg viewBox="0 0 84 84" className="h-full w-full -rotate-90">
          <circle cx="42" cy="42" r={r} fill="none" stroke="var(--border)" strokeWidth="8" />
          <circle cx="42" cy="42" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold">{score ?? '—'}</span>
        </div>
      </div>
      <p className="mt-1 text-sm font-semibold">{label}</p>
      <p className="text-xs text-muted-foreground">{score == null ? (hint ?? 'Not scored') : bandLabel(score)}</p>
    </div>
  )
}

export default function ApplicantView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { toast } = useToast()
  const user = useCurrentUser()!
  const [app, setApp] = useState<Application | null>(null)
  const [job, setJob] = useState<JobListing | null>(null)
  const [student, setStudent] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [scoreBusy, setScoreBusy] = useState(false)
  const [overrideScore, setOverrideScore] = useState<string>('')
  const [decisionNote, setDecisionNote] = useState<string>('')
  const [active, setActive] = useState<StepId>('candidate')
  // Ordered sibling ids so a reviewer can step Prev/Next through the inbox they
  // came from. Passed via router state by the inbox; if opened directly we fall
  // back to this listing's applicants (fetched below).
  const [siblingIds, setSiblingIds] = useState<string[] | null>(null)
  const refs: Record<StepId, React.RefObject<HTMLDivElement>> = {
    candidate: useRef<HTMLDivElement>(null),
    assessment: useRef<HTMLDivElement>(null),
    scoring: useRef<HTMLDivElement>(null),
    decision: useRef<HTMLDivElement>(null),
  }

  async function load() {
    if (!id) return
    const a = await applicationsApi.get(id)
    if (!a) { setLoading(false); return }
    const [j, s] = await Promise.all([jobsApi.get(a.job_id), profilesApi.get(a.student_id)])
    setApp(a); setJob(j); setStudent(s); setDecisionNote(a.decision_reason ?? ''); setLoading(false)
    const passed = (location.state as { siblingIds?: string[] } | null)?.siblingIds
    if (passed?.length) setSiblingIds(passed)
    else applicationsApi.byJob(a.job_id).then((list) => { if (list?.length) setSiblingIds(list.map((x) => x.id)) }).catch(() => {})
  }
  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <p className="py-20 text-center text-sm text-muted-foreground">Loading…</p>
  if (!app) return <div className="py-20 text-center"><p className="font-medium">Applicant not found.</p></div>

  const idx = siblingIds ? siblingIds.indexOf(app.id) : -1
  const prevId = idx > 0 ? siblingIds![idx - 1] : null
  const nextId = idx >= 0 && idx < (siblingIds?.length ?? 0) - 1 ? siblingIds![idx + 1] : null
  const goApplicant = (sid: string | null) => { if (sid) navigate(`/app/applicants/${sid}`, { state: siblingIds ? { siblingIds } : undefined }) }

  const hasAssignment = !!job?.assignment && (app.assignment_answers?.length ?? 0) > 0
  const sectionOrder: StepId[] = hasAssignment ? ['candidate', 'assessment', 'scoring', 'decision'] : ['candidate', 'scoring', 'decision']
  const sectionIndex = sectionOrder.indexOf(active)
  const go = (s: StepId) => { setActive(s); refs[s].current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }

  async function setStatus(s: ApplicationStatus) {
    if (s === 'rejected' && !decisionNote.trim()) {
      toast({ title: 'Add a reason before rejecting', description: 'A rejection reason is required and recorded for audit.', tone: 'error' })
      setActive('decision'); return
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

  const actions: { label: string; status: ApplicationStatus; icon: typeof Mail; variant: 'outline' | 'default' | 'success' | 'danger' }[] = [
    { label: 'Reviewed', status: 'reviewed', icon: Mail, variant: 'outline' },
    { label: 'Shortlist', status: 'shortlisted', icon: Star, variant: 'default' },
    { label: 'Hire', status: 'hired', icon: CheckCircle2, variant: 'success' },
    { label: 'Reject', status: 'rejected', icon: XCircle, variant: 'danger' },
  ]

  const decidedByMe = app.decision_by === user.id
  const answerMap = new Map((app.assignment_answers ?? []).map((a) => [a.question_id ?? a.criterion_id, a.answer]))
  const questions = job?.assignment?.questions?.length
    ? job.assignment.questions.map((q) => ({ id: q.id, prompt: q.prompt, required: q.required }))
    : job?.assignment?.rubric.map((cr) => ({ id: cr.id, prompt: cr.label, required: true })) ?? []
  const feedbackMap = new Map((app.assignment_ai_feedback?.perQuestion ?? []).map((p) => [p.id, p.feedback]))

  const listingDeadline = job ? daysUntil(job.deadline) : null

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(job ? `/app/listings/${job.id}` : '/app/listings')}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to listing
        </button>
        {job && (
          <button
            type="button"
            onClick={() => navigate('/app/listings')}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            All listings
          </button>
        )}
      </div>

      {/* Listing context — always visible so reviewers know which role this is for */}
      {job && (
        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-card to-accent/5">
          <CardBody className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Applied for</p>
              <h2 className="mt-1 flex items-center gap-2 text-lg font-bold tracking-tight">
                <Briefcase className="h-5 w-5 shrink-0 text-primary" />
                <span className="truncate">{job.title}</span>
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {job.location}</span>
                <span>{job.listing_type}</span>
                <span>{formatDate(app.created_at)}</span>
                {listingDeadline !== null && (
                  <Badge tone={listingDeadline <= 3 ? 'warning' : 'outline'} className="text-[11px]">
                    {listingDeadline <= 0 ? 'Closed' : `${listingDeadline}d left`}
                  </Badge>
                )}
              </div>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5 shrink-0" onClick={() => navigate(`/app/listings/${job.id}`)}>
              <Users className="h-4 w-4" /> View all applicants
            </Button>
          </CardBody>
        </Card>
      )}

      {/* Header */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex gap-3">
              <Avatar name={app.full_name} src={student?.avatar_url} size={56} />
              <div>
                <h1 className="text-xl font-bold tracking-tight">{app.full_name}</h1>
                <p className="text-sm text-muted-foreground">
                  {app.school}{app.year ? ` · Year ${app.year}` : ''} · Submitted {formatDate(app.created_at)}
                </p>
                {student?.bio && <p className="mt-1 max-w-xl text-sm text-muted-foreground">{student.bio}</p>}
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              {siblingIds && idx >= 0 && (
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" className="gap-1" disabled={!prevId} onClick={() => goApplicant(prevId)}><ArrowRight className="h-3.5 w-3.5 rotate-180" /> Prev</Button>
                  <span className="text-xs text-muted-foreground">{idx + 1} / {siblingIds.length}</span>
                  <Button size="sm" variant="outline" className="gap-1" disabled={!nextId} onClick={() => goApplicant(nextId)}>Next <ArrowRight className="h-3.5 w-3.5" /></Button>
                </div>
              )}
              <Badge tone={statusTone[app.status]} className="capitalize">{app.status === 'hired' ? 'Hired' : app.status}</Badge>
              <div className="flex gap-1.5">
                <ScorePill label="Fit" score={app.match_score} />
                <ScorePill label="Test" score={app.assignment_score} />
              </div>
            </div>
          </div>
          <div className="mt-5 border-t border-border pt-5"><AppProgressSteps status={app.status} /></div>
        </CardBody>
      </Card>

      {/* Section stepper (mirrors the listing editor / application form) */}
      <nav className="flex flex-wrap items-center gap-1 sm:gap-2">
        {sectionOrder.map((s, i) => (
          <Fragment key={s}>
            <button type="button" onClick={() => go(s)} className={cn('flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium', active === s ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40')}>
              <span className={cn('flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold', active === s ? 'bg-primary text-primary-foreground' : 'bg-muted')}>{i + 1}</span>
              {s === 'candidate' ? 'Candidate' : s === 'assessment' ? 'Assessment' : s === 'scoring' ? 'AI scoring' : 'Decision'}
            </button>
            {i < sectionOrder.length - 1 && <span className="h-px w-5 bg-border sm:w-8" />}
          </Fragment>
        ))}
      </nav>

      {/* 1. Candidate */}
      <div ref={refs.candidate} className="scroll-mt-4">
        <SectionCard n={1} title="Candidate" desc="Who applied and what they shared">
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="space-y-3 lg:col-span-1">
              <h2 className="font-semibold">Contact</h2>
              <Info icon={Mail} value={app.email} />
              {app.phone && <Info icon={Phone} value={app.phone} />}
              <Info icon={GraduationCap} value={`${app.school ?? '—'}${app.year ? ` · Year ${app.year}` : ''}`} />
              {app.linkedin && <Info icon={Link2} value={app.linkedin} link />}
              {student?.skills && student.skills.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Skills</p>
                  <div className="flex flex-wrap gap-1">{student.skills.map((sk) => <Badge key={sk} tone="primary" className="text-[11px]">{sk}</Badge>)}</div>
                </div>
              )}
            </div>
            <div className="space-y-5 lg:col-span-2">
              {app.cover_note && (
                <div>
                  <h2 className="mb-2 font-semibold">Cover note</h2>
                  <p className="text-sm leading-relaxed text-muted-foreground">{app.cover_note}</p>
                </div>
              )}
              <div>
                <h2 className="mb-3 font-semibold">Documents</h2>
                <DocumentList documents={app.documents} />
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* 2. Assessment — what the candidate actually submitted */}
      {hasAssignment && (
        <div ref={refs.assessment} className="scroll-mt-4">
          <SectionCard n={2} title="Assessment" desc="The candidate's submitted answers">
            <div className="mb-3 flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-accent" />
              <p className="font-medium">{job?.assignment?.title}</p>
              <Badge tone={app.assignment_status === 'submitted' ? 'success' : 'default'} className="capitalize">{app.assignment_status === 'submitted' ? 'Submitted' : 'Pending'}</Badge>
            </div>
            {job?.assignment?.prompt && <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{job.assignment.prompt}</p>}
            <div className="space-y-4">
              {questions.map((q) => {
                const answer = answerMap.get(q.id)
                const text = Array.isArray(answer) ? answer.join(', ') : answer?.startsWith('data:') ? (app.assignment_answers?.find((a) => (a.question_id ?? a.criterion_id) === q.id)?.file_name ?? 'File attached') : answer
                const fb = feedbackMap.get(q.id)
                return (
                  <div key={q.id} className="rounded-xl border border-border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium">{q.prompt}</p>
                      {q.required && <Badge tone="outline" className="shrink-0 text-[10px]">Required</Badge>}
                    </div>
                    <div className="mt-3 rounded-lg bg-muted/50 p-3 text-sm leading-relaxed">{text || <span className="text-muted-foreground">No answer submitted.</span>}</div>
                    {fb && (
                      <div className="mt-2 flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-2 text-xs text-muted-foreground">
                        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                        <span><span className="font-medium text-foreground">AI feedback:</span> {fb}</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </SectionCard>
        </div>
      )}

      {/* 3. AI scoring */}
      <div ref={refs.scoring} className="scroll-mt-4">
        <SectionCard n={hasAssignment ? 3 : 2} title="AI scoring" desc="Machine-generated aids — you decide">
          <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <p className="text-muted-foreground"><span className="font-medium text-foreground">You decide — AI only suggests.</span> Scores below are decision aids, not the final call.</p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-6">
            <ScoreRing score={app.match_score} label="AI match fit" hint="From the student's matching" />
            {hasAssignment && <ScoreRing score={app.assignment_score} label="AI assessment" hint="Run the review below" />}
          </div>

          {hasAssignment && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {app.ai_recommendation && <Badge tone={app.ai_recommendation === 'advance' ? 'success' : app.ai_recommendation === 'consider' ? 'accent' : 'danger'}>AI suggests: {app.ai_recommendation}</Badge>}
              <Button size="sm" variant="outline" className="gap-1.5" onClick={runAiScore} loading={scoreBusy}>
                <Sparkles className="h-4 w-4 text-accent" /> {app.assignment_score != null ? 'Re-run AI' : 'Run AI review'}
              </Button>
            </div>
          )}

          {hasAssignment && app.assignment_score != null && (
            <>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{app.assignment_ai_feedback?.overall}</p>
              <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
                <div>
                  <Label className="text-xs">Human score override (0–100)</Label>
                  <Input className="mt-1 w-28" inputMode="numeric" placeholder={String(app.assignment_score)} value={overrideScore} onChange={(e) => setOverrideScore(e.target.value)} />
                </div>
                <Button size="sm" variant="default" onClick={saveOverride} disabled={!overrideScore}>Save override</Button>
                <p className="ml-auto max-w-xs text-xs text-muted-foreground">Override the AI number with your judgement. Stored as the final score.</p>
              </div>
            </>
          )}

          {hasAssignment && app.assignment_ai_feedback?.perQuestion?.length ? (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer font-medium text-muted-foreground">Per-question AI feedback</summary>
              <ul className="mt-2 space-y-1.5">
                {app.assignment_ai_feedback.perQuestion.map((pq) => (
                  <li key={pq.id} className="rounded-lg border border-border p-2 text-muted-foreground">{pq.feedback}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </SectionCard>
      </div>

      {/* 4. Decision */}
      <div ref={refs.decision} className="scroll-mt-4">
        <SectionCard n={sectionOrder.length} title="Decision" desc="The final, human call">
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

          <div className="mt-4 flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Decision note & reason</h2>
          </div>
          <Textarea value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} placeholder="Why this decision? Required when rejecting. Recorded for audit." className="mt-2 min-h-[90px]" />
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={saveNote}>Save note</Button>
            {app.decided_at && (
              <p className="text-xs text-muted-foreground">Last updated {formatDate(app.decided_at)} · {decidedByMe ? 'by you' : 'by a reviewer'}{app.decision_reason ? ' · reason on file' : ''}</p>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  )
}

function SectionCard({ n, title, desc, children }: { n: number; title: string; desc: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardBody>
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{n}</span>
          <div>
            <h2 className="font-semibold leading-tight">{title}</h2>
            <p className="text-xs text-muted-foreground">{desc}</p>
          </div>
        </div>
        {children}
      </CardBody>
    </Card>
  )
}

function Info({ icon: Icon, value, link }: { icon: typeof Mail; value: string; link?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      {link ? <a href={value} target="_blank" rel="noreferrer" className="truncate text-primary hover:underline">{value}</a> : <span className="truncate text-muted-foreground">{value}</span>}
    </div>
  )
}
