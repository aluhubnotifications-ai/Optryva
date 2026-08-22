import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ClipboardCheck, Eye, ImagePlus, Plus, Sparkles, Trash2 } from 'lucide-react'
import { fileToDataUrl } from '@/lib/utils'
import { useCurrentUser } from '@/lib/store'
import { jobsApi, aiApi } from '@/lib/api'
import { JobPostingView } from '@/components/JobPostingView'
import type { AiAssignment, AiAssignmentQuestion, AiRubricCriterion, JobListing } from '@/types'
import { Input, Label, Textarea, Select, Skeleton } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/toast'


export default function AssignmentEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [job, setJob] = useState<JobListing | null | undefined>(undefined)

  useEffect(() => {
    if (id) {
      jobsApi.get(id).then((j) => setJob(j ?? null)).catch(() => setJob(null))
      return
    }
    setJob(null)
  }, [id])

  const goBack = () => navigate('/app/listings')

  if (job === undefined) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-10">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (!job) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-10 text-center">
        <h1 className="text-xl font-semibold">Listing not found</h1>
        <Button onClick={goBack} className="mt-4 gap-1.5"><ArrowLeft className="h-4 w-4" /> Back to listings</Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <button onClick={goBack} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" /> Back to listings
      </button>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{job.title}</h1>
          <p className="text-sm text-muted-foreground">Edit assignment for this listing</p>
        </div>
        <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">{job.status}</span>
      </div>
      <AssignmentForm job={job} onSaved={goBack} onCancel={goBack} onRemove={goBack} />
    </div>
  )
}

function AssignmentForm({ job, onSaved, onCancel, onRemove }: { job: JobListing; onSaved: () => void; onCancel: () => void; onRemove: () => void }) {
  const user = useCurrentUser()!
  const { toast } = useToast()
  const isSchool = user.user_type === 'school'
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)

  const [f, setF] = useState({
    title: '',
    prompt: '',
    dueBeforeInterview: true,
    rubric: [] as AiRubricCriterion[],
    questions: [] as AiAssignmentQuestion[],
  })

  useEffect(() => {
    setError(null)
    setPreview(false)
    if (job.assignment) {
      setF({
        title: job.assignment.title,
        prompt: job.assignment.prompt,
        dueBeforeInterview: job.assignment.due_before_interview ?? true,
        rubric: job.assignment.rubric ?? [],
        questions: job.assignment.questions ?? [],
      })
    } else {
      setF((p) => ({ ...p, title: '', prompt: '', dueBeforeInterview: true, rubric: [], questions: [] }))
    }
  }, [job.assignment])

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
        job: { title: job.title, description: job.description, type: job.type, tags: job.tags },
        instruction: studioInstruction,
        sources: studioFile ? [studioFile] : [],
      }
      if (refine && generated) payload.existing = { questions: generated.questions, rubric: generated.rubric }
      else if (f.prompt) payload.existing = { questions: f.questions, rubric: f.rubric }
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
      title: generated.title || p.title,
      prompt: generated.prompt || p.prompt,
      questions: generated.questions,
      rubric: generated.rubric,
    }))
    toast({ title: 'Assignment updated with AI suggestions', tone: 'success' })
  }

  function draftAssignment() {
    setF((p) => ({
      ...p,
      title: p.title || `${job.title || 'Role'} practical challenge`,
      prompt: p.prompt || `Show us how you would approach a realistic problem for this ${job.type || 'role'}. Share your assumptions, decisions, and what you would measure.`,
      rubric: p.rubric.length ? p.rubric : [
        { id: 'clarity', label: 'Problem framing and clarity', points: 30 },
        { id: 'approach', label: 'Technical or strategic approach', points: 40 },
        { id: 'communication', label: 'Communication and trade-offs', points: 30 },
      ],
      questions: p.questions.length ? p.questions : [{ id: 'question-1', type: 'essay', prompt: '', required: true }],
    }))
  }

  async function removeAssignment() {
    setSaving(true)
    try {
      await jobsApi.update(job.id, { assignment: null })
      toast({ title: 'Assignment removed', tone: 'info' })
      onRemove()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not remove.'
      setError(msg === 'unauthorized' ? 'Your session expired — please sign in again.' : `Could not remove: ${msg}`)
      toast({ title: 'Could not remove assignment', description: msg, tone: 'error' })
    } finally {
      setSaving(false)
    }
  }

  async function submit() {
    if (!f.prompt.trim()) { setError('The prompt is required to save the assignment.'); return }
    setError(null)
    setSaving(true)
    const assignment = {
      title: f.title.trim() || 'Practical challenge',
      prompt: f.prompt.trim(),
      due_before_interview: f.dueBeforeInterview,
      rubric: f.rubric.filter((r) => r.label.trim()).map((r) => ({ ...r, label: r.label.trim(), points: Number(r.points) || 0 })),
      questions: f.questions.filter((q) => q.prompt.trim()).map((q) => ({ ...q, prompt: q.prompt.trim(), options: q.options?.filter(Boolean) })),
    } as AiAssignment
    try {
      await jobsApi.update(job.id, { assignment })
      toast({ title: 'Assignment saved', tone: 'success' })
      onSaved()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.'
      setError(msg === 'unauthorized' ? 'Your session expired — please sign in again.' : `Could not save: ${msg}`)
      toast({ title: 'Could not save assignment', description: msg, tone: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 border-b border-border pb-4">
        <ClipboardCheck className="h-5 w-5 text-accent" />
        <h2 className="text-xl font-semibold">Candidate assignment</h2>
      </div>

      <div className="rounded-xl border border-accent/30 bg-accent/5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 font-semibold"><ClipboardCheck className="h-4 w-4 text-accent" /> AI candidate assignment</p>
            <p className="mt-1 text-xs text-muted-foreground">Upload a brief (PDF, Word, image, or text) and/or describe what you want. AI designs the questions and rubric; video submissions are reviewed by a human.</p>
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
        <div className="mt-3 space-y-3">
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Assignment title" />
          <Textarea value={f.prompt} onChange={(e) => setF({ ...f, prompt: e.target.value })} className="min-h-[90px]" placeholder="What should the candidate solve or submit?" />
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
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button variant="outline" type="button" onClick={() => setPreview(true)} className="gap-1.5"><Eye className="h-4 w-4" /> Preview</Button>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          {job.assignment && (
            <Button variant="ghost" className="text-danger" onClick={removeAssignment} disabled={saving}>Remove assignment</Button>
          )}
          <Button onClick={submit} loading={saving}>Save assignment</Button>
        </div>
      </div>

      <PostingPreview open={preview} onClose={() => setPreview(false)} f={f} user={user} isSchool={isSchool} job={job} />
    </div>
  )
}

/** Live preview of the posting (from the assignment form) exactly as students will see it. */
function PostingPreview({ open, onClose, f, user, isSchool, job }: { open: boolean; onClose: () => void; f: any; user: any; isSchool: boolean; job: JobListing }) {
  if (!open) return null
  const previewJob: JobListing = {
    ...job,
    id: 'preview',
    company_id: user.id,
    title: f.title || 'Untitled role',
    description: job.description || '',
    assignment: { title: f.title || 'Practical challenge', prompt: f.prompt, due_before_interview: f.dueBeforeInterview, rubric: f.rubric, questions: f.questions },
    created_at: new Date().toISOString(),
  }
  return (
    <Modal open={open} onClose={onClose} size="xl" title="Preview — how students will see it">
      <JobPostingView job={previewJob} brand={job.original_company_name || user.company_name || user.full_name} logo={job.original_company_logo_url || user.avatar_url} />
    </Modal>
  )
}