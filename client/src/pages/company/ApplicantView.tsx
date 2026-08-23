import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
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
  Clock,
  ClipboardCheck,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Check,
  Users,
  RotateCcw,
} from 'lucide-react'
import { applicationsApi, jobsApi } from '@/lib/api'
import { useCompanyData } from '@/lib/companyData'
import { useCurrentUser } from '@/lib/store'
import type { Application, ApplicationStatus, JobListing } from '@/types'
import { VIOLATION_LABEL } from '@/components/ProctorMonitor'
import { Card, CardBody, Badge, Avatar, Label, Textarea, Input } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { AppProgressSteps } from '@/components/AppProgressSteps'
import { DocumentList } from '@/components/DocumentList'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/toast'
import { cn, daysUntil, formatDate } from '@/lib/utils'

const statusTone = { draft: 'outline', pending: 'default', reviewed: 'primary', shortlisted: 'accent', hired: 'success', rejected: 'danger', cancelled: 'danger' } as const

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
  const { toast } = useToast()
  const user = useCurrentUser()!
  const [app, setApp] = useState<Application | null>(null)
  const [job, setJob] = useState<JobListing | null>(null)
  const [loading, setLoading] = useState(true)
  const [scoreBusy, setScoreBusy] = useState(false)
  const [overrideScore, setOverrideScore] = useState<string>('')
  const [decisionNote, setDecisionNote] = useState<string>('')
  const [tab, setTab] = useState('overview')
  // Other applicants for the SAME job, shown in a sidebar so a reviewer can jump
  // straight to any of them (instead of stepping with Prev/Next).
  const [jobApplicants, setJobApplicants] = useState<Application[] | null>(null)

  async function load() {
    if (!id) return
    const a = await applicationsApi.get(id)
    if (!a) { setLoading(false); return }
    const j = await jobsApi.get(a.job_id)
    setApp(a); setJob(j); setDecisionNote(a.decision_reason ?? ''); setLoading(false)
    applicationsApi.byJob(a.job_id).then((list) => setJobApplicants(list ?? [])).catch(() => setJobApplicants([]))
  }
  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <p className="py-20 text-center text-sm text-muted-foreground">Loading…</p>
  if (!app) return <div className="py-20 text-center"><p className="font-medium">Applicant not found.</p></div>

  const hasAssignment = !!job?.assignment && (app.assignment_answers?.length ?? 0) > 0

  // After changing an applicant, mark the company's cached listings/applications
  // stale so returning to "Listings & applications" silently revalidates.
  const markStale = () => useCompanyData.getState().invalidate()

  async function setStatus(s: ApplicationStatus) {
    if (s === 'rejected' && !decisionNote.trim()) {
      toast({ title: 'Add a reason before rejecting', description: 'A rejection reason is required and recorded for audit.', tone: 'error' })
      setTab('decision'); return
    }
    const updated = await applicationsApi.setStatus(app!.id, s, decisionNote.trim() || undefined)
    if (updated) { setApp(updated); markStale(); toast({ title: `Marked ${s === 'hired' ? 'hired' : s}`, tone: 'success' }) }
  }

  async function runAiScore() {
    setScoreBusy(true)
    try {
      const updated = await applicationsApi.scoreAssignment(app!.id)
      if (updated) { setApp(updated); markStale(); toast({ title: 'AI assessment review complete', tone: 'success' }) }
    } catch (e) {
      toast({ title: 'Could not score assignment', description: e instanceof Error ? e.message : undefined, tone: 'error' })
    } finally { setScoreBusy(false) }
  }

  async function saveOverride() {
    const num = Number(overrideScore)
    if (Number.isNaN(num)) return
    const updated = await applicationsApi.review(app!.id, { assignment_score: Math.max(0, Math.min(100, Math.round(num))), decision_reason: decisionNote.trim() || undefined })
    if (updated) { setApp(updated); setOverrideScore(''); markStale(); toast({ title: 'Score override saved', tone: 'success' }) }
  }

  async function saveNote() {
    const updated = await applicationsApi.review(app!.id, { decision_reason: decisionNote.trim() || undefined })
    if (updated) { setApp(updated); markStale(); toast({ title: 'Decision note saved', tone: 'success' }) }
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
    <div className="mx-auto max-w-[1400px]">
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

      <div className="mt-4 grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)_320px]">
        {/* Sidebar: other applicants for this job — jump straight to any of them */}
        <aside className="lg:sticky lg:top-[7.5rem] lg:h-[calc(100vh-9rem)]">
          <Card className="h-full">
            <CardBody className="flex h-full flex-col p-0">
              <div className="border-b border-border px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Applicants</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{jobApplicants?.length ?? 0} for this role</p>
              </div>
              <div className="flex-1 space-y-1 overflow-y-auto p-2">
                {jobApplicants?.map((ja) => {
                  const activeA = ja.id === app.id
                  return (
                    <button
                      key={ja.id}
                      type="button"
                      onClick={() => navigate(`/app/applicants/${ja.id}`)}
                      className={cn('flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors', activeA ? 'border-primary/40 bg-primary/10' : 'border-transparent hover:bg-muted/50')}
                    >
                      <Avatar name={ja.full_name} src={ja.student_avatar_url} size={32} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{ja.full_name}</p>
                        <p className="truncate text-xs text-muted-foreground">{ja.school}{ja.year ? ` · Y${ja.year}` : ''}</p>
                      </div>
                      <Badge tone={statusTone[ja.status]} className="shrink-0 capitalize text-[10px]">{ja.status === 'hired' ? 'Hired' : ja.status}</Badge>
                    </button>
                  )
                })}
              </div>
            </CardBody>
          </Card>
        </aside>

        <div className="min-w-0 space-y-5">
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
              <Avatar name={app.full_name} src={app.student_avatar_url} size={52} />
              <div>
                <h1 className="text-xl font-bold tracking-tight">{app.full_name}</h1>
                <p className="text-sm text-muted-foreground">
                  {app.school}{app.year ? ` · Year ${app.year}` : ''} · Submitted {formatDate(app.created_at)}
                </p>
                {app.student_bio && <p className="mt-1 max-w-xl text-sm text-muted-foreground">{app.student_bio}</p>}
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
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

      <Tabs value={tab} onValueChange={setTab} className="space-y-4 min-w-0">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          {hasAssignment && <TabsTrigger value="assessment">Assessment</TabsTrigger>}
          {hasAssignment && <TabsTrigger value="scoring">AI scoring</TabsTrigger>}
          <TabsTrigger value="decision">Decision</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-5">
          <SectionCard n={1} title="Candidate" desc="Who applied and what they shared">
            <div className="grid gap-5 lg:grid-cols-3">
              <div className="space-y-3 lg:col-span-1">
                <h2 className="font-semibold">Contact</h2>
                <Info icon={Mail} value={app.email} />
                {app.phone && <Info icon={Phone} value={app.phone} />}
                <Info icon={GraduationCap} value={`${app.school ?? '—'}${app.year ? ` · Year ${app.year}` : ''}`} />
                {app.linkedin && <Info icon={Link2} value={app.linkedin} link />}
                {app.student_skills && app.student_skills.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Skills</p>
                    <div className="flex flex-wrap gap-1">{app.student_skills.map((sk) => <Badge key={sk} tone="primary" className="text-[11px]">{sk}</Badge>)}</div>
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
              </div>
            </div>
          </SectionCard>

          <SectionCard n={2} title="Integrity & retry history" desc="Every test return is recorded with a reason">
            <div className="mb-3 flex items-center gap-3 text-sm">
              <span className="rounded-full bg-muted px-3 py-1 font-medium">Attempts used: {app.attempts ?? 0}</span>
              {job?.assignment?.max_attempts ? (
                <span className="rounded-full bg-muted px-3 py-1 font-medium">Limit: {job.assignment.max_attempts}</span>
              ) : null}
            </div>
            {(() => {
              const returns = (app.timeline ?? []).filter((t: any) => t.status === 'test_return')
              if (!returns.length) {
                return <p className="text-sm text-muted-foreground">No test returns recorded — the assessment was completed on the first attempt.</p>
              }
              return (
                <ul className="space-y-2">
                  {returns.map((t: any, i: number) => (
                    <li key={i} className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm">
                      <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                      <div>
                        <p className="font-medium text-danger">Test returned — {VIOLATION_LABEL[t.reason as keyof typeof VIOLATION_LABEL] ?? t.reason ?? 'Integrity violation'}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(t.at)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )
            })()}
            {job?.assignment && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      const updated = await applicationsApi.unlockTest(app.id)
                      setApp(updated)
                      markStale()
                      toast({ title: 'Test re-opened', description: 'The candidate can now retake the assessment.', tone: 'success' })
                    } catch (e) {
                      toast({ title: 'Could not re-open test', description: e instanceof Error ? e.message : undefined, tone: 'error' })
                    }
                  }}
                >
                  <RotateCcw className="h-4 w-4" /> Re-open test (grant another attempt)
                </Button>
                <p className="text-xs text-muted-foreground">Use this if they messaged you or failed — it resets attempts and notifies them.</p>
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* Documents */}
        <TabsContent value="documents" className="space-y-5">
          <SectionCard n={1} title="Documents" desc="Everything the candidate attached">
            <DocumentList documents={app.documents} />
          </SectionCard>
        </TabsContent>

        {/* Assessment */}
        {hasAssignment && (
          <TabsContent value="assessment" className="space-y-5">
            <SectionCard n={1} title="Assessment" desc="The candidate's submitted answers">
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
          </TabsContent>
        )}

        {/* AI scoring */}
        {hasAssignment && (
          <TabsContent value="scoring" className="space-y-5">
            <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <p className="text-muted-foreground"><span className="font-medium text-foreground">You decide — AI only suggests.</span> Scores below are decision aids, not the final call.</p>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-6">
              <ScoreRing score={app.match_score} label="AI match fit" hint="From the student's matching" />
              {hasAssignment && <ScoreRing score={app.assignment_score} label="AI assessment" hint="Run the review below" />}
            </div>

            {app.match_rationale && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p className="text-muted-foreground"><span className="font-medium text-foreground">Why this fit:</span> {app.match_rationale}</p>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {app.ai_recommendation && <Badge tone={app.ai_recommendation === 'advance' ? 'success' : app.ai_recommendation === 'consider' ? 'accent' : 'danger'}>AI suggests: {app.ai_recommendation}</Badge>}
              <Button size="sm" variant="outline" className="gap-1.5" onClick={runAiScore} loading={scoreBusy}>
                <Sparkles className="h-4 w-4 text-accent" /> {app.assignment_score != null ? 'Re-run AI' : 'Run AI review'}
              </Button>
            </div>

            {app.assignment_score != null && (
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

            {app.assignment_ai_feedback?.perQuestion?.length ? (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer font-medium text-muted-foreground">Per-question AI feedback</summary>
                <ul className="mt-2 space-y-1.5">
                  {app.assignment_ai_feedback.perQuestion.map((pq) => (
                    <li key={pq.id} className="rounded-lg border border-border p-2 text-muted-foreground">{pq.feedback}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </TabsContent>
        )}

        {/* Decision */}
        <TabsContent value="decision" className="space-y-5">
          <SectionCard n={1} title="Decision" desc="The final, human call">
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
        </TabsContent>
      </Tabs>
      </div>

				<aside className="space-y-4 lg:sticky lg:top-[7.5rem] lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto">
					<Card>
						<CardBody className="space-y-3">
							<div className="flex items-center gap-3">
								<Avatar name={app.full_name} src={app.student_avatar_url} size={40} className="rounded-xl" />
								<div className="min-w-0">
									<p className="truncate text-sm font-semibold">{app.full_name}</p>
									<p className="truncate text-xs text-muted-foreground">
										{app.school ?? ''}{app.year ? ` · Y${app.year}` : ''}
									</p>
								</div>
							</div>
							<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								Application
							</p>
							<dl className="divide-y divide-border">
								<div className="flex items-center justify-between gap-3 py-2">
									<dt className="text-xs text-muted-foreground">Applied</dt>
									<dd className="text-sm font-medium">{formatDate(app.created_at)}</dd>
								</div>
								<div className="flex items-center justify-between gap-3 py-2">
									<dt className="text-xs text-muted-foreground">Status</dt>
									<dd><Badge tone={statusTone[app.status]} className="capitalize">{app.status === 'hired' ? 'Hired' : app.status}</Badge></dd>
								</div>
								<div className="flex items-center justify-between gap-3 py-2">
									<dt className="text-xs text-muted-foreground">Assessment</dt>
									<dd className="text-sm font-medium">{app.assignment_status === 'submitted' ? 'Submitted' : app.assignment_status === 'pending' ? 'Pending' : 'Not required'}</dd>
								</div>
								<div className="flex items-center justify-between gap-3 py-2">
									<dt className="text-xs text-muted-foreground">Attempts</dt>
									<dd className="text-sm font-medium">{app.attempts ?? 0} / {job?.assignment?.max_attempts ?? 10}</dd>
								</div>
								<div className="flex items-center justify-between gap-3 py-2">
									<dt className="text-xs text-muted-foreground">Test submitted</dt>
									<dd className="text-sm font-medium text-right">
										{app.assignment_submitted_at ? (
											<span className="flex items-center justify-end gap-1.5">
												{formatDate(app.assignment_submitted_at)}
												{app.assignment_late && <Badge tone="danger" className="px-1.5 py-0.5 text-[10px]">Late</Badge>}
											</span>
										) : '—'}
									</dd>
								</div>
							</dl>
						</CardBody>
					</Card>

					<Card>
						<CardBody className="space-y-3">
							<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Process</p>
							<div className="mt-1"><AppProgressSteps status={app.status} /></div>
						</CardBody>
					</Card>

					<Card>
						<CardBody className="space-y-3">
							<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What's next</p>
							<div className="mt-1">
								{app.assignment_status === 'submitted' && app.assignment_score == null ? (
									<div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
										<div className="flex items-start gap-2.5">
											<ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
											<div className="min-w-0">
												<p className="text-sm font-semibold leading-tight">Review the assessment</p>
												<p className="mt-1 text-xs leading-relaxed text-muted-foreground">The candidate submitted the test. Review answers, then run AI scoring.</p>
											</div>
										</div>
									</div>
								) : app.status === 'shortlisted' || app.status === 'reviewed' ? (
									<div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
										<div className="flex items-start gap-2.5">
											<UserCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
											<div className="min-w-0">
												<p className="text-sm font-semibold leading-tight">Make a decision</p>
												<p className="mt-1 text-xs leading-relaxed text-muted-foreground">You have enough signal to advance, reject, or hold this candidate.</p>
											</div>
										</div>
									</div>
								) : app.status === 'pending' ? (
									<div className="rounded-xl border border-border bg-muted/30 p-3">
										<div className="flex items-start gap-2.5">
											<Clock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
											<div className="min-w-0">
												<p className="text-sm font-semibold leading-tight">Awaiting review</p>
												<p className="mt-1 text-xs leading-relaxed text-muted-foreground">This application is new. Check the candidate profile and assessment.</p>
											</div>
										</div>
									</div>
								) : (
									<div className="rounded-xl border border-success/30 bg-success/5 p-3">
										<div className="flex items-start gap-2.5">
											<CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
											<div className="min-w-0">
												<p className="text-sm font-semibold leading-tight">Status: {app.status}</p>
												<p className="mt-1 text-xs leading-relaxed text-muted-foreground">No immediate action required.</p>
											</div>
										</div>
									</div>
								)}
							</div>
						</CardBody>
					</Card>
				</aside>
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
