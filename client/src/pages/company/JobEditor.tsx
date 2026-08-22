import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { ArrowLeft, Building2, ClipboardCheck, Eye, ImagePlus, Lock, Plus, Sparkles, Trash2 } from 'lucide-react'
import { imageFileToDataUrl, fileToDataUrl, cn } from '@/lib/utils'
import { useCurrentUser } from '@/lib/store'
import { jobsApi, aiApi } from '@/lib/api'
import { COUNTRIES } from '@/lib/geo'
import { JobPostingView } from '@/components/JobPostingView'
import type { AiAssignment, AiAssignmentQuestion, AiRubricCriterion, JobListing, ListingType } from '@/types'
import { Avatar, Input, Label, Textarea, Select, Skeleton } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/toast'

const CATEGORIES = ['Software Engineering', 'Data', 'Design', 'Marketing', 'Operations', 'Finance', 'Product']
const LISTING_TYPES: ListingType[] = ['Internship', 'Full-time', 'Part-time', 'Fellowship']
const LIVE_COUNTRIES = COUNTRIES.filter((c) => !c.disabled && c.code !== 'all').map((c) => c.name)

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
      <JobEditorForm editing={job} onSaved={goBack} onCancel={goBack} />
    </div>
  )
}

function JobEditorForm({ editing, onSaved, onCancel }: { editing: JobListing | null; onSaved: () => void; onCancel: () => void }) {
  const user = useCurrentUser()!
  const { toast } = useToast()
  const isSchool = user.user_type === 'school'
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
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
    country: 'Remote', location: '', pay: '', duration: '', deadline: '', tags: '',
    responsibilities: [] as string[], benefits: [] as string[], qualifications: [] as string[],
    applyMode: 'in_app' as 'in_app' | 'external', apply_url: '', allowed_years: [] as number[],
    allowed_schools: '', students_only: false,
    fromOther: false, original_company_name: '', original_company_logo_url: '',
    assignmentEnabled: false, assignmentTitle: '', assignmentPrompt: '', dueBeforeInterview: true,
    rubric: [] as AiRubricCriterion[],
    questions: [] as AiAssignmentQuestion[],
  })

  useEffect(() => {
    setError(null)
    setPreview(false)
    if (editing) {
      setF({
        title: editing.title, description: editing.description, type: editing.type, listing_type: editing.listing_type,
        country: editing.country, location: editing.location, pay: editing.pay ?? '', duration: editing.duration ?? '',
        deadline: editing.deadline ? editing.deadline.slice(0, 10) : '', tags: editing.tags.join(', '),
        responsibilities: editing.responsibilities ?? [], benefits: editing.benefits ?? [], qualifications: editing.qualifications ?? [],
        applyMode: editing.apply_url ? 'external' : 'in_app', apply_url: editing.apply_url ?? '', allowed_years: editing.allowed_years,
        allowed_schools: (editing.allowed_schools ?? []).join(', '), students_only: editing.students_only ?? false,
        fromOther: !!editing.original_company_name, original_company_name: editing.original_company_name ?? '', original_company_logo_url: editing.original_company_logo_url ?? '',
        assignmentEnabled: !!editing.assignment, assignmentTitle: editing.assignment?.title ?? '', assignmentPrompt: editing.assignment?.prompt ?? '',
        dueBeforeInterview: editing.assignment?.due_before_interview ?? true, rubric: editing.assignment?.rubric ?? [],
        questions: editing.assignment?.questions ?? [],
      })
    } else {
      setF((p) => ({ ...p, title: '', description: '', pay: '', duration: '', deadline: '', tags: '', responsibilities: [], benefits: [], qualifications: [], apply_url: '', allowed_years: [], allowed_schools: '', students_only: false, fromOther: false, original_company_name: '', assignmentEnabled: false, assignmentTitle: '', assignmentPrompt: '', dueBeforeInterview: true, rubric: [], questions: [] }))
    }
  }, [editing])

  function toggleYear(y: number) {
    setF((p) => ({ ...p, allowed_years: p.allowed_years.includes(y) ? p.allowed_years.filter((x) => x !== y) : [...p.allowed_years, y] }))
  }

  function draftAssignment() {
    setF((p) => ({
      ...p,
      assignmentEnabled: true,
      assignmentTitle: p.assignmentTitle || `${p.title || 'Role'} practical challenge`,
      assignmentPrompt: p.assignmentPrompt || `Show us how you would approach a realistic problem for this ${p.type || 'role'}. Share your assumptions, decisions, and what you would measure.`,
      rubric: p.rubric.length ? p.rubric : [
        { id: 'clarity', label: 'Problem framing and clarity', points: 30 },
        { id: 'approach', label: 'Technical or strategic approach', points: 40 },
        { id: 'communication', label: 'Communication and trade-offs', points: 30 },
      ],
      questions: p.questions.length ? p.questions : [{ id: 'question-1', type: 'essay', prompt: '', required: true }],
    }))
  }

  // ---- AI assignment studio: upload a brief, ask AI to design the questions ----
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
      else if (f.assignmentEnabled) payload.existing = { questions: f.questions, rubric: f.rubric }
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
    setF((p) => ({
      ...p,
      assignmentEnabled: true,
      assignmentTitle: generated.title || p.assignmentTitle,
      assignmentPrompt: generated.prompt || p.assignmentPrompt,
      questions: generated.questions,
      rubric: generated.rubric,
    }))
    toast({ title: 'Assignment updated with AI suggestions', tone: 'success' })
  }

  async function submit() {
    if (!f.title.trim() || !f.description.trim()) { setError('Title and description are required.'); return }
    if (f.applyMode === 'external' && !f.apply_url) { setError('External apply needs a URL.'); return }
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
      assignment: f.assignmentEnabled && f.assignmentPrompt.trim() ? {
        title: f.assignmentTitle.trim() || 'Practical challenge', prompt: f.assignmentPrompt.trim(),
        due_before_interview: f.dueBeforeInterview,
        rubric: f.rubric.filter((r) => r.label.trim()).map((r) => ({ ...r, label: r.label.trim(), points: Number(r.points) || 0 })),
        questions: f.questions.filter((q) => q.prompt.trim()).map((q) => ({ ...q, prompt: q.prompt.trim(), options: q.options?.filter(Boolean) })),
      } as AiAssignment : null,
    }
    try {
      if (editing) await jobsApi.update(editing.id, payload)
      else await jobsApi.create(payload)
      setError(null)
      toast({ title: editing ? 'Listing updated' : 'Listing posted 🎉', tone: 'success' })
      onSaved()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.'
      setError(msg === 'unauthorized' ? 'Your session expired — please sign in again.' : `Could not save the listing: ${msg}`)
      toast({ title: 'Could not save listing', description: msg, tone: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div><Label>Title</Label><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Frontend Engineer Intern" /></div>
      <div><Label>Description</Label><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="min-h-[100px]" placeholder="What the role involves…" /></div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div><Label>Category</Label><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></div>
        <div><Label>Type</Label><Select value={f.listing_type} onChange={(e) => setF({ ...f, listing_type: e.target.value as ListingType })}>{LISTING_TYPES.map((c) => <option key={c}>{c}</option>)}</Select></div>
        <div><Label>Country</Label><Select value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>{LIVE_COUNTRIES.map((c) => <option key={c}>{c}</option>)}</Select></div>
        <div><Label>Location (display)</Label><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="London, UK · Hybrid" /></div>
        <div><Label>Pay / Stipend</Label><Input value={f.pay} onChange={(e) => setF({ ...f, pay: e.target.value })} placeholder="$2,000 / month" /></div>
        <div><Label>Duration</Label><Input value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value })} placeholder="6 months" /></div>
        <div><Label>Deadline</Label><Input type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></div>
        <div><Label>Tags (comma-separated)</Label><Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="React, TypeScript, Git" /></div>
      </div>

      <div className="rounded-xl border border-accent/30 bg-accent/5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 font-semibold"><ClipboardCheck className="h-4 w-4 text-accent" /> AI candidate assignment</p>
            <p className="mt-1 text-xs text-muted-foreground">Give applicants a consistent practical task before you decide who to interview.</p>
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={draftAssignment}><Sparkles className="h-4 w-4 text-accent" /> Draft template</Button>
            <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => setStudioOpen((v) => !v)}><Sparkles className="h-4 w-4 text-accent" /> {studioOpen ? 'Hide AI studio' : 'Generate with AI'}</Button>
          </div>
        </div>

        {studioOpen && (
          <div className="mt-3 space-y-3 rounded-xl border border-accent/30 bg-background p-3">
            <p className="text-xs text-muted-foreground">Upload a brief (PDF, Word, image, or text) and/or describe what you want. AI designs the questions and rubric; video submissions are reviewed by a human.</p>
            <div className="flex flex-wrap items-center gap-2">
              <input ref={studioFileRef} type="file" accept=".pdf,.doc,.docx,.txt,image/*,text/*" className="hidden" onChange={(e) => onStudioFile(e.target.files?.[0])} />
              <Button type="button" size="sm" variant="outline" onClick={() => studioFileRef.current?.click()}>
                <ImagePlus className="h-4 w-4" /> {studioFile ? `Change (${studioFile.name})` : 'Upload document'}
              </Button>
              {studioFile && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setStudioFile(null)}>Remove</Button>
              )}
            </div>
            <Textarea value={studioInstruction} onChange={(e) => setStudioInstruction(e.target.value)} className="min-h-[70px]" placeholder="Optional instruction — e.g. 'Make it a take-home coding task', 'Focus on system design', 'Harder, for senior candidates'." />
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => runGeneration(false)} loading={generating}>
                <Sparkles className="h-4 w-4" /> {generated ? 'Regenerate' : 'Generate questions'}
              </Button>
              {generated && (
                <Button type="button" size="sm" variant="outline" onClick={() => runGeneration(true)} loading={generating}>
                  Refine with instruction
                </Button>
              )}
            </div>

            {genError && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{genError}</p>}

            {generated && (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-semibold">{generated.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{generated.prompt}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Questions</p>
                  <ul className="mt-1 space-y-1 text-sm">
                    {generated.questions.map((q: any, i: number) => (
                      <li key={q.id} className="flex items-start gap-2">
                        <span className="mt-0.5 rounded bg-accent/10 px-1.5 text-[10px] font-medium uppercase text-accent">{q.type.replace('_', ' ')}</span>
                        <span>{q.prompt}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rubric</p>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs">
                    {generated.rubric.map((c: any) => (
                      <span key={c.id} className="rounded-lg border border-border px-2 py-1">{c.label} · {c.points}</span>
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
        <label className="mt-3 flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={f.assignmentEnabled} onChange={(e) => setF({ ...f, assignmentEnabled: e.target.checked })} className="h-4 w-4 accent-primary" /> Require this before interview</label>
        {f.assignmentEnabled && <div className="mt-3 space-y-3">
          <Input value={f.assignmentTitle} onChange={(e) => setF({ ...f, assignmentTitle: e.target.value })} placeholder="Assignment title" />
          <Textarea value={f.assignmentPrompt} onChange={(e) => setF({ ...f, assignmentPrompt: e.target.value })} className="min-h-[90px]" placeholder="What should the candidate solve or submit?" />
          <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={f.dueBeforeInterview} onChange={(e) => setF({ ...f, dueBeforeInterview: e.target.checked })} className="h-4 w-4 accent-primary" /> Candidate must submit before interview review</label>
          <div className="space-y-2">
            <p className="text-sm font-medium">Rubric</p>
            {f.rubric.map((criterion, i) => <div key={criterion.id} className="flex gap-2"><Input value={criterion.label} onChange={(e) => setF({ ...f, rubric: f.rubric.map((r, idx) => idx === i ? { ...r, label: e.target.value } : r) })} placeholder="What are you scoring?" /><Input type="number" min="0" className="w-24" value={criterion.points} onChange={(e) => setF({ ...f, rubric: f.rubric.map((r, idx) => idx === i ? { ...r, points: Number(e.target.value) } : r) })} aria-label={`Points for criterion ${i + 1}`} /><Button type="button" variant="ghost" size="icon" onClick={() => setF({ ...f, rubric: f.rubric.filter((_, idx) => idx !== i) })} aria-label="Remove rubric criterion"><Trash2 className="h-4 w-4" /></Button></div>)}
            <Button type="button" variant="outline" size="sm" onClick={() => setF({ ...f, rubric: [...f.rubric, { id: `criterion-${f.rubric.length + 1}`, label: '', points: 10 }] })}>Add criterion</Button>
          </div>
          <div className="space-y-3 border-t border-border pt-3">
            <p className="text-sm font-medium">Questions</p>
            {f.questions.map((question, i) => <div key={question.id} className="space-y-2 rounded-lg border border-border p-3"><div className="flex gap-2"><Select value={question.type} onChange={(e) => setF({ ...f, questions: f.questions.map((q, idx) => idx === i ? { ...q, type: e.target.value as AiAssignmentQuestion['type'], options: ['single_choice', 'multiple_choice'].includes(e.target.value) ? q.options ?? ['', ''] : undefined } : q) })}><option value="essay">Essay</option><option value="single_choice">Single choice</option><option value="multiple_choice">Multiple choice</option><option value="true_false">True / False</option><option value="file">File upload</option><option value="video">Video upload</option></Select><Button type="button" variant="ghost" size="icon" onClick={() => setF({ ...f, questions: f.questions.filter((_, idx) => idx !== i) })} aria-label="Remove question"><Trash2 className="h-4 w-4" /></Button></div><Input value={question.prompt} onChange={(e) => setF({ ...f, questions: f.questions.map((q, idx) => idx === i ? { ...q, prompt: e.target.value } : q) })} placeholder={`Question ${i + 1}`} /><label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={question.required} onChange={(e) => setF({ ...f, questions: f.questions.map((q, idx) => idx === i ? { ...q, required: e.target.checked } : q) })} className="h-4 w-4 accent-primary" /> Required</label>{(question.type === 'single_choice' || question.type === 'multiple_choice') && <div className="space-y-2">{(question.options ?? ['', '']).map((option, optionIndex) => <Input key={optionIndex} value={option} onChange={(e) => setF({ ...f, questions: f.questions.map((q, idx) => idx === i ? { ...q, options: (q.options ?? []).map((o, oi) => oi === optionIndex ? e.target.value : o) } : q) })} placeholder={`Choice ${optionIndex + 1}`} />)}<Button type="button" variant="outline" size="sm" onClick={() => setF({ ...f, questions: f.questions.map((q, idx) => idx === i ? { ...q, options: [...(q.options ?? []), ''] } : q) })}>Add choice</Button></div>}</div>)}
            <Button type="button" variant="outline" size="sm" onClick={() => setF({ ...f, questions: [...f.questions, { id: `question-${f.questions.length + 1}`, type: 'essay', prompt: '', required: true }] })}>Add question</Button>
          </div>
        </div>}
      </div>

      {/* Rich posting content — add items one by one; leave empty to auto-generate */}
      <ListField
        label="Responsibilities"
        hint="Add each responsibility as its own line. Leave empty to auto-generate from the category & tags."
        items={f.responsibilities}
        onChange={(responsibilities) => setF({ ...f, responsibilities })}
        placeholder="e.g. Support financial modeling and reporting"
        addLabel="Add responsibility"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <ListField
          label="Benefits"
          items={f.benefits}
          onChange={(benefits) => setF({ ...f, benefits })}
          placeholder="e.g. Mentorship from senior team"
          addLabel="Add benefit"
        />
        <ListField
          label="Qualifications"
          items={f.qualifications}
          onChange={(qualifications) => setF({ ...f, qualifications })}
          placeholder="e.g. Familiarity with Excel"
          addLabel="Add qualification"
        />
      </div>

      {/* Apply mode */}
      <div>
        <Label>Apply mode</Label>
        <div className="flex gap-2">
          {(['in_app', 'external'] as const).map((m) => (
            <button key={m} onClick={() => setF({ ...f, applyMode: m })} className={cn('flex-1 rounded-lg border px-3 py-2 text-sm font-medium', f.applyMode === m ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}>
              {m === 'in_app' ? 'In-app form' : 'External URL'}
            </button>
          ))}
        </div>
        {f.applyMode === 'external' && <Input className="mt-2" value={f.apply_url} onChange={(e) => setF({ ...f, apply_url: e.target.value })} placeholder="https://company.com/apply" />}
      </div>

      {/* Allowed years */}
      <div>
        <Label>Restrict to years (optional)</Label>
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((y) => (
            <button key={y} onClick={() => toggleYear(y)} className={cn('rounded-lg border px-3 py-1.5 text-sm', f.allowed_years.includes(y) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}>Year {y}</button>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Leave empty to show to all years.</p>
      </div>

      {/* Restrict to schools */}
      <div>
        <Label>Restrict to schools / universities (optional)</Label>
        <Input value={f.allowed_schools} onChange={(e) => setF({ ...f, allowed_schools: e.target.value })} placeholder="e.g. University of Cape Town, National University of Singapore" />
        <p className="mt-1 text-xs text-muted-foreground">Comma-separated. Only students from these schools will see this opportunity. Leave empty for everyone.</p>
      </div>

      {/* Restrict to my students (schools only, by email domain) */}
      {isSchool && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={f.students_only} onChange={(e) => setF({ ...f, students_only: e.target.checked })} className="h-4 w-4 accent-primary" />
            <Lock className="h-4 w-4 text-primary" /> Only my students can see this
          </label>
          <p className="mt-1 pl-6 text-xs text-muted-foreground">
            Restricts this listing to people whose login email matches one of your school’s student domains (set on your profile). Others won’t see it anywhere.
          </p>
        </div>
      )}

      {/* School forwarding */}
      {isSchool && (
        <div className="rounded-xl border border-accent/30 bg-accent/5 p-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={f.fromOther} onChange={(e) => setF({ ...f, fromOther: e.target.checked })} className="h-4 w-4 accent-[hsl(var(--accent))]" />
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
                    <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => logoRef.current?.click()}>
                      <ImagePlus className="h-4 w-4" /> {f.original_company_logo_url ? 'Change' : 'Upload'}
                    </Button>
                    {f.original_company_logo_url && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setF({ ...f, original_company_logo_url: '' })}>Remove</Button>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">PNG, JPG, or any image from your device.</p>
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button variant="outline" type="button" onClick={() => setPreview(true)} className="gap-1.5"><Eye className="h-4 w-4" /> Preview</Button>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={submit} loading={saving}>{editing ? 'Save changes' : 'Post listing'}</Button>
        </div>
      </div>

      <PostingPreview open={preview} onClose={() => setPreview(false)} f={f} user={user} isSchool={isSchool} />
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

/** Live preview of the posting (from the create/edit form) exactly as students will see it. */
function PostingPreview({ open, onClose, f, user, isSchool }: { open: boolean; onClose: () => void; f: any; user: any; isSchool: boolean }) {
  if (!open) return null
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
    assignment: f.assignmentEnabled ? { title: f.assignmentTitle || 'Practical challenge', prompt: f.assignmentPrompt, due_before_interview: f.dueBeforeInterview, rubric: f.rubric, questions: f.questions } : undefined,
    created_at: new Date().toISOString(),
  }
  return (
    <Modal open={open} onClose={onClose} size="xl" title="Preview — how students will see it">
      <JobPostingView job={job} brand={job.original_company_name || user.company_name || user.full_name} logo={job.original_company_logo_url || user.avatar_url} />
    </Modal>
  )
}
