import { useRef, useState } from 'react'
import {
  User,
  Briefcase,
  GraduationCap,
  Link2,
  FileText,
  Images,
  Upload,
  Sparkles,
  Crown,
  Mail,
  Lock,
  Trash2,
  X,
  Plus,
  Save,
  Camera,
  Eye,
  MapPin,
  Compass,
  CheckCircle2,
  Circle,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useCurrentUser, useSession } from '@/lib/store'
import { useMatchRun } from '@/lib/matchRun'
import { fetchProtectedDocument, profilesApi } from '@/lib/api'
import type { Profile as ProfileT, WorkType, ListingType } from '@/types'
import { Card, CardBody, Badge, Avatar, Input, Label, Textarea, Select } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { AvatarEditor } from '@/components/AvatarEditor'
import { useToast } from '@/components/ui/toast'
import { formatDate, cn, fileToDataUrl } from '@/lib/utils'
import { ResumeWorkspace } from '@/components/ResumeWorkspace'
import { EvidenceGallery } from '@/components/EvidenceGallery'

const ROLES = ['Software Engineering', 'Data Science', 'Product Management', 'Marketing', 'Operations', 'Finance', 'Design', 'Consulting']
const INDUSTRIES = ['Technology', 'Finance', 'Healthcare', 'Agriculture', 'Education', 'E-commerce', 'Consulting', 'Nonprofit']
const LISTING_TYPES: ListingType[] = ['Internship', 'Full-time', 'Part-time', 'Fellowship']
import { COUNTRIES as GEO_COUNTRIES } from '@/lib/geo'
const COUNTRIES = GEO_COUNTRIES.filter((c) => c.code !== 'all' && c.code !== 'remote').map((c) => c.name)

export default function Profile() {
  const user = useCurrentUser()!
  const { toast } = useToast()
  const cvRef = useRef<HTMLInputElement>(null)
  const [, force] = useState(0)
  const [saving, setSaving] = useState(false)
  const [skillInput, setSkillInput] = useState('')
  const [countryInput, setCountryInput] = useState('')
  const [confirmRemoveCv, setConfirmRemoveCv] = useState(false)
  const [tab, setTab] = useState<'profile' | 'resumes' | 'gallery'>('profile')
  const TABS = [
    { id: 'profile', label: 'Profile', Icon: User },
    { id: 'resumes', label: 'Résumés', Icon: FileText },
    { id: 'gallery', label: 'Gallery', Icon: Images },
  ] as const

  async function changePicture(avatar_url: string) {
    const updated = await profilesApi.update(user.id, { avatar_url })
    if (updated) useSession.getState().setProfile(updated)
    toast({ title: 'Profile picture updated', tone: 'success' })
  }

  const coverRef = useRef<HTMLInputElement>(null)
  async function changeCoverFile(file?: File | null) {
    if (!file) return
    let cover_url: string
    try {
      cover_url = await fileToDataUrl(file)
    } catch (e) {
      toast({ title: 'Could not upload that image', description: e instanceof Error ? e.message : undefined, tone: 'error' })
      return
    }
    const updated = await profilesApi.update(user.id, { cover_url })
    if (updated) useSession.getState().setProfile(updated)
    toast({ title: 'Cover updated', tone: 'success' })
  }

  // editable copy
  const [form, setForm] = useState({
    full_name: user.full_name,
    bio: user.bio ?? '',
    school: user.school ?? '',
    major: user.major ?? '',
    year: user.year ? String(user.year) : '',
    graduated: user.graduated ?? false,
    location: user.location ?? '',
    gpa: user.gpa ?? '',
    linkedin: user.linkedin ?? '',
    github: user.github ?? '',
    twitter: user.twitter ?? '',
    website: user.website ?? '',
    work_type: (user.work_type ?? 'any') as WorkType,
  })
  const [roles, setRoles] = useState<string[]>(user.desired_roles ?? [])
  const [industries, setIndustries] = useState<string[]>(user.preferred_industries ?? [])
  const [skills, setSkills] = useState<string[]>(user.skills ?? [])
  const [prefTypes, setPrefTypes] = useState<string[]>(user.pref_listing_types ?? [])
  const [prefCountries, setPrefCountries] = useState<string[]>(user.pref_countries ?? [])
  const [monitorConsent, setMonitorConsent] = useState<boolean>(user.monitoring_consent ?? false)

  function toggle(list: string[], set: (v: string[]) => void, v: string) {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  }

  async function save() {
    setSaving(true)
    const patch: Partial<ProfileT> = {
      full_name: form.full_name,
      bio: form.bio,
      school: form.school,
      major: form.major,
      year: form.year ? Number(form.year) : undefined,
      graduated: form.graduated,
      location: form.location,
      gpa: form.gpa.trim() || undefined,
      linkedin: form.linkedin,
      github: form.github,
      twitter: form.twitter,
      website: form.website,
      work_type: form.work_type,
      // Keep the legacy flags in sync with the richer type preferences below
      // (empty selection = open to everything) so anything still reading them works.
      open_to_internship: prefTypes.length === 0 || prefTypes.includes('Internship'),
      open_to_fulltime: prefTypes.length === 0 || prefTypes.some((t) => t !== 'Internship'),
      pref_listing_types: prefTypes as ListingType[],
      pref_countries: prefCountries,
      monitoring_consent: monitorConsent,
      desired_roles: roles,
      preferred_industries: industries,
      skills,
    }
    const updated = await profilesApi.update(user.id, patch)
    if (updated) useSession.getState().setProfile(updated)
    setSaving(false)
    toast({ title: 'Profile saved', tone: 'success' })
  }

  async function uploadCv(file?: File | null) {
    if (!file) return
    let cv_url: string
    try {
      cv_url = await fileToDataUrl(file)
    } catch (e) {
      toast({ title: 'Could not upload that file', description: e instanceof Error ? e.message : undefined, tone: 'error' })
      return
    }
    const updated = await profilesApi.update(user.id, {
      cv_filename: file.name,
      cv_url,
      cv_uploaded_at: new Date().toISOString(),
    })
    if (updated) useSession.getState().setProfile(updated)
    // New résumé → invalidate matches so the Jobs page re-runs AI matching.
    useMatchRun.getState().invalidate(user.id)
    toast({ title: 'CV uploaded', description: 'AI will re-run your matches next time you open Opportunities.', tone: 'success' })
    force((n) => n + 1)
  }

  async function viewCv() {
    if (!user.cv_url) return
    if (user.cv_url.startsWith('/api/documents/')) {
      const objUrl = await fetchProtectedDocument(user.cv_url)
      window.open(objUrl, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(objUrl), 60_000)
    } else if (user.cv_url.startsWith('data:')) {
      const blob = await (await fetch(user.cv_url)).blob()
      const objUrl = URL.createObjectURL(blob)
      window.open(objUrl, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(objUrl), 60_000)
    } else {
      window.open(user.cv_url, '_blank', 'noopener')
    }
  }

  async function removeCv() {
    const updated = await profilesApi.update(user.id, {
      cv_filename: '',
      cv_url: '',
      cv_text: '',
      cv_uploaded_at: '',
    })
    if (updated) useSession.getState().setProfile(updated)
    // No résumé → matches must re-run once a new one is added.
    useMatchRun.getState().invalidate(user.id)
    toast({ title: 'CV removed', description: 'Upload a new one anytime to refresh your AI matches.', tone: 'info' })
    force((n) => n + 1)
  }

  function addSkill() {
    const s = skillInput.trim()
    if (s && !skills.includes(s)) setSkills([...skills, s])
    setSkillInput('')
  }

  function addCountry() {
    const c = countryInput.trim()
    if (c && !prefCountries.includes(c)) setPrefCountries([...prefCountries, c])
    setCountryInput('')
  }

  const studentChecklist = [
    { label: 'Full name', done: !!form.full_name.trim() },
    { label: 'Bio', done: !!form.bio.trim() },
    { label: 'School & major', done: !!(form.school.trim() && form.major.trim()) },
    { label: 'Location', done: !!form.location.trim() },
    { label: 'A link (LinkedIn/GitHub)', done: !!(form.linkedin.trim() || form.github.trim() || form.website.trim()) },
    { label: 'CV / résumé', done: !!user.cv_url },
  ]
  const sDone = studentChecklist.filter((c) => c.done).length
  const sPct = Math.round((sDone / studentChecklist.length) * 100)

  return (
    <div className="mx-auto max-w-6xl">
      {/* Cover */}
      <div className="relative h-40 w-full overflow-hidden rounded-xl bg-gradient-to-r from-primary/30 via-accent/20 to-primary/30">
        {user.cover_url && <img src={user.cover_url} alt="Cover" className="h-full w-full object-cover" />}
        {user.user_type === 'student' && (
          <button onClick={() => coverRef.current?.click()} className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-lg bg-black/40 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-black/60">
            <Camera className="h-4 w-4" /> {user.cover_url ? 'Change cover' : 'Add cover'}
          </button>
        )}
        <input ref={coverRef} type="file" accept="image/*" className="hidden" onChange={(e) => changeCoverFile(e.target.files?.[0])} />
      </div>

      {/* Header */}
      <Card className="-mt-12 relative z-10">
        <CardBody className="flex flex-wrap items-center gap-4">
          <AvatarEditor name={user.full_name} src={user.avatar_url} size={72} onChange={changePicture} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight">{user.full_name}</h1>
              {user.plan !== 'free' && <Badge tone="primary" className="gap-1"><Crown className="h-3 w-3" /> {user.plan.toUpperCase()}</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">{user.major}{user.school ? ` · ${user.school}` : ''}</p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
          <Button onClick={save} loading={saving} className="w-full gap-1.5 sm:w-auto"><Save className="h-4 w-4" /> Save changes</Button>
        </CardBody>
      </Card>

      {/* Tabs */}
      <div className="mb-5 mt-5 flex gap-1 rounded-xl border border-border bg-muted/60 p-1 text-sm">
        {TABS.map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 font-medium transition-all',
                active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
              )}
            >
              <t.Icon className={cn('h-4 w-4', active ? 'text-primary' : '')} />
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'profile' && (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-5">
      {/* About */}
      <Section icon={User} title="About">
        <div className="space-y-4">
          <div><Label>Full name</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
          <div><Label>Bio</Label><Textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} placeholder="A short intro about you…" /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label>School / University</Label><Input value={form.school} onChange={(e) => setForm({ ...form, school: e.target.value })} /></div>
            <div><Label>Major</Label><Input value={form.major} onChange={(e) => setForm({ ...form, major: e.target.value })} /></div>
            <div>
              <Label>Year of study</Label>
              <Select value={form.graduated ? 'grad' : form.year} onChange={(e) => {
                const v = e.target.value
                if (v === 'grad') setForm({ ...form, graduated: true, year: '' })
                else setForm({ ...form, graduated: false, year: v })
              }}>
                <option value="">—</option>
                {[1, 2, 3, 4].map((y) => <option key={y} value={y}>Year {y}</option>)}
                <option value="grad">Graduate</option>
              </Select>
            </div>
            <div><Label>Location</Label><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="City, Country" /></div>
            <div><Label>GPA</Label><Input value={form.gpa} onChange={(e) => setForm({ ...form, gpa: e.target.value })} placeholder="e.g. 3.8/4.0 or Second Class Upper" /></div>
          </div>
        </div>
      </Section>

      {/* Legacy profile CV controls are replaced by equal résumé directions below. */}
      {false && <Section icon={FileText} title="CV / Résumé" hint="Powers AI matching">
        <input ref={cvRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => uploadCv(e.target.files?.[0])} />
        {user.cv_filename ? (
          <div className="rounded-xl border border-success/30 bg-success/5 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-success/15 text-success">
                <FileText className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{user.cv_filename}</p>
                <p className="text-xs text-muted-foreground">
                  {user.cv_uploaded_at ? `Uploaded ${formatDate(user.cv_uploaded_at!)} · ` : ''}You’re all set ✨
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {user.cv_url && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => viewCv()}>
                  <Eye className="h-3.5 w-3.5" /> View
                </Button>
              )}
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => cvRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> Replace
              </Button>
              <Button variant="ghost" size="sm" className="gap-1.5 text-danger hover:bg-danger/10" onClick={() => setConfirmRemoveCv(true)}>
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </Button>
            </div>
          </div>
        ) : (
          <button onClick={() => cvRef.current?.click()} className="flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-input p-5 text-left transition-colors hover:border-primary/50 hover:bg-primary/5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Upload className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium">Upload your CV</p>
              <p className="text-xs text-muted-foreground">PDF or Word — this is what powers your AI matches</p>
            </div>
          </button>
        )}
        <p className="mt-2.5 flex items-center gap-1.5 text-xs text-muted-foreground"><Sparkles className="h-3.5 w-3.5 text-primary" /> Your CV is the #1 signal our AI uses to find your best-fit roles.</p>
      </Section>}
      {/* Legacy profile preferences are replaced by per-résumé preferences above. */}
      {false && <Section icon={Briefcase} title="Career preferences" hint="Feeds the AI matching engine">
        <Label>Roles I'm interested in</Label>
        <ChipGroup options={ROLES} selected={roles} onToggle={(v) => toggle(roles, setRoles, v)} />
        <Label className="mt-4">Industries</Label>
        <ChipGroup options={INDUSTRIES} selected={industries} onToggle={(v) => toggle(industries, setIndustries, v)} />

        <Label className="mt-4">Opportunity types I want</Label>
        <p className="mb-1.5 text-xs text-muted-foreground">We'll only match these. Leave empty to consider every type.</p>
        <ChipGroup options={LISTING_TYPES} selected={prefTypes} onToggle={(v) => toggle(prefTypes, setPrefTypes, v)} />

        <Label className="mt-4">Countries I'd work in</Label>
        <p className="mb-1.5 text-xs text-muted-foreground">Pick where you'd like to work — we won't match roles outside these. Remote roles always count, and leaving this empty means anywhere.</p>
        <ChipGroup
          options={Array.from(new Set([...COUNTRIES, ...prefCountries]))}
          selected={prefCountries}
          onToggle={(v) => toggle(prefCountries, setPrefCountries, v)}
        />
        <form onSubmit={(e) => { e.preventDefault(); addCountry() }} className="mt-2 flex gap-2">
          <div className="relative max-w-xs flex-1">
            <MapPin className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={countryInput} onChange={(e) => setCountryInput(e.target.value)} placeholder="Add another country…" className="pl-8" />
          </div>
          <Button type="submit" variant="outline" size="icon" aria-label="Add country"><Plus className="h-4 w-4" /></Button>
        </form>

        <div className="mt-4">
          <Label>Work type</Label>
          <Select value={form.work_type} onChange={(e) => setForm({ ...form, work_type: e.target.value as WorkType })} className="max-w-xs">
            <option value="any">Any</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="onsite">On-site</option>
          </Select>
        </div>

        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
          <input
            type="checkbox"
            checked={monitorConsent}
            onChange={(e) => setMonitorConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span className="text-sm">
            <span className="font-medium text-foreground">Track my application outcomes</span>
            <span className="block text-xs text-muted-foreground">
              After you apply to an external role, let Optryva check your linked public profiles (e.g. GitHub) for progress, so our AI can nudge you on exactly what to add next to land the offer. Off by default — you can turn this off anytime.
            </span>
          </span>
        </label>

        <Label className="mt-4">Skills</Label>
        <div className="flex flex-wrap gap-1.5">
          {skills.map((s) => (
            <span key={s} className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2.5 py-1 text-xs font-medium text-primary">
              {s}<button onClick={() => setSkills(skills.filter((x) => x !== s))}><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); addSkill() }} className="mt-2 flex gap-2">
          <Input value={skillInput} onChange={(e) => setSkillInput(e.target.value)} placeholder="Add a skill…" className="max-w-xs" />
          <Button type="submit" variant="outline" size="icon"><Plus className="h-4 w-4" /></Button>
        </form>
      </Section>}

      {/* Social */}
      <Section icon={Link2} title="Links">
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label>LinkedIn</Label><Input value={form.linkedin} onChange={(e) => setForm({ ...form, linkedin: e.target.value })} placeholder="https://linkedin.com/in/…" /></div>
          <div><Label>GitHub</Label><Input value={form.github} onChange={(e) => setForm({ ...form, github: e.target.value })} placeholder="https://github.com/…" /></div>
          <div><Label>Twitter / X</Label><Input value={form.twitter} onChange={(e) => setForm({ ...form, twitter: e.target.value })} /></div>
          <div><Label>Website</Label><Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></div>
        </div>
      </Section>

      <div className="flex justify-end">
        <Button onClick={save} loading={saving} className="w-full gap-1.5 sm:w-auto"><Save className="h-4 w-4" /> Save changes</Button>
      </div>

      <AccountSecurity />

      {/* Remove CV confirmation */}
      <Modal
        open={confirmRemoveCv}
        onClose={() => setConfirmRemoveCv(false)}
        size="sm"
        title="Remove your CV?"
        description="Your AI matches rely on your CV. You can upload a new one anytime."
      >
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => setConfirmRemoveCv(false)}>Keep it</Button>
          <Button variant="danger" className="gap-1.5" onClick={() => { setConfirmRemoveCv(false); void removeCv() }}>
            <Trash2 className="h-4 w-4" /> Remove CV
          </Button>
        </div>
      </Modal>
        </div>

        <aside className="space-y-5 lg:sticky lg:top-6 self-start">
          {/* Quick actions */}
          <Card>
            <CardBody className="space-y-2">
              <h2 className="font-semibold">Quick actions</h2>
              <Link to="/app/jobs" className="flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                <Briefcase className="h-4 w-4" /> Browse opportunities
              </Link>
              <Link to="/app/research" className="flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted">
                <Compass className="h-4 w-4" /> Research roles
              </Link>
              <Link to="/app/applications" className="flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted">
                <FileText className="h-4 w-4" /> My applications
              </Link>
              <Link to={`/app/u/${user.id}`} className="flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted">
                <User className="h-4 w-4" /> View public profile
              </Link>
            </CardBody>
          </Card>

          {/* Profile completeness */}
          <Card>
            <CardBody className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Profile completeness</h2>
                <span className="text-sm font-medium text-muted-foreground">{sPct}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${sPct}%` }} />
              </div>
              <ul className="space-y-1.5 text-sm">
                {studentChecklist.map((c) => (
                  <li key={c.label} className="flex items-center gap-2">
                    {c.done ? (
                      <CheckCircle2 className="h-4 w-4 text-accent" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className={c.done ? 'text-foreground' : 'text-muted-foreground'}>{c.label}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">A complete profile gets you better AI matches.</p>
            </CardBody>
          </Card>

          {/* Plan */}
          <Card>
            <CardBody className="space-y-3">
              <div className="flex items-center gap-2">
                <Crown className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Plan</h2>
              </div>
              <Badge tone="primary" className="gap-1">
                <Crown className="h-3 w-3" /> {user.plan.toUpperCase()} plan
              </Badge>
              <p className="text-sm text-muted-foreground">Manage seats, billing and upgrade your plan.</p>
              <Link to="/app/usage" className="flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted">
                Manage plan
              </Link>
            </CardBody>
          </Card>
        </aside>
      </div>
      )}

      {tab === 'resumes' && <ResumeWorkspace />}
      {tab === 'gallery' && <EvidenceGallery studentId={user.id} mode="owner" />}
    </div>
  )
}

function Section({ icon: Icon, title, hint, children }: { icon: typeof User; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardBody>
        <div className="mb-4 flex items-center gap-2">
          <Icon className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">{title}</h2>
          {hint && <Badge tone="outline" className="ml-auto text-[11px]">{hint}</Badge>}
        </div>
        {children}
      </CardBody>
    </Card>
  )
}

function ChipGroup({ options, selected, onToggle }: { options: string[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o)
        return (
          <button key={o} onClick={() => onToggle(o)} className={cn('rounded-full border px-3 py-1.5 text-sm transition-colors', on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}>
            {o}
          </button>
        )
      })}
    </div>
  )
}

/* ---------- Account & Security (shared component) ---------- */
function AccountSecurity() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const logout = useSession((s) => s.logout)
  const [modal, setModal] = useState<null | 'email' | 'password' | 'delete'>(null)

  return (
    <Card>
      <CardBody>
        <div className="mb-4 flex items-center gap-2">
          <Lock className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Account & Security</h2>
        </div>
        <div className="divide-y divide-border">
          <Row icon={Mail} title="Change email" desc="Update your sign-in email" onClick={() => setModal('email')} />
          <Row icon={Lock} title="Change password" desc="Use a strong, unique password" onClick={() => setModal('password')} />
          <Row icon={Trash2} title="Delete account" desc="Permanently remove your account & data" danger onClick={() => setModal('delete')} />
        </div>
      </CardBody>

      {/* Change email */}
      <Modal open={modal === 'email'} onClose={() => setModal(null)} size="sm" title="Change email">
        <form onSubmit={(e) => { e.preventDefault(); setModal(null); toast({ title: 'Email updated (demo)', tone: 'success' }) }} className="space-y-3">
          <div><Label>Current password</Label><Input type="password" required /></div>
          <div><Label>New email</Label><Input type="email" required /></div>
          <div className="flex justify-end gap-2 pt-2"><Button variant="ghost" type="button" onClick={() => setModal(null)}>Cancel</Button><Button type="submit">Update</Button></div>
        </form>
      </Modal>

      {/* Change password */}
      <Modal open={modal === 'password'} onClose={() => setModal(null)} size="sm" title="Change password">
        <form onSubmit={(e) => { e.preventDefault(); setModal(null); toast({ title: 'Password changed (demo)', tone: 'success' }) }} className="space-y-3">
          <div><Label>Current password</Label><Input type="password" required /></div>
          <div><Label>New password</Label><Input type="password" required /></div>
          <div className="flex justify-end gap-2 pt-2"><Button variant="ghost" type="button" onClick={() => setModal(null)}>Cancel</Button><Button type="submit">Update</Button></div>
        </form>
      </Modal>

      {/* Delete */}
      <Modal open={modal === 'delete'} onClose={() => setModal(null)} size="sm" title="Delete account?" description="This is irreversible and removes all your applications, messages, and data.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => { setModal(null); logout(); toast({ title: 'Account deleted (demo)', tone: 'info' }); navigate('/') }}>Delete forever</Button>
        </div>
      </Modal>
    </Card>
  )
}

function Row({ icon: Icon, title, desc, onClick, danger }: { icon: typeof Mail; title: string; desc: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 py-3 text-left hover:bg-muted/40">
      <Icon className={cn('h-5 w-5', danger ? 'text-danger' : 'text-muted-foreground')} />
      <div className="flex-1">
        <p className={cn('text-sm font-medium', danger && 'text-danger')}>{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </button>
  )
}
