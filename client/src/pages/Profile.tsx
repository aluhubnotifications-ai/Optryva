import { useRef, useState, useEffect } from 'react'
import { motion } from 'framer-motion'
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
  Camera,
  Eye,
  Compass,
  CheckCircle2,
  Circle,
  Loader2,
} from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTransitionNavigate } from '@/lib/useTransitionNavigate'
import { useCurrentUser, useSession } from '@/lib/store'
import { useMatchRun } from '@/lib/matchRun'
import { fetchProtectedDocument, profilesApi, resumesApi, evidenceApi, authApi } from '@/lib/api'
import { profileCompletion, setEvidenceDeclined, isEvidenceDeclined, type OnboardingStep } from '@/lib/onboarding'
import type { Profile as ProfileT, WorkType, ListingType, ResumeProfile } from '@/types'
import { Card, CardBody, Badge, Avatar, Input, Label, Textarea, Select } from '@/components/ui/primitives'
import { CountryCombobox } from '@/components/ui/CountryCombobox'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { AvatarEditor } from '@/components/AvatarEditor'
import { CoverEditor } from '@/components/CoverEditor'
import { useToast } from '@/components/ui/toast'
import { formatDate, cn, fileToDataUrl } from '@/lib/utils'
import { ResumeWorkspace } from '@/components/ResumeWorkspace'
import { EvidenceGallery } from '@/components/EvidenceGallery'
import { CountryMultiSelect } from '@/components/ui/CountryMultiSelect'

const ROLES = ['Software Engineering', 'Data Science', 'Product Management', 'Marketing', 'Operations', 'Finance', 'Design', 'Consulting']
const INDUSTRIES = ['Technology', 'Finance', 'Healthcare', 'Agriculture', 'Education', 'E-commerce', 'Consulting', 'Nonprofit']
const LISTING_TYPES: ListingType[] = ['Internship', 'Full-time', 'Part-time', 'Fellowship']

export default function Profile() {
  const user = useCurrentUser()!
  const { toast } = useToast()
  const cvRef = useRef<HTMLInputElement>(null)
  const [, force] = useState(0)
  const [skillInput, setSkillInput] = useState('')
  const [confirmRemoveCv, setConfirmRemoveCv] = useState(false)
  const [params] = useSearchParams()
  const [tab, setTab] = useState<'profile' | 'resumes' | 'gallery'>(() => {
    const t = params.get('tab')
    return t === 'resumes' || t === 'gallery' ? t : 'profile'
  })
  // Deep-link support so the reminder modal can jump straight to the exact field:
  // ?tab=gallery → portfolio, ?tab=resumes → résumés, ?focus=preferences → prefs.
  useEffect(() => {
    const focus = params.get('focus')
    if (!focus) return
    const id = `${focus}-section`
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80)
    return () => clearTimeout(t)
  }, [params])
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
  // Guidance lives in the sidebar (ProfileCompletionCard) — not as a top banner —
  // so it never eats the upper area like the company profile.

  async function changePicture(avatar_url: string) {
    const updated = await profilesApi.update(user.id, { avatar_url })
    if (updated) useSession.getState().setProfile(updated)
    toast({ title: 'Profile picture updated', tone: 'success' })
  }

  async function changeCover(cover_url: string) {
    const updated = await profilesApi.update(user.id, { cover_url })
    if (updated) useSession.getState().setProfile(updated)
    toast({ title: cover_url ? 'Cover updated' : 'Cover removed', tone: 'success' })
  }

  // Editable copy
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

  // Per-field autosave. A single in-flight timer per field so fast typing
  // doesn't hammer the API; each debounced write updates the persisted session
  // so the rest of the app sees the new value immediately.
  const AUTOSAVE_DELAY = 600
  const saveTimers = useRef<Map<string, number>>(new Map())
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle')

  function setFormField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    autoSave({ [key]: value } as Partial<ProfileT>)
  }

  function autoSave(patch: Partial<ProfileT>) {
    setSaved('saving')
    const k = Object.keys(patch)[0]!
    clearTimeout(saveTimers.current.get(k))
    saveTimers.current.set(k, window.setTimeout(async () => {
      saveTimers.current.delete(k)
      try {
        const updated = await profilesApi.update(user.id, patch)
        if (updated) useSession.getState().setProfile(updated)
        setSaved('saved')
        setTimeout(() => setSaved('idle'), 2500)
      } catch {
        setSaved('idle')
      }
    }, AUTOSAVE_DELAY))
  }

  function toggle<T extends string>(list: T[], set: (v: T[]) => void, v: T, field: keyof ProfileT) {
    const next = list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
    set(next)
    autoSave({ [field]: next } as Partial<ProfileT>)
  }

  // Jump the student to whichever field the onboarding step is about.
  function focusStep(step: OnboardingStep) {
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
    if (s && !skills.includes(s)) {
      const next = [...skills, s]
      setSkills(next)
      autoSave({ skills: next })
    }
    setSkillInput('')
  }

  function removeSkill(s: string) {
    const next = skills.filter((x) => x !== s)
    setSkills(next)
    autoSave({ skills: next })
  }



  return (
    <motion.div
      className="mx-auto max-w-6xl"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
      {/* Cover + identity — mirrors the company profile: one rounded card with the
          cover inside and the avatar overlapping, so nothing eats the upper area. */}
      <Card className="overflow-hidden">
        <CoverEditor src={user.cover_url} isSchool={false} onChange={changeCover} />
        <CardBody className="-mt-12 pt-0">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <AvatarEditor name={user.full_name} src={user.avatar_url} size={96} rounded="rounded-2xl" className="ring-4 ring-card" onChange={changePicture} />
            <ProfileSaveStatus saved={saved} />
          </div>
          <div className="mt-3 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{user.full_name}</h1>
              {user.plan !== 'free' && <Badge tone="primary" className="gap-1"><Crown className="h-3 w-3" /> {user.plan.toUpperCase()}</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">{user.major}{user.school ? ` · ${user.school}` : ''}</p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
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
          <div><Label>Full name</Label><Input value={form.full_name} onChange={(e) => setFormField('full_name', e.target.value)} /></div>
          <div><Label>Bio</Label><Textarea value={form.bio} onChange={(e) => setFormField('bio', e.target.value)} placeholder="A short intro about you…" /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label>School / University</Label><Input value={form.school} onChange={(e) => setFormField('school', e.target.value)} /></div>
            <div><Label>Major</Label><Input value={form.major} onChange={(e) => setFormField('major', e.target.value)} /></div>
            <div>
              <Label>Year of study</Label>
              <Select value={form.graduated ? 'grad' : form.year} onChange={(e) => {
                const v = e.target.value
                if (v === 'grad') {
                  setFormField('graduated', true)
                  setForm((f) => ({ ...f, year: '' }))
                  autoSave({ graduated: true, year: undefined })
                } else {
                  setFormField('graduated', false)
                  setForm((f) => ({ ...f, year: v }))
                  autoSave({ graduated: false, year: Number(v) })
                }
              }}>
                <option value="">—</option>
                {[1, 2, 3, 4].map((y) => <option key={y} value={y}>Year {y}</option>)}
                <option value="grad">Graduate</option>
              </Select>
            </div>
            <div>
              <Label>Country</Label>
              <CountryCombobox value={form.country} onChange={(v) => setFormField('country', v)} placeholder="Select your country" />
            </div>
            <div><Label>Location</Label><Input value={form.location} onChange={(e) => setFormField('location', e.target.value)} placeholder="City, Country" /></div>
            <div><Label>GPA</Label><Input value={form.gpa} onChange={(e) => setFormField('gpa', e.target.value)} placeholder="e.g. 3.8/4.0 or Second Class Upper" /></div>
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
      <Section id="preferences-section" icon={Briefcase} title="Career preferences" hint="Feeds the AI matching engine">
        <Label>Roles I'm interested in</Label>
        <ChipGroup options={ROLES} selected={roles} onToggle={(v) => toggle(roles, setRoles, v, 'desired_roles')} />
        <Label className="mt-4">Industries</Label>
        <ChipGroup options={INDUSTRIES} selected={industries} onToggle={(v) => toggle(industries, setIndustries, v, 'preferred_industries')} />

        <Label className="mt-4">Opportunity types I want</Label>
        <p className="mb-1.5 text-xs text-muted-foreground">We'll only match these. Leave empty to consider every type.</p>
        <ChipGroup options={LISTING_TYPES} selected={prefTypes} onToggle={(v) => {
          const next = prefTypes.includes(v) ? prefTypes.filter((x) => x !== v) : [...prefTypes, v]
          setPrefTypes(next)
          autoSave({
            pref_listing_types: next as ListingType[],
            open_to_internship: next.length === 0 || next.includes('Internship'),
            open_to_fulltime: next.length === 0 || next.some((t) => t !== 'Internship'),
          })
        }} />

        <Label className="mt-4">Countries I'd work in</Label>
        <p className="mb-1.5 text-xs text-muted-foreground">Pick where you'd like to work — we won't match roles outside these. Remote roles always count, and leaving this empty means anywhere.</p>
        <CountryMultiSelect value={prefCountries} onChange={(v) => { setPrefCountries(v); autoSave({ pref_countries: v }) }} includeRemote placeholder="Search countries to add…" />

        <div className="mt-4">
          <Label>Work type</Label>
          <Select value={form.work_type} onChange={(e) => setFormField('work_type', e.target.value as WorkType)} className="max-w-xs">
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
            onChange={(e) => {
              const v = e.target.checked
              setMonitorConsent(v)
              autoSave({ monitoring_consent: v })
            }}
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
      </Section>

      {/* Social */}
      <Section id="links-section" icon={Link2} title="Links">
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label>LinkedIn</Label><Input value={form.linkedin} onChange={(e) => setFormField('linkedin', e.target.value)} placeholder="https://linkedin.com/in/…" /></div>
          <div><Label>GitHub</Label><Input value={form.github} onChange={(e) => setFormField('github', e.target.value)} placeholder="https://github.com/…" /></div>
          <div><Label>Twitter / X</Label><Input value={form.twitter} onChange={(e) => setFormField('twitter', e.target.value)} /></div>
          <div><Label>Website</Label><Input value={form.website} onChange={(e) => setFormField('website', e.target.value)} /></div>
        </div>
      </Section>

      <ProfileSaveStatus saved={saved} />

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
    </motion.div>
  )
}

function ProfileSaveStatus({ saved }: { saved: 'idle' | 'saving' | 'saved' }) {
  if (saved === 'idle') return null
  return (
    <div className="inline-flex items-center gap-2 rounded-full bg-muted/60 px-3 py-1.5 text-sm">
      {saved === 'saving' ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span className="text-muted-foreground">Saving…</span>
        </>
      ) : (
        <>
          <CheckCircle2 className="h-4 w-4 text-accent" />
          <span className="text-foreground">All changes saved</span>
        </>
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
  const navigate = useTransitionNavigate()
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


