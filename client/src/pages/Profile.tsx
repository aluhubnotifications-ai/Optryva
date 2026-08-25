import { useRef, useState, useEffect } from 'react'
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
  ArrowRight,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useCurrentUser, useSession } from '@/lib/store'
import { useMatchRun } from '@/lib/matchRun'
import { fetchProtectedDocument, profilesApi, resumesApi, evidenceApi, authApi } from '@/lib/api'
import { profileCompletion, GOAL_OPTIONS, ROLE_OPTIONS, setEvidenceDeclined, isEvidenceDeclined, type OnboardingStep } from '@/lib/onboarding'
import type { Profile as ProfileT, UserType, WorkType, ListingType, ResumeProfile } from '@/types'
import { Card, CardBody, Badge, Avatar, Input, Label, Textarea, Select } from '@/components/ui/primitives'
import { CountryCombobox } from '@/components/ui/CountryCombobox'
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
    { id: 'gallery', label: 'Portfolio', Icon: Images },
  ] as const

  // Résumé directions the student has — feeds the "Résumé" onboarding step and
  // is passed to <ResumeWorkspace /> so the tab renders instantly (no refetch).
  const [resumeCount, setResumeCount] = useState(0)
  const [resumeList, setResumeList] = useState<ResumeProfile[]>([])
  useEffect(() => {
    if (user.user_type === 'student') {
      resumesApi
        .list()
        .then((r) => {
          setResumeList(r)
          setResumeCount(r.length)
        })
        .catch(() => {})
    }
  }, [user.id, user.user_type])

  // The 3-question quick intake (name / who you are / first goal) runs the moment
  // a student arrives with any of those missing — e.g. straight after Google sign-in.
  const [introOpen, setIntroOpen] = useState(
    () => !user.full_name?.trim() || !user.user_type || !user.onboarding_goal?.trim(),
  )
  // Optional onboarding steps the student chose to "Skip for now" (session-only).
  const [skipped, setSkipped] = useState<Set<string>>(new Set())

  const [evidenceCount, setEvidenceCount] = useState(0)
  const [evidenceTick, setEvidenceTick] = useState(0)
  useEffect(() => {
    let active = true
    evidenceApi
      .list()
      .then((list) => { if (active) setEvidenceCount(list.length) })
      .catch(() => undefined)
    return () => { active = false }
  }, [user.id, evidenceTick, tab])

  const completion = profileCompletion(user, resumeCount, evidenceCount)
  const isStudent = user.user_type === 'student'
  // Guidance shows for EVERY incomplete account — student, company, school, or a
  // Google sign-in that hasn't picked a role yet — not only students.
  const showGate = !completion.requiredComplete
  const showReminder = completion.requiredComplete && completion.overallPercent < 100

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
    country: user.country ?? '',
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

  // Jump the student to whichever field the onboarding step is about.
  function focusStep(step: OnboardingStep) {
    if (step.key === 'name' || step.key === 'role' || step.key === 'goal') {
      setIntroOpen(true)
      return
    }
    if (step.section === 'resumes') {
      setTab('resumes')
      return
    }
    if (step.section === 'evidence') {
      setTab('gallery')
      return
    }
    setTab('profile')
    setTimeout(() => document.getElementById('about-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
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
      country: form.country || undefined,
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

  return (
    <div className="mx-auto max-w-6xl">
      {/* Onboarding gate / progress banner — always visible until the profile is
          complete. Keeps the student oriented on what to do next. */}
      {(showGate || showReminder) && (
        <div className={cn(
          'mb-5 rounded-2xl border p-4',
          showGate ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/40',
        )}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              {showGate ? (
                <>
                  <p className="font-semibold">A few quick details and you&apos;re in:</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Still needed &mdash; {completion.required.filter((s) => !s.done).map((s) => s.label).join(', ')}.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-semibold">Your profile is {completion.overallPercent}% complete.</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {completion.optional.filter((s) => !s.done).length > 0
                      ? `Optional to add: ${completion.optional.filter((s) => !s.done).map((s) => s.label).join(', ')}.`
                      : 'Nicely done — your profile is complete.'}
                  </p>
                </>
              )}
            </div>
            {completion.nextStep && (
              <Button onClick={() => focusStep(completion.nextStep!)} className="gap-1.5">
                {showGate ? 'Finish setup' : 'Add more'} <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${showGate ? completion.requiredPercent : completion.overallPercent}%` }}
            />
          </div>
        </div>
      )}

      {isStudent && evidenceCount === 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 rounded-full bg-amber-100 p-2 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-amber-900 dark:text-amber-100">Build your portfolio</p>
              <p className="mt-0.5 text-sm text-amber-800 dark:text-amber-200/90">
                Add evidence of your work — projects, certificates, research, links — so employers can see the proof behind your skills. It only takes a minute.
              </p>
            </div>
          </div>
          <Button onClick={() => setTab('gallery')} className="shrink-0 gap-1.5">
            <Plus className="h-4 w-4" /> Add to portfolio
          </Button>
        </div>
      )}

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
      <Section id="about-section" icon={User} title="About">
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
            <div>
              <Label>Country</Label>
              <CountryCombobox value={form.country} onChange={(v) => setForm({ ...form, country: v })} placeholder="Select your country" />
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

        {/* Quick intake: name, who you are, first goal */}
        <OnboardingIntro
          open={introOpen}
          user={user}
          onClose={() => setIntroOpen(false)}
          onSaved={() => {
            setIntroOpen(false)
            toast({ title: 'Profile updated', tone: 'success' })
          }}
        />

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

          {/* Profile completeness — required + optional steps with progress.
              Student-only: companies/schools have their own (lighter) setup. */}
          {isStudent && (
            <ProfileCompletionCard
              completion={completion}
              skipped={skipped}
              onFocus={focusStep}
              onSkip={(k) => setSkipped((s) => new Set(s).add(k))}
              onSkipEvidence={() => {
                setEvidenceDeclined(user.id, true)
                setEvidenceTick((t) => t + 1)
                toast({ title: "Got it — evidence skipped for now", tone: 'success' })
              }}
            />
          )}

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

      {tab === 'resumes' && <ResumeWorkspace initialResumes={resumeList} />}
      {tab === 'gallery' && (
        <div>
          {evidenceCount === 0 && !isEvidenceDeclined(user.id) && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4">
              <p className="text-sm text-foreground">
                <span className="font-semibold">Evidence is required.</span> Add projects, certificates, awards or writing to prove your skills and strengthen your applications.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEvidenceDeclined(user.id, true)
                  setEvidenceTick((t) => t + 1)
                  toast({ title: "Got it — evidence skipped for now", tone: 'success' })
                }}
              >
                Skip for now
              </Button>
            </div>
          )}
          <EvidenceGallery studentId={user.id} mode="owner" />
        </div>
      )}
    </div>
  )
}

function Section({ id, icon: Icon, title, hint, children }: { id?: string; icon: typeof User; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card id={id}>
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
  const [busy, setBusy] = useState(false)

  async function doDelete() {
    if (busy) return
    setBusy(true)
    try {
      await authApi.deleteAccount()
      setModal(null)
      logout()
      toast({ title: 'Account deleted', tone: 'info' })
      navigate('/')
    } catch (e) {
      setBusy(false)
      toast({ title: 'Could not delete account', description: e instanceof Error ? e.message : undefined, tone: 'error' })
    }
  }

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
          <Button variant="danger" loading={busy} onClick={doDelete}>Delete forever</Button>
        </div>
      </Modal>
    </Card>
  )
}

export { AccountSecurity }

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

/* ---------- Onboarding: completion card ---------- */
function ProfileCompletionCard({
  completion,
  skipped,
  onFocus,
  onSkip,
  onSkipEvidence,
}: {
  completion: ReturnType<typeof profileCompletion>
  skipped: Set<string>
  onFocus: (step: OnboardingStep) => void
  onSkip: (key: string) => void
  onSkipEvidence?: () => void
}) {
  const visibleOptional = completion.optional.filter((s) => !(skipped.has(s.key) || s.done))
  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">
            {completion.requiredComplete ? 'Profile completeness' : 'Finish setting up'}
          </h2>
          <span className="text-sm font-medium text-muted-foreground">{completion.overallPercent}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${completion.overallPercent}%` }} />
        </div>

        {!completion.requiredComplete && (
          <p className="text-xs font-medium text-primary">
            {completion.requiredTotal - completion.requiredDone} important {completion.requiredTotal - completion.requiredDone === 1 ? 'step' : 'steps'} to unlock your matches.
          </p>
        )}

        <ul className="space-y-1.5 text-sm">
          {completion.required.map((s) => {
            if (s.key === 'evidence' && !s.done) {
              return (
                <li key={s.key}>
                  <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => onFocus(s)}
                      className="flex flex-1 items-center gap-2 text-left transition-colors text-muted-foreground hover:bg-primary/5"
                    >
                      <Circle className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      <span className="flex-1 font-medium">{s.label}</span>
                      <span className="text-[11px] text-primary">Complete</span>
                    </button>
                    {onSkipEvidence && (
                      <button
                        type="button"
                        onClick={onSkipEvidence}
                        className="text-[11px] text-muted-foreground underline hover:text-foreground"
                      >
                        Skip
                      </button>
                    )}
                  </div>
                </li>
              )
            }
            return (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => onFocus(s)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
                    s.done ? 'text-foreground hover:bg-muted/40' : 'text-muted-foreground hover:bg-primary/5',
                  )}
                >
                  {s.done ? (
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-accent" />
                  ) : (
                    <Circle className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  )}
                  <span className={cn('flex-1', !s.done && 'font-medium')}>{s.label}</span>
                  {!s.done && <span className="text-[11px] text-primary">Complete</span>}
                </button>
              </li>
            )
          })}

          {visibleOptional.map((s) => (
            <li key={s.key}>
              <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                {s.done ? (
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-accent" />
                ) : (
                  <Circle className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                )}
                <span className={cn('flex-1 text-muted-foreground', s.done && 'text-foreground')}>{s.label}</span>
                {!s.done && (
                  <button
                    type="button"
                    onClick={() => onSkip(s.key)}
                    className="text-[11px] text-muted-foreground underline hover:text-foreground"
                  >
                    Skip for now
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>

        <p className="text-xs text-muted-foreground">
          {completion.requiredComplete
            ? 'Your important details are done — add the rest anytime to get better matches.'
            : 'Complete the important steps above to start exploring opportunities.'}
        </p>
      </CardBody>
    </Card>
  )
}

/* ---------- Onboarding: 3-question quick intake ---------- */
function OnboardingIntro({
  open,
  user,
  onClose,
  onSaved,
}: {
  open: boolean
  user: ProfileT
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(user.full_name ?? '')
  const [userType, setUserType] = useState<UserType | ''>(user.user_type ?? '')
  const [goal, setGoal] = useState(user.onboarding_goal ?? '')
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!userType) {
      toast({ title: 'Pick who you are', description: 'Choose Student, Employer, or University to continue.', tone: 'error' })
      return
    }
    setSaving(true)
    try {
      const updated = await profilesApi.update(user.id, {
        full_name: name.trim(),
        user_type: userType,
        onboarding_goal: goal,
      })
      if (updated) useSession.getState().setProfile(updated)
      onSaved()
    } catch (err) {
      toast({ title: 'Could not save', description: err instanceof Error ? err.message : undefined, tone: 'error' })
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} size="md" title="Welcome to Optryva" description="A few quick things so we can tailor your experience.">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label>What's your name?</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" required />
        </div>

        <div>
          <Label>I'm here as a…</Label>
          <div className="grid grid-cols-3 gap-2">
            {ROLE_OPTIONS.map((r) => {
              const on = userType === r.value
              return (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setUserType(r.value)}
                  aria-pressed={on}
                  className={cn(
                    'rounded-xl border p-3 text-center text-sm transition-colors',
                    on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40',
                  )}
                >
                  <span className="font-medium">{r.label}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">{r.hint}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <Label>Your first goal</Label>
          <div className="grid gap-2">
            {GOAL_OPTIONS.map((g) => {
              const on = goal === g.value
              return (
                <button
                  key={g.value}
                  type="button"
                  onClick={() => setGoal(g.value)}
                  aria-pressed={on}
                  className={cn(
                    'flex items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm transition-colors',
                    on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40',
                  )}
                >
                  <span>
                    <span className="font-medium">{g.label}</span>
                    <span className="block text-[11px] text-muted-foreground">{g.hint}</span>
                  </span>
                  {on && <CheckCircle2 className="h-4 w-4 flex-shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>I'll do this later</Button>
          <Button type="submit" loading={saving} disabled={!name.trim() || !goal}>
            {saving ? 'Saving…' : 'Continue'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
