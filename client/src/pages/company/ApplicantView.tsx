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
  RotateCcw,
  Unlock,
  Tag,
  Send,
  ChevronRight,
  Pencil,
  UserPlus,
  type LucideIcon,
} from 'lucide-react'
import { applicationsApi, jobsApi, messagesApi } from '@/lib/api'
import { useCompanyData } from '@/lib/companyData'
import { useCurrentUser } from '@/lib/store'
import type { Application, ApplicationStatus, JobListing, Message } from '@/types'
import { VIOLATION_LABEL } from '@/components/ProctorMonitor'
import { Card, CardBody, Badge, Avatar, Label, Textarea, Input } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { AppProgressSteps } from '@/components/AppProgressSteps'
import { DocumentList } from '@/components/DocumentList'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/toast'
import { cn, daysUntil, formatDate } from '@/lib/utils'

const TAG_OPTIONS = ['Strong fit', 'Consider', 'Needs follow-up', 'Referral', 'Watch', 'Do not advance'] as const

// Each tag gets a distinct colour so they read at a glance in the profile and
// the applicant list.
const TAG_STYLES: Record<string, { on: string; off: string }> = {
  'Strong fit': { on: 'bg-success text-success-foreground border-success', off: 'bg-success/10 text-success border-success/30' },
  'Consider': { on: 'bg-accent text-accent-foreground border-accent', off: 'bg-accent/10 text-accent border-accent/30' },
  'Referral': { on: 'bg-primary text-primary-foreground border-primary', off: 'bg-primary/10 text-primary border-primary/30' },
  'Needs follow-up': { on: 'bg-warning text-warning-foreground border-warning', off: 'bg-warning/10 text-warning border-warning/30' },
  'Watch': { on: 'bg-secondary text-secondary-foreground border-secondary', off: 'bg-secondary/40 text-secondary-foreground border-secondary' },
  'Do not advance': { on: 'bg-danger text-danger-foreground border-danger', off: 'bg-danger/10 text-danger border-danger/30' },
}

/** Coloured tag chip. Clickable (toggle) when `onClick` is supplied. Each tag
 * keeps its own colour: a subtle tint when off, solid when on. */
function TagChip({ tag, active, onClick }: { tag: string; active: boolean; onClick?: () => void }) {
  const cls = cn(
    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition',
    (TAG_STYLES[tag] ?? { on: 'border-border bg-muted text-muted-foreground', off: 'border-border bg-muted text-muted-foreground' })[active ? 'on' : 'off'],
  )
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls}>
        {tag}
        {active && <XCircle className="h-3 w-3" />}
      </button>
    )
  }
  return <span className={cls}>{tag}</span>
}

const TAG_VAR: Record<string, string> = {
  'Strong fit': '--success',
  'Consider': '--accent',
  'Referral': '--primary',
  'Needs follow-up': '--warning',
  'Watch': '--secondary',
  'Do not advance': '--danger',
}

/** First tag (in canonical order) applied to a candidate — used to colour the
 * ring around their picture so the tag is visible everywhere they appear. */
function primaryTag(tags?: string[]): string | undefined {
  const list = tags ?? []
  return TAG_OPTIONS.find((t) => list.includes(t))
}

/** Coloured ring (matching the candidate's primary tag) drawn around the avatar
 * via an inline box-shadow, so it renders everywhere regardless of Tailwind JIT. */
function avatarRingStyle(tags?: string[]): { boxShadow?: string } {
  const t = primaryTag(tags)
  if (!t) return {}
  return { boxShadow: `0 0 0 3px hsl(var(--card)), 0 0 0 6px hsl(var(${TAG_VAR[t]}))` }
}

/* Greenhouse-style clickable hiring stages. Each stage jumps to the matching tab
 * and advances the candidate's status when clicked. */
const STAGES: { label: string; tab: string; to: ApplicationStatus | null }[] = [
  { label: 'Applied', tab: 'overview', to: 'pending' },
  { label: 'Reviewed', tab: 'scoring', to: 'reviewed' },
  { label: 'Shortlisted', tab: 'decision', to: 'shortlisted' },
  { label: 'Decision', tab: 'decision', to: null },
]

const NEXT_STATUS: Record<string, ApplicationStatus> = { pending: 'reviewed', reviewed: 'shortlisted', shortlisted: 'hired' }

function stageIndex(status: ApplicationStatus): number {
  switch (status) {
    case 'pending': return 0
    case 'reviewed': return 1
    case 'shortlisted': return 2
    case 'hired':
    case 'rejected': return 3
    default: return -1
  }
}

function StageTracker({ status, onStage }: { status: ApplicationStatus; onStage: (s: (typeof STAGES)[number]) => void }) {
  const current = stageIndex(status)
  return (
    <div className="flex items-center">
      {STAGES.map((stage, i) => {
        const done = i < current || (i === current && status === 'hired')
        const active = i === current && status !== 'hired'
        const isDecision = i === 3
        const decided = isDecision && (status === 'hired' || status === 'rejected')
        return (
          <div key={stage.label} className="flex flex-1 items-center last:flex-none">
            <button type="button" onClick={() => onStage(stage)} className="group flex flex-col items-center focus:outline-none">
              <span
                className={cn(
                  'flex items-center justify-center rounded-full border-2 transition-colors',
                  decided ? (status === 'rejected' ? 'border-danger bg-danger text-danger-foreground' : 'border-success bg-success text-success-foreground')
                    : done || active ? 'border-primary bg-primary text-primary-foreground group-hover:opacity-90'
                    : 'border-border bg-card text-muted-foreground group-hover:border-primary/50',
                )}
              >
                {decided ? (status === 'rejected' ? <XCircle className="h-4 w-4" /> : <Check className="h-4 w-4" />)
                  : done ? <Check className="h-4 w-4" />
                  : <span className="text-xs">{i + 1}</span>}
              </span>
              <span className={cn('mt-1.5 text-[11px] font-medium', active || done ? 'text-foreground' : 'text-muted-foreground')}>
                {isDecision && decided ? (status === 'rejected' ? 'Rejected' : 'Accepted') : stage.label}
              </span>
            </button>
            {i < STAGES.length - 1 && (
              <div className={cn('mx-1 h-0.5 flex-1 rounded-full', i < current ? 'bg-primary' : 'bg-border')} />
            )}
          </div>
        )
      })}
    </div>
  )
}

/* Maps a timeline event (or message) to a feed row: icon, title, tone, detail. */
function activityMeta(ev: { status: string; at: string; reason?: string; late?: boolean; note?: string; body?: string }): { icon: LucideIcon; title: string; tone: 'success' | 'primary' | 'accent' | 'danger' | 'default'; detail?: string; badge?: string } {
  switch (ev.status) {
    case 'applied': return { icon: UserPlus, title: 'Applied for this role', tone: 'success' }
    case 'draft': return { icon: Pencil, title: 'Started application', tone: 'default' }
    case 'test_submitted': return { icon: ClipboardCheck, title: 'Submitted assessment', tone: 'primary', badge: ev.late ? 'Late' : undefined }
    case 'test_unlocked': return { icon: RotateCcw, title: 'Assessment re-opened', tone: 'default' }
    case 'test_return': return { icon: RotateCcw, title: 'Test returned', tone: 'danger', detail: VIOLATION_LABEL[(ev.reason as keyof typeof VIOLATION_LABEL) ?? ''] ?? ev.reason ?? 'Integrity violation' }
    case 'pending': return { icon: Clock, title: 'Marked pending', tone: 'default' }
    case 'reviewed': return { icon: CheckCircle2, title: 'Marked reviewed', tone: 'primary' }
    case 'shortlisted': return { icon: Star, title: 'Shortlisted', tone: 'accent' }
    case 'hired': return { icon: CheckCircle2, title: 'Hired', tone: 'success' }
    case 'rejected': return { icon: XCircle, title: 'Rejected', tone: 'danger', detail: ev.note }
    case 'message': return { icon: MessageSquare, title: 'Message', tone: 'default', detail: ev.body }
    default: return { icon: Clock, title: ev.status, tone: 'default' }
  }
}

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

/* Deterministic monogram avatar (data URL) — used as a fallback so every
 * candidate has a visible avatar even when they haven't uploaded a photo.
 * When a real photo URL exists it takes precedence. */
function monogramAvatar(name?: string): string {
  const n = name?.trim() || '?'
  const initials = (n.split(/\s+/).map((s) => s[0] ?? '').slice(0, 2).join('') || '?').toUpperCase()
  let hash = 0
  for (let i = 0; i < n.length; i++) hash = (hash * 31 + n.charCodeAt(i)) >>> 0
  const hue = hash % 360
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="hsl(${hue} 55% 50%)"/><text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="system-ui, sans-serif" font-size="40" font-weight="600" fill="#fff">${initials}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
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
  const [draftMsg, setDraftMsg] = useState('')
  const [threadMsgs, setThreadMsgs] = useState<Message[]>([])
  const [busyMsg, setBusyMsg] = useState(false)
  const [tagMenu, setTagMenu] = useState(false)
  const [ratings, setRatings] = useState<Record<string, number>>({})
  // Which archived assessment attempt is being reviewed (null = latest).
  const [attemptIdx, setAttemptIdx] = useState<number | null>(null)
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
    messagesApi.thread(a.id).then(setThreadMsgs).catch(() => setThreadMsgs([]))
  }
  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <p className="py-20 text-center text-sm text-muted-foreground">Loading…</p>
  if (!app) return <div className="py-20 text-center"><p className="font-medium">Applicant not found.</p></div>

  const hasAssignment = !!job?.assignment && ((app.assignment_answers?.length ?? 0) > 0 || (app.assignment_attempts?.length ?? 0) > 0)

  // Every submitted attempt is archived (assignment_attempts) so the first
  // attempt stays reviewable even after the employer grants a retake. Older
  // applications without an archive are synthesised from the current fields.
  const archivedAttempts = (app.assignment_attempts ?? []) as any[]
  const attempts = archivedAttempts.length
    ? archivedAttempts
    : (app.assignment_status === 'submitted'
        ? [{
            index: 1, is_retake: false, submitted_at: app.assignment_submitted_at, late: app.assignment_late,
            duration_seconds: null, answers: app.assignment_answers ?? [], score: app.assignment_score ?? null,
            ai_feedback: app.assignment_ai_feedback ?? null, recommendation: app.ai_recommendation ?? null,
          }]
        : [])
  const activeAttemptIdx = attemptIdx != null && attemptIdx < attempts.length ? attemptIdx : attempts.length - 1
  const attempt = attempts[activeAttemptIdx]

  const AttemptSwitcher = attempts.length > 1 ? (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">Attempt:</span>
      {attempts.map((a: any, i: number) => (
        <button
          key={i}
          type="button"
          onClick={() => setAttemptIdx(i)}
          className={cn('rounded-full border px-3 py-1 text-xs font-medium transition', i === activeAttemptIdx ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-muted hover:border-accent')}
        >
          Attempt {a.index}{a.is_retake ? ' (retake)' : ''}
        </button>
      ))}
    </div>
  ) : null

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

  const advance = () => {
    const next = NEXT_STATUS[app!.status]
    if (next) setStatus(next)
  }

  async function sendMessage() {
    const body = draftMsg.trim()
    if (!body) return
    setBusyMsg(true)
    try {
      await messagesApi.send({ thread_id: app!.id, scope: 'application', sender_id: user.id, body, kind: 'text' })
      setDraftMsg('')
      const msgs = await messagesApi.thread(app!.id)
      setThreadMsgs(msgs)
      toast({ title: 'Message sent', tone: 'success' })
    } catch (e) {
      toast({ title: 'Could not send', description: e instanceof Error ? e.message : undefined, tone: 'error' })
    } finally { setBusyMsg(false) }
  }

  async function toggleTag(tag: string) {
    const cur = app!.tags ?? []
    const adding = !cur.includes(tag)
    const next = adding ? [...cur, tag] : cur.filter((t) => t !== tag)
    const updated = await applicationsApi.review(app!.id, { tags: next })
    if (updated) { setApp({ ...app!, ...updated }); markStale() }
    toast({ title: adding ? `Tagged “${tag}”` : `Removed “${tag}”`, tone: 'success' })
    setTagMenu(false)
  }

  const saveScorecard = async () => {
    const vals = Object.values(ratings)
    if (!vals.length) return
    const avg = Math.round(vals.reduce((s, n) => s + n, 0) / vals.length)
    const updated = await applicationsApi.review(app!.id, { assignment_score: avg, decision_reason: decisionNote.trim() || undefined })
    if (updated) { setApp(updated); setOverrideScore(''); markStale(); toast({ title: 'Scorecard saved', tone: 'success' }) }
  }

  const actions: { label: string; status: ApplicationStatus; icon: typeof Mail; variant: 'outline' | 'default' | 'success' | 'danger' }[] = [
    { label: 'Reviewed', status: 'reviewed', icon: Mail, variant: 'outline' },
    { label: 'Shortlist', status: 'shortlisted', icon: Star, variant: 'default' },
    { label: 'Hire', status: 'hired', icon: CheckCircle2, variant: 'success' },
    { label: 'Reject', status: 'rejected', icon: XCircle, variant: 'danger' },
  ]

  const decidedByMe = app.decision_by === user.id
  const answerMap = new Map(((attempt?.answers ?? []) as any[]).map((a) => [a.question_id ?? a.criterion_id, a.answer]))
  const questions = job?.assignment?.questions?.length
    ? job.assignment.questions.map((q) => ({ id: q.id, prompt: q.prompt, required: q.required }))
    : job?.assignment?.rubric.map((cr) => ({ id: cr.id, prompt: cr.label, required: true })) ?? []
  const feedbackMap = new Map(((attempt?.ai_feedback?.perQuestion ?? []) as any[]).map((p) => [p.id, p.feedback]))

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
                      <Avatar name={ja.full_name} src={ja.student_avatar_url || monogramAvatar(ja.full_name)} size={32} style={avatarRingStyle(ja.tags)} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{ja.full_name}</p>
                        <p className="truncate text-xs text-muted-foreground">{ja.school}{ja.year ? ` · Y${ja.year}` : ''}</p>
                        {(ja.tags?.length ?? 0) > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {ja.tags!.slice(0, 2).map((t) => (
                              <TagChip key={t} tag={t} active={(ja.tags ?? []).includes(t)} />
                            ))}
                          </div>
                        )}
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
          </CardBody>
        </Card>
      )}

      {/* Header */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex gap-3">
              <Avatar name={app.full_name} src={app.student_avatar_url || monogramAvatar(app.full_name)} size={52} style={avatarRingStyle(app.tags)} />
              <div>
                <h1 className="text-xl font-bold tracking-tight">{app.full_name}</h1>
                <p className="text-sm text-muted-foreground">
                  {app.school}{app.year ? ` · Year ${app.year}` : ''} · Submitted {formatDate(app.created_at)}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {app.match_score != null && <Badge tone={band(app.match_score)} className="gap-1"><Sparkles className="h-3 w-3" /> {app.match_score} match</Badge>}
                  {app.student_skills?.slice(0, 3).map((sk) => (
                    <span key={sk} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{sk}</span>
                  ))}
                  {app.linkedin && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">LinkedIn</span>}
                </div>
                {app.student_bio && <p className="mt-2 max-w-xl text-sm text-muted-foreground">{app.student_bio}</p>}
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
            <div className="mt-5 border-t border-border pt-5"><StageTracker status={app.status} onStage={(s) => { if (s.to) setStatus(s.to); setTab(s.tab) }} /></div>
        </CardBody>
      </Card>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4 min-w-0">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          {hasAssignment && <TabsTrigger value="assessment">Assessment</TabsTrigger>}
          {hasAssignment && <TabsTrigger value="scoring">AI scoring</TabsTrigger>}
          <TabsTrigger value="activity">Activity</TabsTrigger>
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
            <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
              <span className="rounded-full bg-muted px-3 py-1 font-medium">Attempts used: {app.attempts ?? 0}</span>
              <span className="rounded-full bg-muted px-3 py-1 font-medium">Limit: {job?.assignment?.max_attempts ?? 10}</span>
              {app.assignment_status === 'submitted' && (
                <span className="rounded-full bg-success/15 px-3 py-1 font-medium text-success">Assessment completed</span>
              )}
            </div>
            {(() => {
              const INTEGRITY = ['test_return', 'test_submitted', 'test_unlocked']
              const events = (app.timeline ?? [])
                .filter((t: any) => INTEGRITY.includes(t.status))
                .sort((a: any, b: any) => new Date(a.at).getTime() - new Date(b.at).getTime())
              if (!events.length) {
                return <p className="text-sm text-muted-foreground">No assessment activity recorded yet.</p>
              }
              // An attempt is a "retake" once the employer has re-opened the test.
              let seenUnlock = false
              return (
                <ul className="space-y-2">
                  {events.map((t: any, i: number) => {
                    const isReturn = t.status === 'test_return'
                    const isUnlock = t.status === 'test_unlocked'
                    const isSubmitted = t.status === 'test_submitted'
                    if (isUnlock) seenUnlock = true
                    const isRetakeSubmit = isSubmitted && seenUnlock
                    const tone = isReturn ? 'danger' : isSubmitted ? 'success' : 'default'
                    const Icon = isReturn ? RotateCcw : isSubmitted ? CheckCircle2 : Unlock
                    const label = isReturn
                      ? `Test returned — ${VIOLATION_LABEL[t.reason as keyof typeof VIOLATION_LABEL] ?? t.reason ?? 'Integrity violation'}`
                      : isSubmitted
                        ? `Assessment submitted${isRetakeSubmit ? ' (retake)' : ''}${t.late ? ' (late)' : ''}`
                        : 'Retake granted — test re-opened by employer'
                    return (
                      <li key={i} className={cn('flex items-start gap-2 rounded-lg border p-3 text-sm', tone === 'danger' ? 'border-danger/30 bg-danger/5' : tone === 'success' ? 'border-success/30 bg-success/5' : 'border-border bg-muted/30')}>
                        <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-muted-foreground')} />
                        <div>
                          <p className={cn('font-medium', tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : '')}>{label}</p>
                          <p className="text-xs text-muted-foreground">{formatDate(t.at)}</p>
                        </div>
                      </li>
                    )
                  })}
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
              {AttemptSwitcher}
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <ClipboardCheck className="h-4 w-4 text-accent" />
                <p className="font-medium">{job?.assignment?.title}</p>
                <Badge tone={app.assignment_status === 'submitted' ? 'success' : 'default'} className="capitalize">{app.assignment_status === 'submitted' ? 'Submitted' : 'Pending'}</Badge>
                {attempt?.is_retake && <Badge tone="outline" className="text-[10px]">Retake</Badge>}
                {attempt?.late && <Badge tone="outline" className="text-[10px]">Late</Badge>}
                <span className="text-xs text-muted-foreground">
                  {attempts.length > 1 ? `Showing attempt ${activeAttemptIdx + 1} of ${attempts.length}` : `Attempt ${activeAttemptIdx + 1} of ${attempts.length}${attempt?.is_retake ? ' (retake)' : ' (first)'}`}
                </span>
              </div>
              {job?.assignment?.prompt && <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{job.assignment.prompt}</p>}
              <div className="space-y-4">
                {questions.map((q) => {
                  const answer = answerMap.get(q.id)
                  const text = Array.isArray(answer) ? answer.join(', ') : answer?.startsWith('data:') ? ((attempt?.answers ?? []) as any[]).find((a) => (a.question_id ?? a.criterion_id) === q.id)?.file_name ?? 'File attached' : answer
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
            {AttemptSwitcher}
            {attempts.length <= 1 && (
              <p className="text-xs text-muted-foreground">Attempt {activeAttemptIdx + 1} of {attempts.length}{attempt?.is_retake ? ' (retake)' : ' (first)'}</p>
            )}
            <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <p className="text-muted-foreground"><span className="font-medium text-foreground">You decide — AI only suggests.</span> Scores below are decision aids, not the final call.</p>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-6">
              <ScoreRing score={app.match_score} label="AI match fit" hint="From the student's matching" />
              {hasAssignment && <ScoreRing score={attempt?.score ?? null} label="AI assessment" hint="Run the review below" />}
            </div>

            {app.match_rationale && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p className="text-muted-foreground"><span className="font-medium text-foreground">Why this fit:</span> {app.match_rationale}</p>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {attempt?.recommendation && <Badge tone={attempt.recommendation === 'advance' ? 'success' : attempt.recommendation === 'consider' ? 'accent' : 'danger'}>AI suggests: {attempt.recommendation}</Badge>}
              <Button size="sm" variant="outline" className="gap-1.5" onClick={runAiScore} loading={scoreBusy}>
                <Sparkles className="h-4 w-4 text-accent" /> {attempt?.score != null ? 'Re-run AI' : 'Run AI review'}
              </Button>
            </div>

            <SectionCard n={2} title="Scorecard" desc="Rate each criterion — the average becomes the final score">
              <div className="space-y-3">
                {questions.map((q) => {
                  const fb = feedbackMap.get(q.id)
                  const r = ratings[q.id] ?? 0
                  return (
                    <div key={q.id} className="rounded-xl border border-border p-3">
                      <p className="text-sm font-medium">{q.prompt}</p>
                      {fb && <p className="mt-1 text-xs leading-relaxed text-muted-foreground"><span className="font-medium text-foreground">AI:</span> {fb}</p>}
                      <div className="mt-2 flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setRatings((p) => ({ ...p, [q.id]: n }))}
                            className={cn('h-7 w-7 rounded-full text-sm font-semibold transition-colors', r >= n ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70')}
                          >
                            {n}
                          </button>
                        ))}
                        <span className="ml-2 text-xs text-muted-foreground">{r ? `${r}/5` : 'Not rated'}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
              <Button size="sm" variant="default" className="mt-3 gap-1.5" onClick={saveScorecard} disabled={!Object.keys(ratings).length}>
                <Check className="h-4 w-4" /> Save scorecard
              </Button>
            </SectionCard>

            {attempt?.score != null && (
              <>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{attempt.ai_feedback?.overall}</p>
                <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
                  <div>
                    <Label className="text-xs">Human score override (0–100)</Label>
                    <Input className="mt-1 w-28" inputMode="numeric" placeholder={String(attempt.score)} value={overrideScore} onChange={(e) => setOverrideScore(e.target.value)} />
                  </div>
                  <Button size="sm" variant="default" onClick={saveOverride} disabled={!overrideScore}>Save override</Button>
                  <p className="ml-auto max-w-xs text-xs text-muted-foreground">Override the AI number with your judgement. Stored as the final score.</p>
                </div>
              </>
            )}

            {attempt?.ai_feedback?.perQuestion?.length ? (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer font-medium text-muted-foreground">Per-question AI feedback</summary>
                <ul className="mt-2 space-y-1.5">
                  {attempt.ai_feedback.perQuestion.map((pq: any) => (
                    <li key={pq.id} className="rounded-lg border border-border p-2 text-muted-foreground">{pq.feedback}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </TabsContent>
        )}

        {/* Activity */}
        <TabsContent value="activity" className="space-y-5">
          <SectionCard n={1} title="Activity" desc="Everything that's happened on this application">
            {(() => {
              const TONE_CLASS: Record<string, string> = {
                success: 'bg-success/15 text-success',
                primary: 'bg-primary/15 text-primary',
                accent: 'bg-accent/15 text-accent',
                danger: 'bg-danger/15 text-danger',
                default: 'bg-muted text-muted-foreground',
              }
              const events = [
                ...(app.timeline ?? []).map((t: any) => ({ ...t })),
                ...threadMsgs.map((m) => ({ status: 'message', at: m.created_at, body: m.body })),
              ].sort((a: any, b: any) => new Date(b.at).getTime() - new Date(a.at).getTime())
              if (!events.length) return <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
              return (
                <ol className="relative space-y-4 border-l border-border pl-5">
                  {events.map((ev: any, i: number) => {
                    const meta = activityMeta(ev)
                    const Icon = meta.icon
                    return (
                      <li key={i} className="relative">
                        <span className={cn('absolute -left-[1.65rem] flex h-7 w-7 items-center justify-center rounded-full border-2 border-card', TONE_CLASS[meta.tone])}>
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">{meta.title}</p>
                          {meta.badge && <Badge tone="danger" className="px-1.5 py-0.5 text-[10px]">{meta.badge}</Badge>}
                        </div>
                        {meta.detail && <p className="text-xs text-muted-foreground">{meta.detail}</p>}
                        <p className="text-xs text-muted-foreground/70">{formatDate(ev.at)}</p>
                      </li>
                    )
                  })}
                </ol>
              )
            })()}
          </SectionCard>
        </TabsContent>

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

      {/* Sticky action bar — disposition actions stay within reach while scrolling */}
      <div className="sticky bottom-2 z-10 -mx-1 rounded-xl border border-border bg-card/95 p-3 shadow-card backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Current stage:</span>
          <Badge tone={statusTone[app.status]} className="capitalize">{app.status === 'hired' ? 'Hired' : app.status === 'rejected' ? 'Rejected' : app.status}</Badge>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={advance} disabled={!NEXT_STATUS[app.status]}>
              <ChevronRight className="h-4 w-4" /> Advance
            </Button>
            <Button size="sm" variant="danger" className="gap-1.5" onClick={() => setStatus('rejected')} disabled={app.status === 'rejected'}>
              <XCircle className="h-4 w-4" /> Reject
            </Button>
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate(`/app/messages?thread=${app.id}&scope=application`)}>
              <MessageSquare className="h-4 w-4" /> Message
            </Button>
          </div>
        </div>
      </div>
      </div>

				<aside className="space-y-4 lg:sticky lg:top-[7.5rem] lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto">
					<Card>
						<CardBody className="space-y-3">
							<div className="flex flex-col items-center gap-2 text-center">
								<Avatar name={app.full_name} src={app.student_avatar_url || monogramAvatar(app.full_name)} size={64} className="rounded-2xl" style={avatarRingStyle(app.tags)} />
								<div className="min-w-0">
									<p className="text-sm font-semibold">{app.full_name}</p>
									<p className="text-xs text-muted-foreground">
										{app.school ?? ''}{app.year ? ` · Y${app.year}` : ''}
									</p>
								</div>
							</div>
							<div>
								<p className="text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tags</p>
								<div className="mt-1.5 flex flex-wrap justify-center gap-1">
									{TAG_OPTIONS.map((t) => (
										<TagChip key={t} tag={t} active={(app.tags ?? []).includes(t)} onClick={() => toggleTag(t)} />
									))}
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
							<p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Message candidate</p>
							<div className="space-y-2">
								{threadMsgs.length > 0 && (
									<div className="space-y-1 border-l-2 border-border pl-2">
										{threadMsgs.slice(-3).reverse().map((m, i) => (
											<p key={i} className="truncate text-xs text-muted-foreground">{m.body}</p>
										))}
									</div>
								)}
								<Textarea value={draftMsg} onChange={(e) => setDraftMsg(e.target.value)} placeholder="Write a message…" className="min-h-[60px] text-sm" />
								<Button size="sm" variant="default" className="w-full gap-1.5" onClick={sendMessage} loading={busyMsg} disabled={!draftMsg.trim()}>
									<Send className="h-4 w-4" /> Send
								</Button>
							</div>
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
