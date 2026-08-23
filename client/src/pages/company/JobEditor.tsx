import { Fragment, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Building2, Check, ClipboardCheck, Eye, ImagePlus, Lock, Plus, Sparkles, Trash2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { fileToDataUrl, imageFileToDataUrl, cn } from '@/lib/utils'
import { useCurrentUser } from '@/lib/store'
import { aiApi, jobsApi } from '@/lib/api'
import { COUNTRIES } from '@/lib/geo'
import { JobPostingView, AssignmentView } from '@/components/JobPostingView'
import type { AiAssignment, AiAssignmentQuestion, AiRubricCriterion, JobListing, ListingType } from '@/types'
import { Avatar, Input, Label, Textarea, Select, Skeleton } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/toast'

const CATEGORIES = ['Software Engineering', 'Data', 'Design', 'Marketing', 'Operations', 'Finance', 'Product']
const LISTING_TYPES: ListingType[] = ['Internship', 'Full-time', 'Part-time', 'Fellowship']
const LIVE_COUNTRIES = COUNTRIES.filter((c) => !c.disabled && c.code !== 'all').map((c) => c.name)

type AssignmentDraft = {
  title: string
  prompt: string
  dueBeforeInterview: boolean
  maxAttempts: number
  rubric: AiRubricCriterion[]
  questions: AiAssignmentQuestion[]
}

export default function JobEditor() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [job, setJob] = useState<JobListing | null | undefined>(undefined)

  useEffect(() => {
    const fromState = (location.state as any)?.job as JobListing | undefined
    if (fromState) {
      setJob(fromState)
      return
    }
    if (id) {
      jobsApi.get(id).then((j) => setJob(j ?? null)).catch(() => setJob(null))
      return
    }
    setJob(null)
  }, [id, location.state])

  const goBack = () => navigate('/app/listings')

  // After creating, land on the edit page so the assignment can be added/edited
  // inline (the listing now exists and is linked).
  const handleSaved = (saved?: JobListing) => {
    if (!id && saved) navigate(`/app/listings/${saved.id}/edit`, { replace: true })
    else goBack()
  }

  if (job === undefined) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-10">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <button onClick={goBack} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" /> Back to listings
      </button>
      <h1 className="text-2xl font-bold tracking-tight">{job ? 'Edit listing' : 'Create a listing'}</h1>
      <JobEditorForm editing={job} onSaved={handleSaved} onCancel={goBack} />
    </div>
  )
}

function JobEditorForm({ editing, onSaved, onCancel }: { editing: JobListing | null; onSaved: (saved?: JobListing) => void; onCancel: () => void }) {
  const user = useCurrentUser()!
  const { toast } = useToast()
  const navigate = useNavigate()
  const isSchool = user.user_type === 'school'
  const isCompany = user.user_type === 'company'
  // Companies post their own opportunities, so the listing country is locked to
  // the company's profile country. Schools may choose a country per opportunity.
  const countryLocked = isCompany && !!user.country
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [assignmentPreview, setAssignmentPreview] = useState(false)
  const logoRef = useRef<HTMLInputElement>(null)

  async function onLogoFile(file?: File) {
    if (!file) return
    try {
      const dataUrl = await imageFileToDataUrl(file)
      setF((p) => ({ ...p, original_company_logo_url: dataUrl }))
    } catch (e) {
      toast({ title: 'Could not use that image', description: e instanceof Error ? e.message : undefined, tone: 'error' })
    } finally {
      if (logoRef.current) logoRef.current.value = ''
    }
  }

  const [f, setF] = useState({
    title: '', description: '', type: 'Software Engineering', listing_type: 'Internship' as ListingType,
    country: user.country || 'Remote', location: '', pay: '', duration: '', deadline: '', tags: '',
    responsibilities: [] as string[], benefits: [] as string[], qualifications: [] as string[],
    applyMode: 'in_app' as 'in_app' | 'external', apply_url: '', allowed_years: [] as number[],
    allowed_schools: '', students_only: false,
    fromOther: false, original_company_name: '', original_company_logo_url: '',
  })

  const [assignment, setAssignment] = useState<AssignmentDraft | null>(null)

  useEffect(() => {
    setError(null)
    setPreview(false)
      if (editing) {
        setF({
          title: editing.title, description: editing.description, type: editing.type, listing_type: editing.listing_type,
          country: isCompany ? (user.country || editing.country || 'Remote') : editing.country, location: editing.location, pay: editing.pay ?? '', duration: editing.duration ?? '',
        deadline: editing.deadline ? editing.deadline.slice(0, 10) : '', tags: editing.tags.join(', '),
        responsibilities: editing.responsibilities ?? [], benefits: editing.benefits ?? [], qualifications: editing.qualifications ?? [],
        applyMode: editing.apply_url ? 'external' : 'in_app', apply_url: editing.apply_url ?? '', allowed_years: editing.allowed_years,
        allowed_schools: (editing.allowed_schools ?? []).join(', '), students_only: editing.students_only ?? false,
        fromOther: !!editing.original_company_name, original_company_name: editing.original_company_name ?? '', original_company_logo_url: editing.original_company_logo_url ?? '',
      })
      if (editing.assignment) {
        setAssignment({
          title: editing.assignment.title,
          prompt: editing.assignment.prompt,
          dueBeforeInterview: editing.assignment.due_before_interview ?? true,
          maxAttempts: editing.assignment.max_attempts ?? 10,
          rubric: editing.assignment.rubric ?? [],
          questions: editing.assignment.questions ?? [],
        })
      } else {
        setAssignment(null)
      }
    } else {
      setF((p) => ({ ...p, title: '', description: '', pay: '', duration: '', deadline: '', tags: '', responsibilities: [], benefits: [], qualifications: [], apply_url: '', allowed_years: [], allowed_schools: '', students_only: false, fromOther: false, original_company_name: '', country: user.country || 'Remote' }))
      setAssignment(null)
    }
  }, [editing])

  function toggleYear(y: number) {
    setF((p) => ({ ...p, allowed_years: p.allowed_years.includes(y) ? p.allowed_years.filter((x) => x !== y) : [...p.allowed_years, y] }))
  }

  // ---- AI assignment studio (inline): upload a brief, ask AI to design questions + rubric ----
  const [studioOpen, setStudioOpen] = useState(false)
  const [studioFile, setStudioFile] = useState<{ name: string; dataUrl: string; kind: string } | null>(null)
  const [studioInstruction, setStudioInstruction] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [generated, setGenerated] = useState<{ title: string; prompt: string; questions: any[]; rubric: any[] } | null>(null)
  const studioFileRef = useRef<HTMLInputElement>(null)

  function studioKindFromFile(file: File): string {
    if (file.type === 'application/pdf') return 'pdf'
    if (file.type.includes('wordprocessingml') || file.type === 'application/msword') return 'doc'
    if (file.type.startsWith('image/')) return 'image'
    if (file.type.startsWith('text/')) return 'text'
    return 'doc'
  }

  async function onStudioFile(file?: File) {
    if (!file) return
    try {
      const dataUrl = await fileToDataUrl(file, 12 * 1024 * 1024)
      setStudioFile({ name: file.name, dataUrl, kind: studioKindFromFile(file) })
      setGenError(null)
    } catch (e) {
      toast({ title: 'Could not read that file', description: e instanceof Error ? e.message : undefined, tone: 'error' })
    } finally {
      if (studioFileRef.current) studioFileRef.current.value = ''
    }
  }

  async function runGeneration(refine: boolean) {
    setGenerating(true)
    setGenError(null)
    try {
      const payload: any = {
        job: { title: f.title, description: f.description, type: f.type, tags: f.tags.split(',').map((t: string) => t.trim()).filter(Boolean) },
        instruction: studioInstruction,
        sources: studioFile ? [studioFile] : [],
      }
      if (refine && generated) payload.existing = { questions: generated.questions, rubric: generated.rubric }
      else if (assignment) payload.existing = { questions: assignment.questions, rubric: assignment.rubric }
      const res = await aiApi.generateAssignment(payload)
      setGenerated({
        title: res.title,
        prompt: res.prompt,
        questions: (res.questions ?? []).map((q: any, i: number) => ({ ...q, id: `q-${Date.now()}-${i}` })),
        rubric: (res.rubric ?? []).map((c: any, i: number) => ({ ...c, id: `rc-${Date.now()}-${i}` })),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not generate.'
      setGenError(msg === 'unauthorized' ? 'Your session expired — please sign in again.' : `AI generation failed: ${msg}`)
    } finally {
      setGenerating(false)
    }
  }

  function useGenerated() {
    if (!generated) return
    setAssignment((prev) => ({
      title: generated.title || prev?.title || '',
      prompt: generated.prompt || prev?.prompt || '',
      dueBeforeInterview: prev?.dueBeforeInterview ?? true,
      maxAttempts: prev?.maxAttempts ?? 10,
      rubric: generated.rubric,
      questions: generated.questions,
    }))
    setGenerated(null)
    setStudioOpen(false)
    toast({ title: 'Assignment updated with AI suggestions', tone: 'success' })
  }

  function draftAssignment() {
    setAssignment((prev) => ({
      title: prev?.title || `${f.title || 'Role'} practical challenge`,
      prompt: prev?.prompt || `Show us how you would approach a realistic problem for this ${f.type || 'role'}. Share your assumptions, decisions, and what you would measure.`,
      dueBeforeInterview: prev?.dueBeforeInterview ?? true,
      maxAttempts: prev?.maxAttempts ?? 10,
      rubric: prev?.rubric?.length ? prev.rubric : [
        { id: 'clarity', label: 'Problem framing and clarity', points: 30 },
        { id: 'approach', label: 'Technical or strategic approach', points: 40 },
        { id: 'communication', label: 'Communication and trade-offs', points: 30 },
      ],
      questions: prev?.questions?.length ? prev.questions : [{ id: 'question-1', type: 'essay', prompt: '', required: true }],
    }))
  }

  async function removeAssignment() {
    setSaving(true)
    try {
      if (editing) await jobsApi.update(editing.id, { assignment: null })
      setAssignment(null)
      toast({ title: 'Assignment removed', tone: 'info' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not remove.'
      setError(msg === 'unauthorized' ? 'Your session expired — please sign in again.' : `Could not remove: ${msg}`)
      toast({ title: 'Could not remove assignment', description: msg, tone: 'error' })
    } finally {
      setSaving(false)
    }
  }

  function cleanAssignment(a: AssignmentDraft): AiAssignment {
    return {
      title: a.title.trim() || 'Practical challenge',
      prompt: a.prompt.trim(),
      due_before_interview: a.dueBeforeInterview,
      max_attempts: a.maxAttempts && a.maxAttempts > 0 ? a.maxAttempts : 10,
      rubric: a.rubric.filter((r) => r.label.trim()).map((r) => ({ ...r, label: r.label.trim(), points: Number(r.points) || 0 })),
      questions: a.questions.filter((q) => q.prompt.trim()).map((q) => ({
        ...q,
        prompt: q.prompt.trim(),
        options: q.options?.filter(Boolean),
        minWords: q.minWords && q.minWords > 0 ? q.minWords : null,
        maxWords: q.maxWords && q.maxWords > 0 ? q.maxWords : null,
      })),
    }
  }

  async function submit() {
    if (!f.title.trim() || !f.description.trim()) { setError('Title and description are required.'); return }
    if (f.fromOther && !f.apply_url.trim()) { setError('An external application link is required for opportunities from another company.'); return }
    setError(null)
    setSaving(true)
    const payload = {
      company_id: user.id,
      title: f.title, description: f.description, type: f.type, listing_type: f.listing_type,
      location: f.location || (f.country === 'Remote' ? 'Remote (Global)' : f.country),
      country: f.country, remote: f.country === 'Remote' || /remote/i.test(f.location),
      pay: f.pay || undefined, duration: f.duration || undefined,
      deadline: f.deadline ? new Date(f.deadline).toISOString() : undefined,
      tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
      responsibilities: f.responsibilities.map((t) => t.trim()).filter(Boolean),
      benefits: f.benefits.map((t) => t.trim()).filter(Boolean),
      qualifications: f.qualifications.map((t) => t.trim()).filter(Boolean),
      status: 'active' as const,
      apply_url: f.applyMode === 'external' ? f.apply_url : null,
      allowed_years: f.allowed_years,
      allowed_schools: f.allowed_schools.split(',').map((s) => s.trim()).filter(Boolean),
      students_only: isSchool ? f.students_only : false,
      posted_by_role: (isSchool ? 'school' : 'company') as 'school' | 'company',
      original_company_name: isSchool && f.fromOther ? f.original_company_name : undefined,
      original_company_logo_url: isSchool && f.fromOther ? f.original_company_logo_url : undefined,
      assignment: assignment && assignment.prompt.trim() ? cleanAssignment(assignment) : null,
    }
    try {
      const saved = editing ? await jobsApi.update(editing.id, payload) : await jobsApi.create(payload)
      setError(null)
      toast({ title: editing ? 'Listing updated' : 'Listing posted 🎉', tone: 'success' })
      onSaved(saved ?? undefined)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.'
      setError(msg === 'unauthorized' ? 'Your session expired — please sign in again.' : `Could not save the listing: ${msg}`)
      toast({ title: 'Could not save listing', description: msg, tone: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // ---- Section stepper ----
  // A candidate assignment only makes sense for a genuine in-app application posted
  // by the company itself. It is hidden for external-URL and cross-posted listings.
  const assignmentAllowed = f.applyMode === 'in_app' && !f.fromOther
  type StepId = 'details' | 'assessment' | 'submission'
  const sectionOrder: StepId[] = assignmentAllowed ? ['details', 'assessment', 'submission'] : ['details', 'submission']
  const [active, setActive] = useState<StepId>('details')
  useEffect(() => { if (!assignmentAllowed && active === 'assessment') setActive('details') }, [assignmentAllowed, active])
  const sectionIndex = sectionOrder.indexOf(active)
  const prevId = sectionIndex > 0 ? sectionOrder[sectionIndex - 1] : null
  const nextId = sectionIndex < sectionOrder.length - 1 ? sectionOrder[sectionIndex + 1] : null

  const sections: { id: StepId; label: string; desc: string; icon: LucideIcon; done: boolean; optional?: boolean }[] = [
    { id: 'details', label: 'Job details', desc: 'Role, category, location, pay', icon: ClipboardCheck, done: !!(f.title.trim() && f.description.trim()) },
    ...(assignmentAllowed ? [{ id: 'assessment' as StepId, label: 'Assessment', desc: 'Optional practical task', icon: Sparkles, done: !!assignment?.prompt.trim(), optional: true }] : []),
    { id: 'submission', label: 'Submission', desc: 'Review & preview', icon: Eye, done: false },
  ]

  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap items-center gap-1 sm:gap-2">
        {sections.map((s, i) => (
          <Fragment key={s.id}>
            <button type="button" onClick={() => setActive(s.id)} className={cn('flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium', active === s.id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40')}>
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

      {active === 'details' && (
        <section className="space-y-4">
          <div><Label>Title <span className="text-danger">*</span></Label><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Frontend Engineer Intern" /></div>
          <div><Label>Description <span className="text-danger">*</span></Label><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="min-h-[100px]" placeholder="What the role involves…" /></div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label>Category</Label><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></div>
            <div><Label>Type</Label><Select value={f.listing_type} onChange={(e) => setF({ ...f, listing_type: e.target.value as ListingType })}>{LISTING_TYPES.map((c) => <option key={c}>{c}</option>)}</Select></div>
            <div>
              <Label>Country {countryLocked && <span className="text-xs font-normal text-muted-foreground">· locked to your company</span>}</Label>
              <Select value={f.country} disabled={countryLocked} onChange={(e) => setF({ ...f, country: e.target.value })}>{LIVE_COUNTRIES.map((c) => <option key={c}>{c}</option>)}</Select>
              {countryLocked
                ? <p className="mt-1 text-xs text-muted-foreground">Company listings use your organization's country (set on your profile). Schools may post in any country.</p>
                : isCompany && <p className="mt-1 text-xs text-muted-foreground">Set your company's country on your profile to lock future listings to it.</p>}
            </div>
            <div><Label>Location (display)</Label><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="London, UK · Hybrid" /></div>
            <div><Label>Pay / Stipend</Label><Input value={f.pay} onChange={(e) => setF({ ...f, pay: e.target.value })} placeholder="$2,000 / month" /></div>
            <div><Label>Duration</Label><Input value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value })} placeholder="6 months" /></div>
            <div><Label>Deadline</Label><Input type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></div>
            <div><Label>Tags (comma-separated)</Label><Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="React, TypeScript, Git" /></div>
          </div>

          <ListField label="Responsibilities" hint="Add each responsibility as its own line. Leave empty to auto-generate from the category & tags." items={f.responsibilities} onChange={(responsibilities) => setF({ ...f, responsibilities })} placeholder="e.g. Support financial modeling and reporting" addLabel="Add responsibility" />
          <div className="grid gap-4 sm:grid-cols-2">
            <ListField label="Benefits" items={f.benefits} onChange={(benefits) => setF({ ...f, benefits })} placeholder="e.g. Mentorship from senior team" addLabel="Add benefit" />
            <ListField label="Qualifications" items={f.qualifications} onChange={(qualifications) => setF({ ...f, qualifications })} placeholder="e.g. Familiarity with Excel" addLabel="Add qualification" />
          </div>

          <div>
            <Label>Apply mode</Label>
            <div className="flex gap-2">
              {(['in_app', 'external'] as const).map((m) => (
                <button key={m} type="button" disabled={f.fromOther && m === 'in_app'} onClick={() => setF({ ...f, applyMode: m })} className={cn('flex-1 rounded-lg border px-3 py-2 text-sm font-medium', f.fromOther && m === 'in_app' ? 'cursor-not-allowed opacity-50' : f.applyMode === m ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}>
                  {m === 'in_app' ? 'In-app form' : 'External URL'}
                </button>
              ))}
            </div>
            {f.applyMode === 'external' && (
              <div className="mt-2">
                <Input value={f.apply_url} onChange={(e) => setF({ ...f, apply_url: e.target.value })} placeholder="https://company.com/apply" />
                {f.fromOther && !f.apply_url.trim() && <p className="mt-1 text-xs text-danger">Required — applications go to the other company via their link, not our form.</p>}
              </div>
            )}
            {f.fromOther && <p className="mt-1 text-xs text-muted-foreground">Because this is another company's opportunity, students must apply on their site. The in-app form is disabled.</p>}
          </div>

          <div>
            <Label>Restrict to years (optional)</Label>
            <div className="flex gap-2">
              {[1, 2, 3, 4].map((y) => (
                <button key={y} type="button" onClick={() => toggleYear(y)} className={cn('rounded-lg border px-3 py-1.5 text-sm', f.allowed_years.includes(y) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}>Year {y}</button>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Leave empty to show to all years.</p>
          </div>

          <div>
            <Label>Restrict to schools / universities (optional)</Label>
            <Input value={f.allowed_schools} onChange={(e) => setF({ ...f, allowed_schools: e.target.value })} placeholder="e.g. University of Cape Town, National University of Singapore" />
            <p className="mt-1 text-xs text-muted-foreground">Comma-separated. Only students from these schools will see this opportunity. Leave empty for everyone.</p>
          </div>

          {isSchool && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={f.students_only} onChange={(e) => setF({ ...f, students_only: e.target.checked })} className="h-4 w-4 accent-primary" />
                <Lock className="h-4 w-4 text-primary" /> Only my students can see this
              </label>
              <p className="mt-1 pl-6 text-xs text-muted-foreground">Restricts this listing to people whose login email matches one of your school’s student domains (set on your profile). Others won’t see it anywhere.</p>
            </div>
          )}

          {isSchool && (
            <div className="rounded-xl border border-accent/30 bg-accent/5 p-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={f.fromOther} onChange={(e) => setF({ ...f, fromOther: e.target.checked, applyMode: e.target.checked ? 'external' : 'in_app' })} className="h-4 w-4 accent-[hsl(var(--accent))]" />
                <Building2 className="h-4 w-4 text-accent" /> This opportunity is from another company
              </label>
              {f.fromOther && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div><Label>Company name</Label><Input value={f.original_company_name} onChange={(e) => setF({ ...f, original_company_name: e.target.value })} placeholder="e.g. Microsoft" /></div>
                  <div>
                    <Label>Company logo</Label>
                    <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={(e) => onLogoFile(e.target.files?.[0])} />
                    <div className="flex items-center gap-3">
                      <Avatar name={f.original_company_name} src={f.original_company_logo_url || undefined} size={44} className="rounded-xl" />
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => logoRef.current?.click()}><ImagePlus className="h-4 w-4" /> {f.original_company_logo_url ? 'Change' : 'Upload'}</Button>
                        {f.original_company_logo_url && (<Button type="button" variant="ghost" size="sm" onClick={() => setF({ ...f, original_company_logo_url: '' })}>Remove</Button>)}
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">PNG, JPG, or any image from your device.</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {active === 'assessment' && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5 text-accent" />
                <h2 className="text-xl font-semibold">Candidate assignment</h2>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Optional</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Add a practical task for candidates, or skip and post the listing as-is.</p>
            </div>
            <div className="flex gap-2">
              {!assignment && (
                <Button type="button" size="sm" variant="ghost" onClick={draftAssignment}><Sparkles className="h-4 w-4 text-accent" /> Draft template</Button>
              )}
              {assignment && (
                <Button type="button" size="sm" variant="ghost" className="gap-1.5" onClick={() => setAssignmentPreview(true)}><Eye className="h-4 w-4" /> Preview</Button>
              )}
              <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => setStudioOpen((v) => !v)}><Sparkles className="h-4 w-4 text-accent" /> {studioOpen ? 'Hide AI studio' : 'Generate with AI'}</Button>
            </div>
          </div>

          {studioOpen && (
            <div className="space-y-3 rounded-xl border border-accent/30 bg-accent/5 p-3">
              <p className="text-xs text-muted-foreground">Upload a brief (PDF, Word, image, or text) and/or describe what you want. AI designs the questions and rubric; video submissions are reviewed by a human.</p>
              <div className="flex flex-wrap items-center gap-2">
                <input ref={studioFileRef} type="file" accept=".pdf,.doc,.docx,.txt,image/*,text/*" className="hidden" onChange={(e) => onStudioFile(e.target.files?.[0])} />
                <Button type="button" size="sm" variant="outline" onClick={() => studioFileRef.current?.click()}>
                  <ImagePlus className="h-4 w-4" /> {studioFile ? `Change (${studioFile.name})` : 'Upload document'}
                </Button>
                {studioFile && (<Button type="button" size="sm" variant="ghost" onClick={() => setStudioFile(null)}>Remove</Button>)}
              </div>
              <Textarea value={studioInstruction} onChange={(e) => setStudioInstruction(e.target.value)} className="min-h-[70px]" placeholder="Optional instruction — e.g. 'Make it a take-home coding task', 'Focus on system design', 'Harder, for senior candidates'." />
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => runGeneration(false)} loading={generating}>
                  <Sparkles className="h-4 w-4" /> {generated ? 'Regenerate' : 'Generate questions'}
                </Button>
                {generated && (<Button type="button" size="sm" variant="outline" onClick={() => runGeneration(true)} loading={generating}>Refine with instruction</Button>)}
              </div>
              {genError && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{genError}</p>}
              {generating && !generated && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                  Generating assignment with AI…
                </p>
              )}
              {generated && (
                <div className="space-y-3 rounded-lg border border-border p-3">
                  <div>
                    <p className="text-sm font-semibold">{generated.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{generated.prompt}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Questions ({generated.questions.length})</p>
                    <ol className="mt-2 space-y-2">
                      {generated.questions.map((q: any, i: number) => (
                        <li key={q.id} className="rounded-lg bg-muted/40 p-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-accent">{i + 1}.</span>
                            <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
                              {(q.type ?? 'essay').replace('_', ' ')}
                            </span>
                            {q.required && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">Required</span>}
                          </div>
                          <p className="mt-1 text-sm">{q.prompt}</p>
                          {(q.type === 'single_choice' || q.type === 'multiple_choice') && q.options?.filter(Boolean).length > 0 && (
                            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                              {q.options.filter(Boolean).map((o: string, oi: number) => (<li key={oi}>{o}</li>))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Rubric · {generated.rubric.reduce((s: number, c: any) => s + (Number(c.points) || 0), 0)} pts
                    </p>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs">
                      {generated.rubric.map((c: any) => (
                        <span key={c.id} className="rounded-lg border border-border px-2 py-1">
                          <span className="font-medium">{c.label}</span> · {c.points}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setGenerated(null)}>Discard</Button>
                    <Button type="button" size="sm" onClick={useGenerated}>Use these</Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {assignment ? (
            <div className="space-y-3">
              <Input value={assignment.title} onChange={(e) => setAssignment({ ...assignment, title: e.target.value })} placeholder="Assignment title" />
              <Textarea value={assignment.prompt} onChange={(e) => setAssignment({ ...assignment, prompt: e.target.value })} className="min-h-[90px]" placeholder="What should the candidate solve or submit?" />
              <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={assignment.dueBeforeInterview} onChange={(e) => setAssignment({ ...assignment, dueBeforeInterview: e.target.checked })} className="h-4 w-4 accent-primary" /> Candidate must submit before interview review</label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Allowed attempts (tries):</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={assignment.maxAttempts}
                  onChange={(e) => setAssignment({ ...assignment, maxAttempts: Math.max(1, Math.min(50, Number(e.target.value) || 10)) })}
                  className="w-20 rounded-md border border-border bg-background px-2 py-1 text-foreground"
                />
                <span className="text-muted-foreground/70">default 10</span>
              </label>
              <div className="space-y-2">
                <p className="text-sm font-medium">Rubric</p>
                {assignment.rubric.map((criterion, i) => (
                  <div key={criterion.id} className="flex gap-2">
                    <Input value={criterion.label} onChange={(e) => setAssignment({ ...assignment, rubric: assignment.rubric.map((r, idx) => idx === i ? { ...r, label: e.target.value } : r) })} placeholder="What are you scoring?" />
                    <Input type="number" min="0" className="w-24" value={criterion.points} onChange={(e) => setAssignment({ ...assignment, rubric: assignment.rubric.map((r, idx) => idx === i ? { ...r, points: Number(e.target.value) } : r) })} aria-label={`Points for criterion ${i + 1}`} />
                    <Button type="button" variant="ghost" size="icon" onClick={() => setAssignment({ ...assignment, rubric: assignment.rubric.filter((_, idx) => idx !== i) })} aria-label="Remove rubric criterion"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => setAssignment({ ...assignment, rubric: [...assignment.rubric, { id: `criterion-${assignment.rubric.length + 1}`, label: '', points: 10 }] })}>Add criterion</Button>
              </div>
              <div className="space-y-3 border-t border-border pt-3">
                <p className="text-sm font-medium">Questions</p>
                {assignment.questions.map((question, i) => (
                  <div key={question.id} className="space-y-2 rounded-lg border border-border p-3">
                    <div className="flex gap-2">
                      <Select value={question.type} onChange={(e) => setAssignment({ ...assignment, questions: assignment.questions.map((q, idx) => idx === i ? { ...q, type: e.target.value as AiAssignmentQuestion['type'], options: ['single_choice', 'multiple_choice'].includes(e.target.value) ? q.options ?? ['', ''] : undefined } : q) })}>
                        <option value="essay">Essay</option>
                        <option value="single_choice">Single choice</option>
                        <option value="multiple_choice">Multiple choice</option>
                        <option value="true_false">True / False</option>
                      </Select>
                      <Button type="button" variant="ghost" size="icon" onClick={() => setAssignment({ ...assignment, questions: assignment.questions.filter((_, idx) => idx !== i) })} aria-label="Remove question"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                    <Input value={question.prompt} onChange={(e) => setAssignment({ ...assignment, questions: assignment.questions.map((q, idx) => idx === i ? { ...q, prompt: e.target.value } : q) })} placeholder={`Question ${i + 1}`} />
                    <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={question.required} onChange={(e) => setAssignment({ ...assignment, questions: assignment.questions.map((q, idx) => idx === i ? { ...q, required: e.target.checked } : q) })} className="h-4 w-4 accent-primary" /> Required</label>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs text-muted-foreground">Min words</span>
                      <Input type="number" min="0" className="w-24" value={question.minWords ?? ''} placeholder="—" onChange={(e) => setAssignment({ ...assignment, questions: assignment.questions.map((q, idx) => idx === i ? { ...q, minWords: e.target.value ? Number(e.target.value) : null } : q) })} aria-label={`Min words for question ${i + 1}`} />
                      <span className="text-xs text-muted-foreground">Max words</span>
                      <Input type="number" min="0" className="w-24" value={question.maxWords ?? ''} placeholder="—" onChange={(e) => setAssignment({ ...assignment, questions: assignment.questions.map((q, idx) => idx === i ? { ...q, maxWords: e.target.value ? Number(e.target.value) : null } : q) })} aria-label={`Max words for question ${i + 1}`} />
                    </div>
                    {(question.type === 'single_choice' || question.type === 'multiple_choice') && (
                      <div className="space-y-2">
                        {(question.options ?? ['', '']).map((option, optionIndex) => (
                          <Input key={optionIndex} value={option} onChange={(e) => setAssignment({ ...assignment, questions: assignment.questions.map((q, idx) => idx === i ? { ...q, options: (q.options ?? []).map((o, oi) => oi === optionIndex ? e.target.value : o) } : q) })} placeholder={`Choice ${optionIndex + 1}`} />
                        ))}
                        <Button type="button" variant="outline" size="sm" onClick={() => setAssignment({ ...assignment, questions: assignment.questions.map((q, idx) => idx === i ? { ...q, options: [...(q.options ?? []), ''] } : q) })}>Add choice</Button>
                      </div>
                    )}
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => setAssignment({ ...assignment, questions: [...assignment.questions, { id: `question-${assignment.questions.length + 1}`, type: 'essay', prompt: '', required: true }] })}>Add question</Button>
              </div>
              {editing && (
                <Button type="button" variant="ghost" className="text-danger" onClick={removeAssignment} disabled={saving}>Remove assignment</Button>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-6 text-center">
              <p className="text-sm text-muted-foreground">No assignment yet. Use <span className="font-medium">Draft template</span> or <span className="font-medium">Generate with AI</span> above to add a practical task for candidates.</p>
            </div>
          )}
        </section>
      )}

      {active === 'submission' && (
        <section className="space-y-4">
          {error && (<p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>)}
          <div className="rounded-xl border border-border p-4">
            <p className="text-sm font-medium">Review your listing</p>
            <p className="mt-1 text-xs text-muted-foreground">Check everything below, then preview it exactly as students will see it (including the assignment) before you post.</p>
            <Button variant="outline" type="button" onClick={() => setPreview(true)} className="mt-3 gap-1.5"><Eye className="h-4 w-4" /> Preview listing</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <ReviewRow label="Title" value={f.title} />
            <ReviewRow label="Type" value={`${f.type} · ${f.listing_type}`} />
            <ReviewRow label="Location" value={f.location || (f.country === 'Remote' ? 'Remote (Global)' : f.country)} />
            <ReviewRow label="Pay / Duration" value={[f.pay, f.duration].filter(Boolean).join(' · ') || '—'} />
            <ReviewRow label="Deadline" value={f.deadline || '—'} />
            <ReviewRow label="Apply mode" value={f.applyMode === 'external' ? 'External URL' : 'In-app form'} />
            <ReviewRow label="Tags" value={f.tags || '—'} />
            <ReviewRow label="Restrict years" value={f.allowed_years.length ? f.allowed_years.map((y) => `Year ${y}`).join(', ') : 'All'} />
            <ReviewRow label="Schools" value={f.allowed_schools || 'All'} />
            {isSchool && <ReviewRow label="Audience" value={f.students_only ? 'Only my students' : (f.fromOther ? `Forwarded: ${f.original_company_name || '—'}` : 'School posting')} />}
            {assignmentAllowed && <ReviewRow label="Assignment" value={assignment?.prompt.trim() ? `${assignment.questions.length} question(s) · ${assignment.rubric.length} rubric` : 'None'} />}
          </div>
        </section>
      )}

      <div className="flex items-center gap-2 border-t border-border pt-4">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <div className="ml-auto flex gap-2">
          {active !== 'details' && (<Button variant="outline" type="button" onClick={() => { if (prevId) setActive(prevId) }}>Back</Button>)}
          {active === 'submission' ? (
            <Button onClick={submit} loading={saving}>{editing ? 'Save changes' : 'Post listing'}</Button>
          ) : (
            <Button type="button" onClick={() => { if (nextId) setActive(nextId) }} className="gap-1.5">Next <ArrowRight className="h-4 w-4" /></Button>
          )}
        </div>
      </div>

      <PostingPreview open={preview} onClose={() => setPreview(false)} f={f} assignment={assignment} isSchool={isSchool} user={user} />

      <Modal open={assignmentPreview} onClose={() => setAssignmentPreview(false)} size="xl" title="Preview — candidate assignment">
        {assignment?.prompt.trim() ? (
          <AssignmentView assignment={{ title: assignment.title.trim() || 'Practical challenge', prompt: assignment.prompt.trim(), due_before_interview: assignment.dueBeforeInterview, max_attempts: assignment.maxAttempts ?? 10, rubric: assignment.rubric, questions: assignment.questions }} />
        ) : (
          <p className="text-sm text-muted-foreground">Add an assignment first to preview it.</p>
        )}
      </Modal>
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

/** Repeatable list of text inputs with add/remove — avoids free-text formatting errors. */
function ListField({
  label,
  hint,
  items,
  onChange,
  placeholder,
  addLabel,
}: {
  label: string
  hint?: string
  items: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  addLabel: string
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={item}
              onChange={(e) => onChange(items.map((x, idx) => (idx === i ? e.target.value : x)))}
              placeholder={placeholder}
            />
            <button
              type="button"
              onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              className="shrink-0 rounded-lg border border-border p-2.5 text-muted-foreground hover:border-danger/40 hover:text-danger"
              aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...items, ''])}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary"
        >
          <Plus className="h-4 w-4" /> {addLabel}
        </button>
      </div>
      {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** Live preview of the posting exactly as students will see it (rendered in a modal). */
function PostingPreview({ open, onClose, f, assignment, user, isSchool }: { open: boolean; onClose: () => void; f: any; assignment: AssignmentDraft | null; user: any; isSchool: boolean }) {
  const assignmentAllowed = f.applyMode === 'in_app' && !f.fromOther
  const job: JobListing = {
    id: 'preview', company_id: user.id,
    title: f.title || 'Untitled role', description: f.description || '',
    type: f.type, listing_type: f.listing_type,
    location: f.location || (f.country === 'Remote' ? 'Remote (Global)' : f.country),
    country: f.country, remote: f.country === 'Remote' || /remote/i.test(f.location),
    pay: f.pay || undefined, duration: f.duration || undefined,
    deadline: f.deadline ? new Date(f.deadline).toISOString() : undefined,
    tags: f.tags.split(',').map((t: string) => t.trim()).filter(Boolean),
    responsibilities: f.responsibilities.map((t: string) => t.trim()).filter(Boolean),
    benefits: f.benefits.map((t: string) => t.trim()).filter(Boolean),
    qualifications: f.qualifications.map((t: string) => t.trim()).filter(Boolean),
    status: 'active',
    apply_url: f.applyMode === 'external' ? f.apply_url : null,
    allowed_years: f.allowed_years,
    allowed_schools: f.allowed_schools.split(',').map((s: string) => s.trim()).filter(Boolean),
    posted_by_role: isSchool ? 'school' : 'company',
    original_company_name: isSchool && f.fromOther ? f.original_company_name : undefined,
    original_company_logo_url: isSchool && f.fromOther ? f.original_company_logo_url : undefined,
    assignment: assignmentAllowed && assignment && assignment.prompt.trim() ? { title: assignment.title.trim() || 'Practical challenge', prompt: assignment.prompt.trim(), due_before_interview: assignment.dueBeforeInterview, max_attempts: assignment.maxAttempts ?? 10, rubric: assignment.rubric, questions: assignment.questions } as AiAssignment : undefined,
    created_at: new Date().toISOString(),
  }
  return (
    <Modal open={open} onClose={onClose} size="xl" title="Preview — how students will see it">
      <JobPostingView job={job} brand={job.original_company_name || user.company_name || user.full_name} logo={job.original_company_logo_url || user.avatar_url} />
    </Modal>
  )
}
