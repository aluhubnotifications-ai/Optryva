import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Briefcase, Plus, Users, MapPin, Pencil, Trash2, Building2, Eye, CheckCircle2, Lock, ImagePlus } from 'lucide-react'
import { imageFileToDataUrl } from '@/lib/utils'
import { useCurrentUser } from '@/lib/store'
import { applicationsApi, jobsApi } from '@/lib/api'
import { COUNTRIES } from '@/lib/geo'
import { JobPostingView } from '@/components/JobPostingView'
import type { JobListing, ListingType } from '@/types'
import { Card, CardBody, Badge, Avatar, Input, Label, Textarea, Select, Skeleton } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/toast'
import { cn, daysUntil } from '@/lib/utils'

const CATEGORIES = ['Software Engineering', 'Data', 'Design', 'Marketing', 'Operations', 'Finance', 'Product']
const LISTING_TYPES: ListingType[] = ['Internship', 'Full-time', 'Part-time', 'Fellowship']
const LIVE_COUNTRIES = COUNTRIES.filter((c) => !c.disabled && c.code !== 'all').map((c) => c.name)

export default function Listings() {
  const user = useCurrentUser()!
  const { toast } = useToast()
  const [jobs, setJobs] = useState<JobListing[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<JobListing | null>(null)
  const [previewJob, setPreviewJob] = useState<JobListing | null>(null)

  async function load() {
    const [j, apps] = await Promise.all([jobsApi.byCompany(user.id), applicationsApi.byCompany(user.id)])
    const c: Record<string, number> = {}
    apps.forEach((a) => (c[a.job_id] = (c[a.job_id] ?? 0) + 1))
    setJobs(j)
    setCounts(c)
    setLoading(false)
  }
  useEffect(() => { load() }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  async function remove(id: string) {
    await jobsApi.remove(id)
    toast({ title: 'Listing removed', tone: 'info' })
    load()
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Briefcase className="h-6 w-6 text-primary" /> My Listings</h1>
          <p className="text-sm text-muted-foreground">Post roles and manage applicants.</p>
        </div>
        <Button className="gap-1.5" onClick={() => { setEditing(null); setOpen(true) }}><Plus className="h-4 w-4" /> Create listing</Button>
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Card key={i}><CardBody><Skeleton className="h-4 w-1/2" /><Skeleton className="mt-2 h-3 w-1/3" /></CardBody></Card>)}</div>
      ) : jobs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center">
          <Briefcase className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="font-medium">No listings yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Post your first role to start receiving applicants.</p>
          <Button className="mt-4 gap-1.5" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Create listing</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => {
            const dl = daysUntil(j.deadline)
            return (
              <Card key={j.id}>
                <CardBody className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setPreviewJob(j)} className="truncate font-semibold hover:text-primary hover:underline" title="View details">{j.title}</button>
                      <Badge tone={j.status === 'active' ? 'success' : 'default'} className="capitalize">{j.status}</Badge>
                      {j.apply_url ? <Badge tone="outline">External</Badge> : <Badge tone="primary">In-app</Badge>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {j.location}</span>
                      <span>{j.listing_type}</span>
                      {dl !== null && <span>{dl <= 0 ? 'Closed' : `${dl}d left`}</span>}
                      {j.allowed_years.length > 0 && <span>Years: {j.allowed_years.join(', ')}</span>}
                      {(j.allowed_schools?.length ?? 0) > 0 && <Badge tone="accent" className="text-[10px]">{j.allowed_schools!.length} school{j.allowed_schools!.length > 1 ? 's' : ''} only</Badge>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setPreviewJob(j)}><Eye className="h-4 w-4" /> View</Button>
                    <Link to={`/app/listings/${j.id}?tab=applicants`} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted">
                      <Users className="h-4 w-4" /> {counts[j.id] ?? 0} applicants
                    </Link>
                    <Button variant="ghost" size="icon" onClick={() => { setEditing(j); setOpen(true) }}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="text-danger" onClick={() => remove(j.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}

      <ListingModal open={open} onClose={() => setOpen(false)} editing={editing} onSaved={() => { setOpen(false); load() }} />

      <Modal open={!!previewJob} onClose={() => setPreviewJob(null)} size="xl" title="Job details">
        {previewJob && (
          <div className="space-y-5">
            <JobPostingView
              job={previewJob}
              brand={previewJob.original_company_name || user.company_name || user.full_name}
              logo={previewJob.original_company_logo_url || user.avatar_url}
            />
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button variant="ghost" onClick={() => setPreviewJob(null)}>Close</Button>
              <Button className="gap-1.5" onClick={() => { setEditing(previewJob); setPreviewJob(null); setOpen(true) }}><Pencil className="h-4 w-4" /> Edit</Button>
            </div>
          </div>
        )}
      </Modal>
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

function ListingModal({ open, onClose, editing, onSaved }: { open: boolean; onClose: () => void; editing: JobListing | null; onSaved: () => void }) {
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
      })
    } else {
      setF((p) => ({ ...p, title: '', description: '', pay: '', duration: '', deadline: '', tags: '', responsibilities: [], benefits: [], qualifications: [], apply_url: '', allowed_years: [], allowed_schools: '', students_only: false, fromOther: false, original_company_name: '' }))
    }
  }, [editing, open])

  function toggleYear(y: number) {
    setF((p) => ({ ...p, allowed_years: p.allowed_years.includes(y) ? p.allowed_years.filter((x) => x !== y) : [...p.allowed_years, y] }))
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
    <Modal open={open} onClose={onClose} size="xl" title={editing ? 'Edit listing' : 'Create a listing'}>
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
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} loading={saving}>{editing ? 'Save changes' : 'Post listing'}</Button>
          </div>
        </div>
      </div>

      <PostingPreview open={preview} onClose={() => setPreview(false)} f={f} user={user} isSchool={isSchool} />
    </Modal>
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
    created_at: new Date().toISOString(),
  }
  return (
    <Modal open={open} onClose={onClose} size="xl" title="Preview — how students will see it">
      <JobPostingView job={job} brand={job.original_company_name || user.company_name || user.full_name} logo={job.original_company_logo_url || user.avatar_url} />
    </Modal>
  )
}

