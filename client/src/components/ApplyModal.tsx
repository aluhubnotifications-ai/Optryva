import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  Upload,
  FileText,
  X,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Wand2,
  ThumbsUp,
  ClipboardCheck,
  Check,
  ArrowRight,
} from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Input, Label, Textarea, Select, Badge } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/toast'
import { aiApi, applicationsApi } from '@/lib/api'
import { ProctorMonitor, VIOLATION_LABEL } from '@/components/ProctorMonitor'
import type { ProctorViolation } from '@/components/ProctorMonitor'
import { cn, fileToDataUrl, formatBytes } from '@/lib/utils'
import type { AiAssignmentQuestion, Application, AppDocument, JobListing, Profile } from '@/types'

const OPTIONAL_DOCS: { kind: AppDocument['kind']; label: string }[] = [
  { kind: 'cover', label: 'Cover Letter' },
  { kind: 'transcript', label: 'Transcript' },
  { kind: 'portfolio', label: 'Portfolio' },
  { kind: 'recommendation', label: 'Recommendation' },
  { kind: 'certificate', label: 'Certificate' },
  { kind: 'id', label: 'ID' },
]

type CoachResult = Awaited<ReturnType<typeof aiApi.coach>>
type Step = 'info' | 'resume' | 'assessment' | 'submission'

interface ApplyModalProps {
  open: boolean
  onClose: () => void
  job: JobListing | null
  user: Profile
  onSubmitted?: (a: Application) => void
}

export function ApplyModal({ open, onClose, job, user, onSubmitted }: ApplyModalProps) {
  return (
    <Modal open={open} onClose={onClose} size="xl" title={job ? `Apply — ${job.title}` : 'Apply'} description="Complete each step, then submit. Takes a couple of minutes.">
      <ApplyForm job={job} user={user} onClose={onClose} onSubmitted={onSubmitted} />
    </Modal>
  )
}

export function ApplyForm({ job, user, onClose, onSubmitted }: { job: JobListing | null; user: Profile; onClose?: () => void; onSubmitted?: (a: Application) => void }) {
  const { toast } = useToast()
  const [form, setForm] = useState({
    full_name: user.full_name,
    email: user.email,
    phone: '',
    school: user.school ?? '',
    year: user.year ? String(user.year) : '',
    linkedin: user.linkedin ?? '',
  })
  const [coverNote, setCoverNote] = useState('')
  // Pre-fill the CV from the résumé on the student's profile (a real file, so the
  // company can open it). They can still replace it with a different file.
  const [docs, setDocs] = useState<Record<string, AppDocument>>(
    user.cv_url && user.cv_filename
      ? {
          cv: {
            kind: 'cv',
            name: user.cv_filename,
            url: user.cv_url,
            mime: user.cv_url.startsWith('data:') ? user.cv_url.slice(5, user.cv_url.indexOf(';')) || 'application/pdf' : 'application/pdf',
            size: 0,
          },
        }
      : {},
  )
  const [submitting, setSubmitting] = useState(false)
  const [assignmentAnswers, setAssignmentAnswers] = useState<Record<string, string | string[]>>({})
  const [assignmentFileNames, setAssignmentFileNames] = useState<Record<string, string>>({})
  const [interviewFirst, setInterviewFirst] = useState(false)
  const [alreadyApplied, setAlreadyApplied] = useState<Application | null>(null)
  const [savingDraft, setSavingDraft] = useState(false)
  const [proctorCancelled, setProctorCancelled] = useState<ProctorViolation | null>(null)

  // Resume a previously saved draft (and detect an already-submitted application)
  // so a candidate can come back later and pick up where they left off.
  useEffect(() => {
    if (!job?.id) return
    let cancelled = false
    setAlreadyApplied(null)
    setAssignmentAnswers({})
    setAssignmentFileNames({})
    setInterviewFirst(false)
    applicationsApi
      .byStudent(user.id)
      .then((list) => {
        if (cancelled) return
        const existing = list.find((a) => a.job_id === job.id && a.status !== 'draft')
        if (existing) setAlreadyApplied(existing)
      })
      .catch(() => {})
    applicationsApi
      .getDraft(job.id)
      .then((draft) => {
        if (cancelled || !draft) return
        setForm({
          full_name: draft.full_name,
          email: draft.email,
          phone: draft.phone ?? '',
          school: draft.school ?? '',
          year: draft.year ? String(draft.year) : '',
          linkedin: draft.linkedin ?? '',
        })
        setCoverNote(draft.cover_note ?? '')
        const d: Record<string, AppDocument> = {}
        for (const doc of draft.documents ?? []) d[doc.kind] = doc
        setDocs(d)
        // The test (assessment) is intentionally NOT restored from a draft — it is
        // only ever completed and submitted, so a student can't pre-fill answers
        // offline and resume them. assignmentAnswers / assignmentFileNames stay empty.
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [job?.id])

  // AI coach
  const [coachLoading, setCoachLoading] = useState(false)
  const [coach, setCoach] = useState<CoachResult | null>(null)
  const assignment = job?.assignment
  const externalApply = !!job?.apply_url
  const crossPosted = !!job?.original_company_name
  // A candidate assignment only applies to a genuine in-app application by the company
  // itself — not to external-link listings or roles forwarded from another company.
  const hasAssignment = !!assignment && !externalApply && !crossPosted
  const questions = assignment?.questions ?? []
  const answerFilled = (question: AiAssignmentQuestion) => {
    const answer = assignmentAnswers[question.id]
    if (question.type === 'essay') {
      const text = typeof answer === 'string' ? answer : ''
      const wc = countWords(text)
      if (!text.trim()) return false
      if (question.minWords && wc < question.minWords) return false
      if (question.maxWords && wc > question.maxWords) return false
      return true
    }
    return Array.isArray(answer) ? answer.length > 0 : !!answer?.trim()
  }

  const valid = useMemo(
    () => form.full_name && /\S+@\S+\.\S+/.test(form.email) && form.school && form.year && docs.cv && (!hasAssignment || !assignment?.due_before_interview || questions.every((question) => !question.required || answerFilled(question))),
    [form, docs, job, hasAssignment, assignment, assignmentAnswers],
  )

  async function setDoc(kind: AppDocument['kind'], file: File | null) {
    if (!file) {
      setDocs((d) => { const n = { ...d }; delete n[kind]; return n })
      return
    }
    try {
      const url = await fileToDataUrl(file)
      setDocs((d) => ({ ...d, [kind]: { kind, name: file.name, url, mime: file.type || 'application/octet-stream', size: file.size } }))
    } catch (e) {
      toast({ title: 'Could not attach that file', description: e instanceof Error ? e.message : undefined, tone: 'error' })
    }
  }

  async function runCoach() {
    if (!job) return
    setCoachLoading(true)
    setCoach(null)
    const res = await aiApi.coach(user, job)
    setCoach(res)
    setCoachLoading(false)
  }

  async function setAssignmentFile(question: AiAssignmentQuestion, file?: File) {
    if (!file) return
    const url = await fileToDataUrl(file)
    setAssignmentAnswers((current) => ({ ...current, [question.id]: url }))
    setAssignmentFileNames((current) => ({ ...current, [question.id]: file.name }))
  }

  async function submit() {
    if (!job || !valid) return
    const documents = Object.values(docs)
    // All attachments are sent inline as base64; keep the whole payload under the
    // server's body limit so the application isn't rejected mid-upload.
    const totalBytes = documents.reduce((s, d) => s + (d.url?.length ?? 0), 0)
    if (totalBytes > 22 * 1024 * 1024) {
      toast({ title: 'Attachments too large', description: `Combined size is ${formatBytes(totalBytes)}. Please remove some files or use smaller ones.`, tone: 'error' })
      return
    }
    setSubmitting(true)
    try {
      const app = await applicationsApi.create({
        student_id: user.id,
        job_id: job.id,
        cover_note: coverNote || undefined,
        documents,
        full_name: form.full_name,
        email: form.email,
        phone: form.phone || undefined,
        school: form.school,
        year: form.year ? Number(form.year) : undefined,
        linkedin: form.linkedin || undefined,
        assignment_answers: hasAssignment
          ? questions.length
            ? questions.map((question) => ({
                question_id: question.id,
                answer: assignmentAnswers[question.id] ?? '',
                ...(question.type === 'file' || question.type === 'video' ? { file_name: assignmentFileNames[question.id] } : {}),
              }))
            : assignment.rubric.map((criterion) => ({ criterion_id: criterion.id, answer: assignmentAnswers[criterion.id] ?? '' }))
          : [],
      })
      toast({ title: 'Application submitted! 🎉', description: `${job.title} — good luck!`, tone: 'success' })
      onSubmitted?.(app)
      onClose?.()
    } catch (e) {
      toast({ title: 'Could not submit application', description: e instanceof Error ? e.message : 'Please try again.', tone: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  // Persist a resumable draft (incomplete is fine) so the candidate can return later.
  async function saveDraft() {
    if (!job) return
    try {
      setSavingDraft(true)
      const documents = Object.values(docs).map((d) => ({ ...d }))
      await applicationsApi.saveDraft({
        student_id: user.id,
        job_id: job.id,
        cover_note: coverNote || undefined,
        documents,
        full_name: form.full_name,
        email: form.email,
        phone: form.phone || undefined,
        school: form.school,
        year: form.year ? Number(form.year) : undefined,
        linkedin: form.linkedin || undefined,
      })
      toast({ title: 'Draft saved', description: 'You can come back and finish later.', tone: 'success' })
    } catch (e) {
      toast({ title: 'Could not save draft', description: e instanceof Error ? e.message : 'Please try again.', tone: 'error' })
    } finally {
      setSavingDraft(false)
    }
  }

  // ---- Section wizard (mirrors the company listing editor) ----
  const sectionOrder: Step[] = hasAssignment ? ['info', 'resume', 'assessment', 'submission'] : ['info', 'resume', 'submission']
  const [active, setActive] = useState<Step>('info')
  const sectionIndex = sectionOrder.indexOf(active)
  const prevId = sectionIndex > 0 ? sectionOrder[sectionIndex - 1] : null
  const nextId = sectionIndex < sectionOrder.length - 1 ? sectionOrder[sectionIndex + 1] : null

  const sections: { id: Step; label: string; done: boolean; optional?: boolean }[] = [
    { id: 'info', label: 'Your info', done: !!(form.full_name && form.email && form.school && form.year) },
    { id: 'resume', label: 'Résumé', done: !!docs.cv },
    ...(hasAssignment
      ? [{ id: 'assessment' as Step, label: 'Assessment', done: questions.every((q) => !q.required || answerFilled(q)), optional: !assignment?.due_before_interview }]
      : []),
    { id: 'submission', label: 'Submit', done: false },
  ]

  if (alreadyApplied) {
    const cancelled = alreadyApplied.status === 'cancelled'
    const reason = alreadyApplied.timeline?.[0]?.reason as ProctorViolation | undefined
    return (
      <div className={`space-y-4 rounded-2xl border p-6 text-center ${cancelled ? 'border-danger/30 bg-danger/5' : 'border-border bg-card'}`}>
        {cancelled && <AlertTriangle className="mx-auto h-8 w-8 text-danger" />}
        <p className="text-lg font-semibold">{cancelled ? 'Application cancelled' : "You've already applied to this role"}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {cancelled
            ? reason
              ? VIOLATION_LABEL[reason]
              : 'An integrity violation was recorded for this test.'
            : 'You can track its status from your applications list. We’ll notify you of any updates.'}
        </p>
        <Button className="mt-3" onClick={() => onClose?.()}>Back</Button>
      </div>
    )
  }

  function handleProctorViolation(reason: ProctorViolation) {
    setProctorCancelled(reason)
    if (job?.id) applicationsApi.proctorCancel({ job_id: job.id, reason }).catch(() => {})
  }

  if (proctorCancelled) {
    return (
      <div className="space-y-4 rounded-2xl border border-danger/30 bg-danger/5 p-6 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-danger" />
        <p className="text-lg font-semibold">Test cancelled</p>
        <p className="mt-1 text-sm text-muted-foreground">{VIOLATION_LABEL[proctorCancelled]}</p>
        <p className="text-xs text-muted-foreground">This application cannot be continued. The integrity violation has been recorded.</p>
        <Button className="mt-3" onClick={() => onClose?.()}>Back</Button>
      </div>
    )
  }

  const proctoring = active === 'assessment' && hasAssignment && !proctorCancelled

  return (
    <div className="space-y-5">
      <ProctorMonitor active={proctoring} onViolation={handleProctorViolation} />
        <nav className="flex flex-wrap items-center gap-1 sm:gap-2">
          {sections.map((s, i) => (
            <Fragment key={s.id}>
              <button type="button" disabled={proctoring} onClick={() => setActive(s.id)} className={cn('flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium', active === s.id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40', proctoring && 'pointer-events-none opacity-50')}>
                <span className={cn('flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold', s.done || active === s.id ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
                  {s.done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                {s.label}
                {s.optional && !s.done && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Optional</span>}
              </button>
              {i < sections.length - 1 && <span className="h-px w-5 bg-border sm:w-8" />}
            </Fragment>
          ))}
        </nav>

        {active === 'info' && (
          <section className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Full name <span className="text-danger">*</span></Label>
              <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div>
              <Label>Email <span className="text-danger">*</span></Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 555 0100" />
            </div>
            <div>
              <Label>School / University <span className="text-danger">*</span></Label>
              <Input value={form.school} onChange={(e) => setForm({ ...form, school: e.target.value })} />
            </div>
            <div>
              <Label>Year of study <span className="text-danger">*</span></Label>
              <Select value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })}>
                <option value="">Select…</option>
                <option value="1">Year 1</option>
                <option value="2">Year 2</option>
                <option value="3">Year 3</option>
                <option value="4">Year 4</option>
              </Select>
            </div>
            <div>
              <Label>LinkedIn</Label>
              <Input value={form.linkedin} onChange={(e) => setForm({ ...form, linkedin: e.target.value })} placeholder="https://linkedin.com/in/…" />
            </div>
          </section>
        )}

        {active === 'resume' && (
          <section className="space-y-3">
            <p className="text-xs text-muted-foreground">Your résumé is pre-selected from your profile — the one used when matching you to this role. You can replace it if needed.</p>
            <FileDrop
              label="CV / Résumé *"
              doc={docs.cv}
              required
              onPick={(f) => setDoc('cv', f)}
              onRemove={() => setDoc('cv', null)}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              {OPTIONAL_DOCS.map((d) => (
                <FileDrop key={d.kind} label={d.label} compact doc={docs[d.kind]} onPick={(f) => setDoc(d.kind, f)} onRemove={() => setDoc(d.kind, null)} />
              ))}
            </div>
          </section>
        )}

        {active === 'assessment' && hasAssignment && assignment && (
          <section className="space-y-3">
            <div className="rounded-2xl border border-accent/30 bg-accent/5 p-4">
              <div className="flex items-start gap-3">
                <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                <div className="min-w-0">
                  <p className="font-semibold">{assignment.title}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{assignment.prompt}</p>
                  <p className="mt-2 text-xs text-muted-foreground">Your test answers aren't saved as a draft — complete and submit to record them.</p>
                  {assignment.due_before_interview ? (
                    <p className="mt-2 text-xs font-medium text-accent">Required with your application — it's reviewed before your interview.</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      <p className="text-xs font-medium text-accent">Optional exercise — you can complete it after you apply.</p>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={interviewFirst} onChange={(e) => setInterviewFirst(e.target.checked)} className="h-4 w-4 accent-primary" />
                        I'd like to interview before the test
                      </label>
                      {interviewFirst && (
                        <p className="text-xs text-muted-foreground">We'll let the company know you'd prefer to interview first; you can submit this assignment afterward.</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {(questions.length ? questions : assignment.rubric.map((criterion) => ({ id: criterion.id, type: 'essay' as const, prompt: criterion.label, required: true }))).map((question) => (
                  <QuestionField key={question.id} question={question} value={assignmentAnswers[question.id]} onChange={(value) => setAssignmentAnswers((current) => ({ ...current, [question.id]: value }))} onFile={(file) => setAssignmentFile(question, file)} />
                ))}
              </div>
            </div>
          </section>
        )}

        {active === 'submission' && (
          <section className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <ReviewRow label="Name" value={form.full_name} />
              <ReviewRow label="Email" value={form.email} />
              <ReviewRow label="School" value={form.school} />
              <ReviewRow label="Year" value={form.year ? `Year ${form.year}` : '—'} />
              <ReviewRow label="Résumé" value={docs.cv?.name ?? 'Not attached'} />
              <ReviewRow label="Assessment" value={hasAssignment ? `${questions.filter((q) => answerFilled(q)).length}/${questions.length} answered` : 'Not included'} />
            </div>

            <div>
              <Label>Cover note</Label>
              <Textarea value={coverNote} onChange={(e) => setCoverNote(e.target.value)} placeholder="Tell them why you're a great fit…" className="min-h-[120px]" />
            </div>

            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="flex items-center gap-2 font-semibold">
                    <Sparkles className="h-5 w-5 text-primary" /> AI Application Coach
                  </p>
                  <p className="text-xs text-muted-foreground">Draft a tailored cover paragraph, get it critiqued, then refined.</p>
                </div>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={runCoach} loading={coachLoading}>
                  <Wand2 className="h-4 w-4 text-primary" /> {coach ? 'Regenerate' : 'Draft with AI'}
                </Button>
              </div>

              {coach && (
                <div className="mt-4 space-y-3 animate-fade-in">
                  <Stage n={1} title="Draft">
                    <p className="text-sm leading-relaxed text-muted-foreground">{coach.draft}</p>
                  </Stage>
                  <Stage n={2} title="Critique" verdict={coach.critique.verdict}>
                    <div className="space-y-1.5 text-sm">
                      {coach.critique.strengths.map((s, i) => (
                        <p key={`s${i}`} className="flex gap-2 text-muted-foreground"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />{s}</p>
                      ))}
                      {coach.critique.weaknesses.map((w, i) => (
                        <p key={`w${i}`} className="flex gap-2 text-muted-foreground"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />{w}</p>
                      ))}
                    </div>
                  </Stage>
                  <Stage n={3} title="Final" highlight>
                    <p className="text-sm leading-relaxed">{coach.final}</p>
                    <Button size="sm" className="mt-3 gap-1.5" onClick={() => setCoverNote(coach.final)}>
                      <ThumbsUp className="h-4 w-4" /> Use this paragraph
                    </Button>
                  </Stage>
                </div>
              )}
            </div>

            {!valid && <p className="text-xs text-muted-foreground">Fill the required fields (*) and attach your résumé{assignment?.due_before_interview ? ' and complete the required assignment questions' : ''} to submit.</p>}
          </section>
        )}

        <div className="flex items-center gap-2 border-t border-border pt-4">
          <Button variant="ghost" onClick={onClose} disabled={proctoring}>Cancel</Button>
          <Button variant="outline" type="button" onClick={saveDraft} loading={savingDraft}>Save draft</Button>
          <div className="ml-auto flex gap-2">
            {active !== 'info' && (
              <Button variant="outline" type="button" disabled={proctoring} onClick={() => { if (prevId) setActive(prevId) }}>Back</Button>
            )}
            {active === 'submission' ? (
              <Button onClick={submit} disabled={!valid} loading={submitting}>Submit application</Button>
            ) : (
              <Button type="button" className="gap-1.5" onClick={() => { if (nextId) setActive(nextId) }}>Next <ArrowRight className="h-4 w-4" /></Button>
            )}
          </div>
        </div>
      </div>
  )
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm font-medium" title={value}>{value}</p>
    </div>
  )
}

function Stage({ n, title, children, verdict, highlight }: { n: number; title: string; children: React.ReactNode; verdict?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${highlight ? 'border-success/30 bg-success/5' : 'border-border bg-card'}`}>
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{n}</span>
        <span className="text-sm font-semibold">{title}</span>
        {verdict && <Badge tone={verdict === 'ship as-is' ? 'success' : verdict === 'rewrite' ? 'danger' : 'warning'} className="ml-auto capitalize">{verdict}</Badge>}
      </div>
      {children}
    </div>
  )
}

function countWords(s: string): number {
  return (s.trim().match(/\S+/g) ?? []).length
}

function QuestionField({ question, value, onChange, onFile }: { question: AiAssignmentQuestion; value?: string | string[]; onChange: (value: string | string[]) => void; onFile: (file: File) => void }) {
  const selected = Array.isArray(value) ? value : []
  const choices = question.type === 'true_false' ? ['True', 'False'] : question.options ?? []
  const limitHint =
    question.minWords || question.maxWords
      ? ` (${question.minWords ? `${question.minWords}–` : ''}${question.maxWords ?? ''} words${question.minWords && !question.maxWords ? ' min' : ''})`
      : ''
  return <div>
    <Label>{question.prompt || 'Assignment question'} {question.required && <span className="text-danger">*</span>}{limitHint && <span className="ml-1 font-normal text-muted-foreground">{limitHint}</span>}</Label>
    {question.type === 'essay' ? (
      <div>
        <Textarea
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Write your answer…"
          className="min-h-[100px]"
        />
        {(question.minWords || question.maxWords) && (() => {
          const wc = countWords(typeof value === 'string' ? value : '')
          const over = question.maxWords ? wc > question.maxWords : false
          const under = question.minWords ? wc < question.minWords : false
          return (
            <p className={`mt-1 text-xs ${over || under ? 'text-danger' : 'text-muted-foreground'}`}>
              {wc} words{question.maxWords ? ` / ${question.maxWords} max` : ''}
              {question.minWords ? ` · ${question.minWords} min` : ''}
              {over ? ' — too long' : under ? ' — too short' : ''}
            </p>
          )
        })()}
      </div>
    ) : question.type === 'file' || question.type === 'video' ? (
      <Input type="file" accept={question.type === 'video' ? 'video/*' : '.pdf,.doc,.docx,image/*'} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
    ) : (
      <div className="space-y-2">
        {choices.map((choice) => (
          <label key={choice} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm hover:border-accent">
            <input
              type={question.type === 'multiple_choice' ? 'checkbox' : 'radio'}
              name={question.id}
              checked={question.type === 'multiple_choice' ? selected.includes(choice) : value === choice}
              onChange={() => (question.type === 'multiple_choice' ? onChange(selected.includes(choice) ? selected.filter((item) => item !== choice) : [...selected, choice]) : onChange(choice))}
              className="h-4 w-4 accent-primary"
            />
            {choice}
          </label>
        ))}
      </div>
    )}
    {(question.type === 'file' || question.type === 'video') && typeof value === 'string' && value && <p className="mt-1 text-xs text-success">File attached</p>}
  </div>
}

function FileDrop({
  label,
  doc,
  onPick,
  onRemove,
  required,
  compact,
}: {
  label: string
  doc?: AppDocument
  onPick: (f: File) => void
  onRemove: () => void
  required?: boolean
  compact?: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  return (
    <div
      onClick={() => !doc && ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        const f = e.dataTransfer.files?.[0]
        if (f) onPick(f)
      }}
      className={`flex cursor-pointer items-center gap-3 rounded-xl border border-dashed p-3 transition-colors ${
        drag ? 'border-primary bg-primary/5' : doc ? 'border-success/40 bg-success/5' : 'border-input hover:border-primary/40'
      } ${compact ? '' : 'py-4'}`}
    >
      <input
        ref={ref}
        type="file"
        accept=".pdf,.doc,.docx,image/*"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])}
      />
      {doc ? <FileText className="h-5 w-5 shrink-0 text-success" /> : <Upload className="h-5 w-5 shrink-0 text-muted-foreground" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{doc ? doc.name : label}</p>
        <p className="text-xs text-muted-foreground">{doc ? `${(doc.size / 1024).toFixed(0)} KB` : required ? 'Required · click or drop' : 'Optional'}</p>
      </div>
      {doc && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-danger"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
