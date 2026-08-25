import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Eye, FileText, Maximize2, Minimize2, Pause, Play, Plus, Save, Trash2, Upload, X } from 'lucide-react'
import { Spinner } from '@/components/ui/Spinner'
import { fetchProtectedDocument, resumesApi } from '@/lib/api'
import type { ListingType, ResumeProfile, WorkType } from '@/types'
import { Card, CardBody, Badge, Input, Label, Select } from '@/components/ui/primitives'
import { CountryMultiSelect } from '@/components/ui/CountryMultiSelect'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/toast'
import { cn, fileToDataUrl } from '@/lib/utils'

const ROLES = ['Software Engineering', 'Data Science', 'Product Management', 'Marketing', 'Operations', 'Finance', 'Design', 'Consulting']
const INDUSTRIES = ['Technology', 'Finance', 'Healthcare', 'Agriculture', 'Education', 'E-commerce', 'Consulting', 'Nonprofit']
const TYPES: ListingType[] = ['Internship', 'Full-time', 'Part-time', 'Fellowship']

const blank = (base?: ResumeProfile): Omit<ResumeProfile, 'id' | 'student_id' | 'created_at' | 'updated_at'> => ({
  name: 'New résumé', target_roles: base?.target_roles ?? [], preferred_industries: base?.preferred_industries ?? [],
  pref_countries: base?.pref_countries ?? [], pref_listing_types: base?.pref_listing_types ?? [],
  skills: base?.skills ?? [], work_type: base?.work_type ?? 'any',
  cv_filename: base?.cv_filename, cv_url: base?.cv_url, active: true,
})

export function ResumeWorkspace() {
  const { toast } = useToast()
  const [resumes, setResumes] = useState<ResumeProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [pendingResumeId, setPendingResumeId] = useState<string | null>(null)
  const [skillInputs, setSkillInputs] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<{ resume: ResumeProfile; url: string; type: string } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewDocumentLoading, setPreviewDocumentLoading] = useState(false)
  const [previewExpanded, setPreviewExpanded] = useState(false)

  useEffect(() => {
    resumesApi.list().then(setResumes).catch(() => toast({ title: 'Could not load résumé profiles', tone: 'error' })).finally(() => setLoading(false))
  }, [toast])

  async function create() {
    if (pendingResumeId) return
    try {
      const created = await resumesApi.create(blank(resumes[0]))
      setResumes((current) => [...current, created])
      setPendingResumeId(created.id)
    } catch (error) {
      toast({ title: 'Could not create résumé', description: error instanceof Error ? error.message : undefined, tone: 'error' })
    }
  }

  async function save(resume: ResumeProfile) {
    setSaving(resume.id)
    try {
      const updated = await resumesApi.update(resume.id, resume)
      setResumes((current) => current.map((item) => item.id === updated.id ? updated : item))
      if (pendingResumeId === resume.id) setPendingResumeId(null)
      toast({ title: `${resume.name} saved`, tone: 'success' })
    } catch (error) {
      toast({ title: 'Could not save résumé', description: error instanceof Error ? error.message : undefined, tone: 'error' })
    } finally {
      setSaving(null)
    }
  }

  async function remove(resume: ResumeProfile) {
    try {
      await resumesApi.remove(resume.id)
      setResumes((current) => current.filter((item) => item.id !== resume.id))
      if (pendingResumeId === resume.id) setPendingResumeId(null)
      toast({ title: 'Résumé removed', tone: 'info' })
    } catch (error) {
      toast({ title: 'Could not remove résumé', description: error instanceof Error ? error.message : undefined, tone: 'error' })
    }
  }

  function patch(id: string, next: Partial<ResumeProfile>) {
    setResumes((current) => current.map((item) => item.id === id ? { ...item, ...next } : item))
  }

  async function upload(resume: ResumeProfile, file?: File) {
    if (!file) return
    try {
      const cv_url = await fileToDataUrl(file)
      const updated = await resumesApi.update(resume.id, { cv_filename: file.name, cv_url })
      setResumes((current) => current.map((item) => item.id === updated.id ? updated : item))
      toast({ title: 'Résumé uploaded', tone: 'success' })
    } catch (error) {
      toast({ title: 'Could not upload résumé', description: error instanceof Error ? error.message : undefined, tone: 'error' })
    }
  }

  async function view(resume: ResumeProfile) {
    if (!resume.cv_url) return
    if (preview?.url.startsWith('blob:')) URL.revokeObjectURL(preview.url)
    setPreviewLoading(true)
    setPreviewExpanded(false)
    setPreview({ resume, url: '', type: 'document' })
    try {
      const startedAt = Date.now()
      let documentPath = resume.cv_url
      try { documentPath = new URL(resume.cv_url, window.location.origin).pathname } catch { /* use the supplied URL */ }
      const isProtectedDocument = documentPath.startsWith('/api/documents/')
      const url = isProtectedDocument
        ? await fetchProtectedDocument(resume.cv_url)
        : resume.cv_url.startsWith('data:')
          ? URL.createObjectURL(await (await fetch(resume.cv_url)).blob())
          : resume.cv_url
      const type = resume.cv_filename?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : resume.cv_filename?.match(/\.(png|jpe?g)$/i) ? 'image' : 'document'
      const remainingDelay = Math.max(0, 450 - (Date.now() - startedAt))
      if (remainingDelay) await new Promise((resolve) => window.setTimeout(resolve, remainingDelay))
      setPreviewDocumentLoading(type === 'application/pdf' || type === 'image')
      setPreview({ resume, url, type })
    } catch (error) {
      toast({ title: 'Could not open résumé', description: error instanceof Error ? error.message : undefined, tone: 'error' })
    } finally {
      setPreviewLoading(false)
    }
  }

  function closePreview() {
    if (preview?.url.startsWith('blob:')) URL.revokeObjectURL(preview.url)
    setPreview(null)
    setPreviewExpanded(false)
    setPreviewLoading(false)
    setPreviewDocumentLoading(false)
  }

  if (loading) return <Card><CardBody><p className="text-sm text-muted-foreground">Loading résumé profiles…</p></CardBody></Card>

  return (
    <Card>
      <CardBody>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><FileText className="h-5 w-5 text-primary" /><h2 className="font-semibold">Résumé workspace</h2><Badge tone="outline">Career directions</Badge></div>
            <p className="mt-1 text-sm text-muted-foreground">Create multiple résumé profiles from one master profile. Each direction can have its own roles, skills, locations, and opportunity preferences.</p>
          </div>
          <Button onClick={create} disabled={!!pendingResumeId} title={pendingResumeId ? 'Save the current résumé before creating another' : 'Create a résumé'} className="gap-1.5"><Plus className="h-4 w-4" /> New résumé</Button>
        </div>
        {resumes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center"><p className="text-sm text-muted-foreground">No résumé profiles yet.</p><Button onClick={create} disabled={!!pendingResumeId} variant="outline" className="mt-3 gap-1.5"><Plus className="h-4 w-4" /> Create your first direction</Button></div>
        ) : (
          <div className="space-y-4">
            {resumes.map((resume) => (
              <ResumeCard
                key={resume.id}
                resume={resume}
                saving={saving === resume.id}
                skillInput={skillInputs[resume.id] ?? ''}
                onPatch={(next) => patch(resume.id, next)}
                onSave={() => save(resume)}
                onRemove={() => remove(resume)}
                onSkillInput={(value) => setSkillInputs((current) => ({ ...current, [resume.id]: value }))}
                onUpload={(file) => upload(resume, file)}
                onView={() => view(resume)}
                initiallyOpen={pendingResumeId === resume.id}
              />
            ))}
          </div>
        )}
      </CardBody>
      <Modal open={!!preview} onClose={closePreview} size="xl" className={previewExpanded ? 'max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] sm:max-w-[calc(100vw-2rem)]' : undefined} title={
        <div className="flex items-center justify-between gap-3">
          <span className="truncate">{preview?.resume.cv_filename ?? 'Résumé preview'}</span>
          <Button variant="ghost" size="icon" onClick={() => setPreviewExpanded((value) => !value)} aria-label={previewExpanded ? 'Exit full screen preview' : 'View résumé full screen'} title={previewExpanded ? 'Exit full screen' : 'View full screen'}>
            {previewExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      } description="Private document preview">
        {previewLoading ? (
          <div className="flex h-[45dvh] flex-col items-center justify-center gap-3 text-muted-foreground"><Spinner className="h-8 w-8 text-primary" label="Preparing preview" /><p className="text-sm">Preparing your résumé preview…</p></div>
        ) : preview && (preview.type === 'application/pdf' ? (
          <div className="relative">
            <iframe src={preview.url} title={preview.resume.cv_filename ?? 'Résumé'} onLoad={() => setPreviewDocumentLoading(false)} className={cn('w-full rounded-lg border border-border', previewExpanded ? 'h-[calc(100dvh-9rem)]' : 'h-[70dvh]')} />
            {previewDocumentLoading && <div className="absolute inset-0 flex items-center justify-center bg-card/80"><Spinner className="h-8 w-8 text-primary" label="Loading résumé" /></div>}
          </div>
        ) : preview.type === 'image' ? (
          <div className="relative flex justify-center">
            <img src={preview.url} alt={preview.resume.cv_filename ?? 'Résumé'} onLoad={() => setPreviewDocumentLoading(false)} className={cn('mx-auto max-w-full rounded-lg object-contain', previewExpanded ? 'max-h-[calc(100dvh-9rem)]' : 'max-h-[70dvh]')} />
            {previewDocumentLoading && <div className="absolute inset-0 flex items-center justify-center bg-card/80"><Spinner className="h-8 w-8 text-primary" label="Loading résumé" /></div>}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <FileText className="h-10 w-10 text-primary" />
            <p className="text-sm text-muted-foreground">This file format cannot be previewed in the browser.</p>
            <a href={preview.url} download={preview.resume.cv_filename ?? 'resume'} className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Download résumé</a>
          </div>
        ))}
      </Modal>
    </Card>
  )
}

function ResumeCard({ resume, saving, skillInput, onPatch, onSave, onRemove, onSkillInput, onUpload, onView, initiallyOpen }: {
  resume: ResumeProfile
  saving: boolean
  skillInput: string
  onPatch: (next: Partial<ResumeProfile>) => void
  onSave: () => void
  onRemove: () => void
  onSkillInput: (value: string) => void
  onUpload: (file?: File) => void
  onView: () => void
  initiallyOpen: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(initiallyOpen)
  useEffect(() => {
    if (initiallyOpen) setOpen(true)
  }, [initiallyOpen])
  const toggle = (field: 'target_roles' | 'preferred_industries' | 'pref_listing_types' | 'pref_countries', value: string) => {
    const values = resume[field] as string[]
    onPatch({ [field]: values.includes(value) ? values.filter((item) => item !== value) : [...values, value] })
  }
  const addSkill = (value: string) => {
    const clean = value.trim()
    if (clean && !resume.skills.includes(clean)) onPatch({ skills: [...resume.skills, clean] })
    onSkillInput('')
  }

  return (
    <div className={cn('rounded-xl border p-4', resume.active ? 'border-primary/30 bg-primary/[0.02]' : 'border-border bg-muted/30')}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen((value) => !value)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`${open ? 'Collapse' : 'Expand'} ${resume.name}`} title={open ? 'Collapse résumé' : 'Expand résumé'}>
          <ChevronDown className={cn('h-4 w-4 transition-transform', open ? 'rotate-180' : '')} />
        </button>
        <Input value={resume.name} onChange={(event) => onPatch({ name: event.target.value })} className="max-w-xs font-semibold" aria-label="Résumé name" />
        <Badge tone={resume.active ? 'success' : 'default'}>{resume.active ? 'Active in matching' : 'Paused'}</Badge>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => onPatch({ active: !resume.active })} className="gap-1.5">{resume.active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}{resume.active ? 'Pause' : 'Activate'}</Button>
          <Button variant="ghost" size="icon" className="text-danger" onClick={onRemove} aria-label={`Remove ${resume.name}`}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>

      {!open && (
        <div className="mt-3 grid gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Target roles</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {resume.target_roles.length ? (
                resume.target_roles.map((r) => (
                  <span key={r} className="rounded-full bg-primary/12 px-2 py-0.5 text-xs font-medium text-primary">{r}</span>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">Any</span>
              )}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Preferred locations</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {resume.pref_countries.length ? (
                resume.pref_countries.map((c) => (
                  <span key={c} className="rounded-full bg-primary/12 px-2 py-0.5 text-xs font-medium text-primary">{c}</span>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">Anywhere</span>
              )}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Work mode</p>
            <p className="mt-1 text-sm capitalize text-foreground">{resume.work_type === 'any' ? 'Any' : resume.work_type}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Skills</p>
            <p className="mt-1 text-sm text-muted-foreground">{resume.skills.length} skill{resume.skills.length === 1 ? '' : 's'}</p>
          </div>
        </div>
      )}

      {open && (
      <div className="mt-4 space-y-5">
        <Group title="Résumé file">
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(event) => onUpload(event.target.files?.[0])} />
            {resume.cv_url && <Button variant="outline" size="sm" onClick={onView} className="gap-1.5"><Eye className="h-3.5 w-3.5" /> View</Button>}
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="gap-1.5"><Upload className="h-3.5 w-3.5" /> {resume.cv_filename ? 'Replace résumé file' : 'Upload résumé file'}</Button>
            {resume.cv_filename && <span className="text-xs text-muted-foreground">{resume.cv_filename}</span>}
          </div>
        </Group>

        <Group title="Opportunity preferences">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label>Work mode</Label><Select value={resume.work_type} onChange={(event) => onPatch({ work_type: event.target.value as WorkType })}><option value="any">Any</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">On-site</option></Select></div>
            <div><Label>Opportunity types</Label><ChipGroup options={TYPES} selected={resume.pref_listing_types} onToggle={(value) => toggle('pref_listing_types', value)} /></div>
          </div>
          <div className="mt-4"><Label>Target roles</Label><ChipGroup options={ROLES} selected={resume.target_roles} onToggle={(value) => toggle('target_roles', value)} /></div>
          <div className="mt-4"><Label>Preferred industries</Label><ChipGroup options={INDUSTRIES} selected={resume.preferred_industries} onToggle={(value) => toggle('preferred_industries', value)} /></div>
          <div className="mt-4">
            <Label>Preferred locations</Label>
            <p className="mb-2 text-xs text-muted-foreground">Where you'd like this direction to be considered. We won't match outside these — remote always counts, and an empty list means anywhere.</p>
            <CountryMultiSelect value={resume.pref_countries} onChange={(v) => onPatch({ pref_countries: v })} />
          </div>
        </Group>

        <Group title="Skills for this direction">
          <div className="flex flex-wrap gap-1.5">{resume.skills.map((skill) => <span key={skill} className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2.5 py-1 text-xs font-medium text-primary">{skill}<button type="button" onClick={() => onPatch({ skills: resume.skills.filter((item) => item !== skill) })} aria-label={`Remove ${skill}`}><X className="h-3 w-3" /></button></span>)}</div>
          <div className="mt-2 flex max-w-md gap-2"><Input value={skillInput} onChange={(event) => onSkillInput(event.target.value)} placeholder="Add a skill…" /><Button type="button" variant="outline" size="icon" onClick={() => addSkill(skillInput)} aria-label="Add skill"><Plus className="h-4 w-4" /></Button></div>
        </Group>

        <div className="flex justify-end pt-1"><Button onClick={onSave} loading={saving} className="gap-1.5"><Save className="h-4 w-4" /> Save résumé</Button></div>
      </div>
      )}
    </div>
  )
}

// Labelled sub-section used to break the résumé editor into scannable groups.
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border pt-4 first:border-t-0 first:pt-0">
      <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </div>
  )
}

function ChipGroup({ options, selected, onToggle }: { options: string[]; selected: string[]; onToggle: (value: string) => void }) {
  return <div className="mt-1.5 flex flex-wrap gap-1.5">{options.map((option) => <button type="button" key={option} onClick={() => onToggle(option)} className={cn('rounded-full border px-2.5 py-1 text-xs transition-colors', selected.includes(option) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}>{option}</button>)}</div>
}
