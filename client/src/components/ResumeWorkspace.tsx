import { useEffect, useRef, useState } from 'react'
import { FileText, Pause, Play, Plus, Save, Trash2, Upload, X } from 'lucide-react'
import { resumesApi } from '@/lib/api'
import type { ListingType, ResumeProfile, WorkType } from '@/types'
import { Card, CardBody, Badge, Input, Label, Select } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/toast'
import { cn, fileToDataUrl } from '@/lib/utils'

const ROLES = ['Software Engineering', 'Data Science', 'Product Management', 'Marketing', 'Operations', 'Finance', 'Design', 'Consulting']
const INDUSTRIES = ['Technology', 'Finance', 'Healthcare', 'Agriculture', 'Education', 'E-commerce', 'Consulting', 'Nonprofit']
const TYPES: ListingType[] = ['Internship', 'Full-time', 'Part-time', 'Fellowship']
const COUNTRIES = ['Rwanda', 'Kenya', 'Nigeria', 'Ghana', 'Uganda', 'Tanzania', 'Ethiopia', 'South Africa', 'Egypt', 'Senegal', 'Morocco']

const blank = (): Omit<ResumeProfile, 'id' | 'student_id' | 'created_at' | 'updated_at'> => ({
  name: 'New résumé', target_roles: [], preferred_industries: [], pref_countries: [],
  pref_listing_types: [], skills: [], work_type: 'any', active: true,
})

export function ResumeWorkspace() {
  const { toast } = useToast()
  const [resumes, setResumes] = useState<ResumeProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [skillInputs, setSkillInputs] = useState<Record<string, string>>({})
  const [countryInputs, setCountryInputs] = useState<Record<string, string>>({})

  useEffect(() => {
    resumesApi.list().then(setResumes).catch(() => toast({ title: 'Could not load résumé profiles', tone: 'error' })).finally(() => setLoading(false))
  }, [toast])

  async function create() {
    try {
      const created = await resumesApi.create(blank())
      setResumes((current) => [...current, created])
    } catch (error) {
      toast({ title: 'Could not create résumé', description: error instanceof Error ? error.message : undefined, tone: 'error' })
    }
  }

  async function save(resume: ResumeProfile) {
    setSaving(resume.id)
    try {
      const updated = await resumesApi.update(resume.id, resume)
      setResumes((current) => current.map((item) => item.id === updated.id ? updated : item))
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

  if (loading) return <Card><CardBody><p className="text-sm text-muted-foreground">Loading résumé profiles…</p></CardBody></Card>

  return (
    <Card>
      <CardBody>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><FileText className="h-5 w-5 text-primary" /><h2 className="font-semibold">Résumé workspace</h2><Badge tone="outline">Career directions</Badge></div>
            <p className="mt-1 text-sm text-muted-foreground">Create multiple résumé profiles from one master profile. Each direction can have its own roles, skills, locations, and opportunity preferences.</p>
          </div>
          <Button onClick={create} className="gap-1.5"><Plus className="h-4 w-4" /> New résumé</Button>
        </div>
        {resumes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center"><p className="text-sm text-muted-foreground">No résumé profiles yet.</p><Button onClick={create} variant="outline" className="mt-3 gap-1.5"><Plus className="h-4 w-4" /> Create your first direction</Button></div>
        ) : (
          <div className="space-y-4">
            {resumes.map((resume) => (
              <ResumeCard
                key={resume.id}
                resume={resume}
                saving={saving === resume.id}
                skillInput={skillInputs[resume.id] ?? ''}
                countryInput={countryInputs[resume.id] ?? ''}
                onPatch={(next) => patch(resume.id, next)}
                onSave={() => save(resume)}
                onRemove={() => remove(resume)}
                onSkillInput={(value) => setSkillInputs((current) => ({ ...current, [resume.id]: value }))}
                onCountryInput={(value) => setCountryInputs((current) => ({ ...current, [resume.id]: value }))}
                onUpload={(file) => upload(resume, file)}
              />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function ResumeCard({ resume, saving, skillInput, countryInput, onPatch, onSave, onRemove, onSkillInput, onCountryInput, onUpload }: {
  resume: ResumeProfile
  saving: boolean
  skillInput: string
  countryInput: string
  onPatch: (next: Partial<ResumeProfile>) => void
  onSave: () => void
  onRemove: () => void
  onSkillInput: (value: string) => void
  onCountryInput: (value: string) => void
  onUpload: (file?: File) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const toggle = (field: 'target_roles' | 'preferred_industries' | 'pref_listing_types' | 'pref_countries', value: string) => {
    const values = resume[field] as string[]
    onPatch({ [field]: values.includes(value) ? values.filter((item) => item !== value) : [...values, value] })
  }
  const addValue = (field: 'skills' | 'pref_countries', value: string, clear: () => void) => {
    const clean = value.trim()
    const values = resume[field]
    if (clean && !values.includes(clean)) onPatch({ [field]: [...values, clean] })
    clear()
  }

  return (
    <div className={cn('rounded-xl border p-4', resume.active ? 'border-primary/30 bg-primary/[0.02]' : 'border-border bg-muted/30')}>
      <div className="flex flex-wrap items-center gap-2">
        <Input value={resume.name} onChange={(event) => onPatch({ name: event.target.value })} className="max-w-xs font-semibold" aria-label="Résumé name" />
        <Badge tone={resume.active ? 'success' : 'default'}>{resume.active ? 'Active in matching' : 'Paused'}</Badge>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => onPatch({ active: !resume.active })} className="gap-1.5">{resume.active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}{resume.active ? 'Pause' : 'Activate'}</Button>
          <Button variant="ghost" size="icon" className="text-danger" onClick={onRemove} aria-label={`Remove ${resume.name}`}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(event) => onUpload(event.target.files?.[0])} />
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="gap-1.5"><Upload className="h-3.5 w-3.5" /> {resume.cv_filename ? 'Replace résumé file' : 'Upload résumé file'}</Button>
        {resume.cv_filename && <span className="text-xs text-muted-foreground">{resume.cv_filename}</span>}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div><Label>Work mode</Label><Select value={resume.work_type} onChange={(event) => onPatch({ work_type: event.target.value as WorkType })}><option value="any">Any</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">On-site</option></Select></div>
        <div><Label>Opportunity types</Label><ChipGroup options={TYPES} selected={resume.pref_listing_types} onToggle={(value) => toggle('pref_listing_types', value)} /></div>
      </div>
      <Label className="mt-4">Target roles</Label><ChipGroup options={ROLES} selected={resume.target_roles} onToggle={(value) => toggle('target_roles', value)} />
      <Label className="mt-4">Preferred industries</Label><ChipGroup options={INDUSTRIES} selected={resume.preferred_industries} onToggle={(value) => toggle('preferred_industries', value)} />
      <Label className="mt-4">Preferred locations</Label><ChipGroup options={COUNTRIES} selected={resume.pref_countries} onToggle={(value) => toggle('pref_countries', value)} />
      <div className="mt-2 flex max-w-md gap-2"><Input value={countryInput} onChange={(event) => onCountryInput(event.target.value)} placeholder="Add another country…" /><Button type="button" variant="outline" size="icon" onClick={() => addValue('pref_countries', countryInput, () => onCountryInput(''))} aria-label="Add country"><Plus className="h-4 w-4" /></Button></div>
      <Label className="mt-4">Skills for this direction</Label>
      <div className="flex flex-wrap gap-1.5">{resume.skills.map((skill) => <span key={skill} className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2.5 py-1 text-xs font-medium text-primary">{skill}<button type="button" onClick={() => onPatch({ skills: resume.skills.filter((item) => item !== skill) })} aria-label={`Remove ${skill}`}><X className="h-3 w-3" /></button></span>)}</div>
      <div className="mt-2 flex max-w-md gap-2"><Input value={skillInput} onChange={(event) => onSkillInput(event.target.value)} placeholder="Add a skill…" /><Button type="button" variant="outline" size="icon" onClick={() => addValue('skills', skillInput, () => onSkillInput(''))} aria-label="Add skill"><Plus className="h-4 w-4" /></Button></div>
      <div className="mt-4 flex justify-end"><Button onClick={onSave} loading={saving} className="gap-1.5"><Save className="h-4 w-4" /> Save résumé</Button></div>
    </div>
  )
}

function ChipGroup({ options, selected, onToggle }: { options: string[]; selected: string[]; onToggle: (value: string) => void }) {
  return <div className="mt-1.5 flex flex-wrap gap-1.5">{options.map((option) => <button type="button" key={option} onClick={() => onToggle(option)} className={cn('rounded-full border px-2.5 py-1 text-xs transition-colors', selected.includes(option) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}>{option}</button>)}</div>
}
