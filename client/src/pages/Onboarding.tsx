import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  Award,
  Briefcase,
  Building2,
  Check,
  FileText,
  GraduationCap,
  Loader2,
  MapPin,
  Plus,
  Sparkles,
  Upload,
  User,
  X,
} from 'lucide-react'
import { Logo } from '@/components/Logo'
import { OnboardingMascot } from '@/components/OnboardingMascot'
import { Confetti } from '@/components/Confetti'
import { Button } from '@/components/ui/Button'
import { Input, Label, Textarea } from '@/components/ui/primitives'
import { CountryCombobox } from '@/components/ui/CountryCombobox'
import { useToast } from '@/components/ui/toast'
import { useCurrentUser, useSession } from '@/lib/store'
import { profilesApi, onboardingApi, authApi } from '@/lib/api'
import { fileToDataUrlWithProgress } from '@/lib/utils'
import { requiresProfileCompletion, ROLE_CHOICES } from '@/lib/onboarding'
import { playStep, playSuccess } from '@/lib/sound'
import type { UserType } from '@/types'

const WORK_OPTIONS = [
  { value: 'remote', label: 'Remote' },
  { value: 'onsite', label: 'On-site' },
  { value: 'hybrid', label: 'Hybrid' },
]
const INDUSTRIES = ['Technology', 'Finance', 'Healthcare', 'Agriculture', 'Education', 'E-commerce', 'Consulting', 'Nonprofit']
const LISTING_TYPES = ['Internship', 'Fellowship', 'Part-time', 'Full-time', 'Graduate role', 'Volunteer']
const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-1000', '1000+']

type StepId = 'about' | 'location' | 'education' | 'school' | 'company' | 'skills' | 'resume' | 'preferences'

const STEP_META: Record<StepId, { label: string; icon: typeof User; blurb: string }> = {
  about: { label: 'About you', icon: User, blurb: 'Just the basics — refine anytime.' },
  location: { label: 'Location & work', icon: MapPin, blurb: 'So we can match you to the right places.' },
  education: { label: 'Education', icon: GraduationCap, blurb: 'So schools and employers can find you.' },
  school: { label: 'Your institution', icon: Building2, blurb: 'Help students recognize and trust you.' },
  company: { label: 'Your company', icon: Briefcase, blurb: 'So we can match you with the right talent.' },
   skills: { label: 'Skills', icon: Sparkles, blurb: 'A few things you’re good at.' },
   resume: { label: 'Résumé', icon: FileText, blurb: 'Upload or paste — editable later.' },
   preferences: { label: 'Preferences', icon: Sparkles, blurb: 'So we match you to the right roles.' },
}

export default function Onboarding() {
  const navigate = useNavigate()
  const user = useCurrentUser()
  const { toast } = useToast()

  const userId = useSession((s) => s.userId)
  const setNeedsOnboarding = useSession((s) => s.setNeedsOnboarding)
  if (!userId) return <Navigate to="/login" replace />
  // Already finished the required steps → go straight to the app.
  if (user && !requiresProfileCompletion(user)) return <Navigate to="/app/profile" replace />

  // This user is in the wizard because they're a new account (flagged ?new=1 by
  // register / the OAuth callback). Mirror that into the persisted
  // `needsOnboarding` flag so a refresh or navigating away can't let them skip
  // the required steps — the router re-holds them here until they finish.
  useEffect(() => {
    if (userId) setNeedsOnboarding(userId, true)
  }, [userId, setNeedsOnboarding])

  const [step, setStep] = useState(1)
  const [userType, setUserType] = useState<UserType | ''>(user?.user_type ?? '')
  const [name, setName] = useState(user?.full_name ?? '')
  const [goal, setGoal] = useState(user?.onboarding_goal ?? '')
  const [country, setCountry] = useState(user?.country ?? user?.location ?? '')
  const [workType, setWorkType] = useState(user?.work_type ?? '')
  const [school, setSchool] = useState(user?.school ?? '')
  const [major, setMajor] = useState(user?.major ?? '')
  const [gpa, setGpa] = useState(user?.gpa ?? '')
  const [bio, setBio] = useState(user?.bio ?? '')
  const [studentDomains, setStudentDomains] = useState(
    Array.isArray(user?.student_domains) ? (user?.student_domains as string[]).join(', ') : '',
  )
  const [industry, setIndustry] = useState(user?.industry ?? '')
  const [companySize, setCompanySize] = useState(user?.company_size ?? '')
  const [skills, setSkills] = useState<string[]>(user?.skills ?? [])
  const [skillInput, setSkillInput] = useState('')
  const [desiredRoles, setDesiredRoles] = useState<string[]>(user?.desired_roles ?? [])
  const [roleInput, setRoleInput] = useState('')
  const [preferredIndustries, setPreferredIndustries] = useState<string[]>(user?.preferred_industries ?? [])
  const [prefCountries, setPrefCountries] = useState<string[]>(user?.pref_countries ?? [])
  const [countryInput, setCountryInput] = useState('')
  const [prefListingTypes, setPrefListingTypes] = useState<string[]>(user?.pref_listing_types ?? [])
  const [cvUrl, setCvUrl] = useState<string | undefined>(user?.cv_url ?? undefined)
  const [cvText, setCvText] = useState(user?.cv_text ?? '')
  const [cvFilename, setCvFilename] = useState<string | null>(user?.cv_filename ?? null)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [celebrating, setCelebrating] = useState(false)

  const hasResume = !!(cvUrl || cvText.trim())

  // Each role gets a tailored flow — students build a candidate profile
  // (education, skills, résumé); employers and institutions skip the
  // résumé/applicant-skills steps entirely. The role is already known from
  // signup, so there is no redundant "who you are" step.
  const steps: { id: StepId; label: string }[] = [{ id: 'about', label: 'About you' }]
  if (userType === 'student') {
    steps.push(
      { id: 'education', label: 'Education' },
      { id: 'skills', label: 'Skills' },
      { id: 'resume', label: 'Résumé' },
      { id: 'preferences', label: 'Preferences' },
    )
  } else if (userType === 'school') {
    steps.push({ id: 'school', label: 'Your institution' })
  } else if (userType === 'company') {
    steps.push({ id: 'company', label: 'Your company' })
  }
  steps.push({ id: 'location', label: 'Location & work' })

  const current = steps[Math.min(step, steps.length) - 1]
  const isLast = step === steps.length
  const meta = STEP_META[current.id]
  const progress = Math.round((step / steps.length) * 100)

  async function patchProfile(patch: Record<string, unknown>) {
    if (!user) return
    const updated = await profilesApi.update(user.id, patch)
    if (updated) useSession.getState().setProfile(updated)
  }

  function goNext() {
    playStep()
    setStep((s) => Math.min(steps.length, s + 1))
  }
  function goBack() {
    setStep((s) => Math.max(1, s - 1))
  }

  function addSkill() {
    const s = skillInput.trim()
    if (s && !skills.includes(s)) setSkills([...skills, s])
    setSkillInput('')
  }
  function removeSkill(s: string) {
    setSkills(skills.filter((x) => x !== s))
  }

  function addRole() {
    const s = roleInput.trim()
    if (s && !desiredRoles.includes(s)) setDesiredRoles([...desiredRoles, s])
    setRoleInput('')
  }
  function addCountry() {
    const s = countryInput.trim()
    if (s && !prefCountries.includes(s)) setPrefCountries([...prefCountries, s])
    setCountryInput('')
  }
  function toggleIndustry(ind: string) {
    setPreferredIndustries((prev) => (prev.includes(ind) ? prev.filter((x) => x !== ind) : [...prev, ind]))
  }
  function toggleListingType(t: string) {
    setPrefListingTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
  }

  async function handleNext() {
    try {
      if (current.id === 'about') {
        if (!name.trim()) return toast({ title: 'Add your name', tone: 'error' })
        if (!goal) return toast({ title: 'Choose a goal', tone: 'error' })
        await patchProfile({ full_name: name.trim(), onboarding_goal: goal, user_type: userType })
        goNext()
      } else if (current.id === 'education') {
        if (!school.trim()) return toast({ title: 'Add your school', tone: 'error' })
        if (!major.trim()) return toast({ title: 'Add your major', tone: 'error' })
        if (!gpa.trim()) return toast({ title: 'Add your GPA or grades', tone: 'error' })
        await patchProfile({ school: school.trim(), major: major.trim(), gpa: gpa.trim() })
        goNext()
      } else if (current.id === 'school') {
        if (!bio.trim()) return toast({ title: 'Add a short description', tone: 'error' })
        await patchProfile({
          bio: bio.trim(),
          student_domains: studentDomains
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        })
        goNext()
      } else if (current.id === 'company') {
        if (!industry) return toast({ title: 'Choose an industry', tone: 'error' })
        if (!companySize) return toast({ title: 'Choose a company size', tone: 'error' })
        await patchProfile({ industry, company_size: companySize })
        goNext()
      } else if (current.id === 'location') {
        if (!country.trim()) return toast({ title: 'Choose your country', tone: 'error' })
        if (!workType) return toast({ title: 'Choose a work preference', tone: 'error' })
        await patchProfile({ country: country.trim(), location: country.trim(), work_type: workType })
        goNext()
      } else if (current.id === 'skills') {
        if (skills.length === 0) return toast({ title: 'Add at least one skill', tone: 'error' })
        await patchProfile({ skills })
        goNext()
      } else if (current.id === 'resume') {
        if (!hasResume) return toast({ title: 'Add a résumé or paste your experience', tone: 'error' })
        goNext()
      } else if (current.id === 'preferences') {
        if (
          desiredRoles.length === 0 &&
          preferredIndustries.length === 0 &&
          prefCountries.length === 0 &&
          prefListingTypes.length === 0
        )
          return toast({ title: 'Pick at least one preference', tone: 'error' })
        await patchProfile({
          desired_roles: desiredRoles,
          preferred_industries: preferredIndustries,
          pref_countries: prefCountries,
          pref_listing_types: prefListingTypes,
        })
        goNext()
      }
    } catch (e) {
      toast({ title: "Couldn't save", description: e instanceof Error ? e.message : undefined, tone: 'error' })
    }
  }

  async function attachCv(file?: File | null) {
    if (!file) return
    try {
      setUploadProgress(0)
      const url = await fileToDataUrlWithProgress(file, setUploadProgress)
      setCvUrl(url)
      setCvFilename(file.name)
      setCvText('')
      toast({ title: 'Attached', description: file.name, tone: 'success' })
      setTimeout(() => setUploadProgress(null), 500)
    } catch (e) {
      setUploadProgress(null)
      toast({ title: "Couldn't read file", description: e instanceof Error ? e.message : undefined, tone: 'error' })
    }
  }

  async function finish() {
    if (!hasResume) return toast({ title: 'Add a résumé or paste your experience', tone: 'error' })
    setSaving(true)
    try {
      await patchProfile({
        user_type: userType,
        full_name: name.trim(),
        onboarding_goal: goal,
        country: country.trim(),
        location: country.trim(),
        work_type: workType,
        school: school.trim(),
        major: major.trim(),
        gpa: gpa.trim(),
        skills,
        ...(userType === 'school'
          ? {
              bio: bio.trim(),
              student_domains: studentDomains.split(',').map((s) => s.trim()).filter(Boolean),
            }
          : {}),
        ...(userType === 'company' ? { industry, company_size: companySize } : {}),
        ...(userType === 'student'
          ? {
              desired_roles: desiredRoles,
              preferred_industries: preferredIndustries,
              pref_countries: prefCountries,
              pref_listing_types: prefListingTypes,
            }
          : {}),
      })
      await onboardingApi.saveResume(cvText.trim() || undefined, cvUrl, cvFilename ?? undefined)
      // Refresh the cached profile so the completion gate sees the résumé and
      // doesn't bounce us straight back to onboarding.
      const refreshed = await authApi.me()
      if (refreshed) useSession.getState().setProfile(refreshed)
      // Mark onboarding complete so the router never forces this user through
      // the wizard again.
      if (userId) useSession.getState().setNeedsOnboarding(userId, false)
      setCelebrating(true)
      playSuccess()
      toast({ title: "You're all set!", description: 'Taking you to your profile…', tone: 'success' })
      setTimeout(() => navigate('/app/profile', { replace: true }), 1500)
    } catch (e) {
      toast({ title: "Couldn't finish", description: e instanceof Error ? e.message : undefined, tone: 'error' })
      setSaving(false)
    }
  }

  return (
    <div className="mesh-bg min-h-screen">
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 py-10 sm:px-6">
        <header className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <Logo className="h-10 w-10" />
            <span className="text-2xl font-bold tracking-tight">Optryva</span>
          </Link>
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">Step {step} of {steps.length}</span>
        </header>

        {/* progress */}
        <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <motion.div
            className="h-full rounded-full bg-primary"
            animate={{ width: `${progress}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 20 }}
          />
        </div>

        {/* step indicators (compact — the current step name shows in the card) */}
        <div className="mt-5 flex items-center gap-2">
          {steps.map((s, i) => {
            const n = i + 1
            const active = n === step
            const done = n < step
            const Icon = STEP_META[s.id].icon
            return (
              <div key={s.id} className="flex flex-1 items-center gap-2">
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                    done
                      ? 'bg-primary text-primary-foreground'
                      : active
                        ? 'bg-primary/15 text-primary ring-2 ring-primary'
                        : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                </div>
                {n < steps.length && <div className={`h-0.5 flex-1 rounded ${done ? 'bg-primary' : 'bg-muted'}`} />}
              </div>
            )
          })}
        </div>

        {/* card */}
        <div className="mt-6 flex-1 rounded-2xl border border-border bg-card p-6 shadow-card sm:p-8">
          <div className="mb-6 flex flex-col items-center text-center">
            <OnboardingMascot key={step} celebrating={celebrating} className="mb-3 h-16 w-16" />
            <h1 className="text-xl font-bold tracking-tight">{step === 1 ? 'What brings you here?' : meta.label}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{step === 1 ? 'Pick the option that fits you best.' : meta.blurb}</p>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={current.id}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            >
          {current.id === 'about' && (
            <div className="space-y-5">
              <div>
                <Label>What brings you here?</Label>
                <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
                  {ROLE_CHOICES.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => {
                        setUserType(r.value)
                        setGoal(r.goal)
                      }}
                      className={`rounded-xl border p-3 text-left text-sm transition-colors ${
                        userType === r.value ? 'border-primary bg-primary/5 ring-2 ring-primary/30' : 'border-border hover:border-primary/40 hover:bg-muted/50'
                      }`}
                    >
                      <span className="mb-1 block text-2xl leading-none">{r.icon}</span>
                      <span className="block font-semibold">{r.label}</span>
                      <span className="text-xs text-muted-foreground">{r.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label htmlFor="name">{userType === 'company' ? 'Company name' : userType === 'school' ? 'University name' : 'Your name'}</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={userType === 'company' ? 'e.g. Acme Labs' : userType === 'school' ? 'e.g. University of Nairobi' : 'e.g. Alex Rivera'} className="mt-1.5 bg-background" />
              </div>
            </div>
          )}

          {current.id === 'location' && (
            <div className="space-y-5">
              <div>
                <Label htmlFor="country">Country</Label>
                <CountryCombobox id="country" value={country} onChange={setCountry} placeholder="Search countries…" className="mt-1.5 bg-background" />
              </div>
              <div>
                <Label>Work preference</Label>
                <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
                  {WORK_OPTIONS.map((w) => (
                    <button
                      key={w.value}
                      type="button"
                      onClick={() => setWorkType(w.value)}
                      className={`rounded-xl border p-3 text-sm font-medium transition-colors ${
                        workType === w.value ? 'border-primary bg-primary/5 ring-2 ring-primary/30' : 'border-border hover:border-primary/40 hover:bg-muted/50'
                      }`}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {current.id === 'education' && (
            <div className="space-y-5">
              <div>
                <Label htmlFor="school">School / University</Label>
                <Input id="school" value={school} onChange={(e) => setSchool(e.target.value)} placeholder="e.g. University of Nairobi" className="mt-1.5 bg-background" />
              </div>
              <div>
                <Label htmlFor="major">Major / field of study</Label>
                <Input id="major" value={major} onChange={(e) => setMajor(e.target.value)} placeholder="e.g. Computer Science" className="mt-1.5 bg-background" />
              </div>
              <div>
                <Label htmlFor="gpa">GPA / grades</Label>
                <Input
                  id="gpa"
                  value={gpa}
                  onChange={(e) => setGpa(e.target.value)}
                  placeholder="e.g. 3.8/4.0 or Second Class Upper"
                  className="mt-1.5 bg-background"
                />
              </div>
            </div>
          )}

          {current.id === 'school' && (
            <div className="space-y-5">
              <div>
                <Label htmlFor="bio">About your institution</Label>
                <p className="mb-1.5 text-xs text-muted-foreground">A short description students will see on your page. This is required.</p>
                <Textarea
                  id="bio"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="e.g. A public research university focused on engineering and agriculture…"
                  rows={4}
                  className="bg-background"
                />
              </div>
              <div>
                <Label htmlFor="domains">Student email domains <span className="text-muted-foreground">(optional)</span></Label>
                <Input
                  id="domains"
                  value={studentDomains}
                  onChange={(e) => setStudentDomains(e.target.value)}
                  placeholder="e.g. student.example.edu, example.ac.ug"
                  className="mt-1.5 bg-background"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Optional. List the email domains your students use (e.g. student.ALU.edu, alu.ac.rw). We use them to privately verify and match
                  your students — your institution stays visible to everyone either way. You can add this later from your profile.
                </p>
              </div>
            </div>
          )}

          {current.id === 'company' && (
            <div className="space-y-5">
              <div>
                <Label>Industry</Label>
                <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                  {INDUSTRIES.map((ind) => (
                    <button
                      key={ind}
                      type="button"
                      onClick={() => setIndustry(ind)}
                      className={`rounded-xl border p-3 text-left text-sm font-medium transition-colors ${
                        industry === ind ? 'border-primary bg-primary/5 ring-2 ring-primary/30' : 'border-border hover:border-primary/40 hover:bg-muted/50'
                      }`}
                    >
                      {ind}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Company size</Label>
                <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
                  {COMPANY_SIZES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setCompanySize(s)}
                      className={`rounded-xl border p-3 text-sm font-medium transition-colors ${
                        companySize === s ? 'border-primary bg-primary/5 ring-2 ring-primary/30' : 'border-border hover:border-primary/40 hover:bg-muted/50'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {current.id === 'skills' && (
            <div>
              <div className="flex flex-wrap gap-2">
                {skills.map((s) => (
                  <span key={s} className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary">
                    {s}
                    <button type="button" onClick={() => removeSkill(s)} aria-label={`Remove ${s}`} className="rounded-full p-0.5 hover:bg-primary/15">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
                {skills.length === 0 && <p className="text-sm text-muted-foreground">No skills yet — add a few below.</p>}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  addSkill()
                }}
                className="mt-4 flex gap-2"
              >
                <Input
                  value={skillInput}
                  onChange={(e) => setSkillInput(e.target.value)}
                  placeholder="e.g. Python, Design, Public Speaking"
                  className="bg-background"
                />
                <Button type="submit" variant="outline" size="icon" aria-label="Add skill">
                  <Plus className="h-4 w-4" />
                </Button>
              </form>
            </div>
          )}

          {current.id === 'resume' && (
            <div className="space-y-4">
              <label className="flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-input bg-muted/30 p-8 text-center transition-colors hover:border-primary/50 hover:bg-primary/5">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Upload className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-medium">Upload your résumé</p>
                  <p className="text-xs text-muted-foreground">PDF or Word</p>
                </div>
                <input type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => attachCv(e.target.files?.[0])} />
              </label>

              {uploadProgress !== null && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                    <span>Uploading résumé…</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {cvFilename && cvUrl && (
                <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/5 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-success/15 text-success">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{cvFilename}</p>
                    <p className="text-xs text-muted-foreground">Attached</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => { setCvUrl(undefined); setCvFilename(null) }}>Remove</Button>
                </div>
              )}

              <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                or paste
                <div className="h-px flex-1 bg-border" />
              </div>

              <Textarea
                value={cvText}
                onChange={(e) => { setCvText(e.target.value); if (e.target.value.trim()) { setCvUrl(undefined); setCvFilename(null) } }}
                placeholder="Paste your experience, skills, and education…"
                rows={6}
                className="bg-background"
              />
            </div>
          )}

          {current.id === 'preferences' && (
            <div className="space-y-5">
              <div>
                <Label>Career direction — roles you want</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {desiredRoles.map((r) => (
                    <span key={r} className="flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-sm text-primary">
                      {r}
                      <button type="button" onClick={() => setDesiredRoles(desiredRoles.filter((x) => x !== r))}>
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
                <Input
                  value={roleInput}
                  onChange={(e) => setRoleInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addRole()
                    }
                  }}
                  placeholder="e.g. Data Analyst, Product Manager"
                  className="mt-2 bg-background"
                />
              </div>

              <div>
                <Label>Preferred industries</Label>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {INDUSTRIES.map((ind) => {
                    const active = preferredIndustries.includes(ind)
                    return (
                      <button
                        key={ind}
                        type="button"
                        onClick={() => toggleIndustry(ind)}
                        className={`rounded-xl border px-3 py-2 text-sm transition-colors active:scale-95 ${
                          active ? 'border-primary bg-primary/10 text-primary' : 'border-input bg-background hover:border-primary/40'
                        }`}
                      >
                        {ind}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <Label>Preferred countries</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {prefCountries.map((c) => (
                    <span key={c} className="flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-sm text-primary">
                      {c}
                      <button type="button" onClick={() => setPrefCountries(prefCountries.filter((x) => x !== c))}>
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
                <Input
                  value={countryInput}
                  onChange={(e) => setCountryInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addCountry()
                    }
                  }}
                  placeholder="Type a country and press Enter"
                  className="mt-2 bg-background"
                />
              </div>

              <div>
                <Label>Opportunity types</Label>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {LISTING_TYPES.map((t) => {
                    const active = prefListingTypes.includes(t)
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => toggleListingType(t)}
                        className={`rounded-xl border px-3 py-2 text-sm transition-colors active:scale-95 ${
                          active ? 'border-primary bg-primary/10 text-primary' : 'border-input bg-background hover:border-primary/40'
                        }`}
                      >
                        {t}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
          </motion.div>
        </AnimatePresence>
        </div>

        {/* footer */}
        <div className="mt-6 flex items-center justify-between">
          <Button variant="ghost" onClick={goBack} disabled={step === 1 || saving} className="active:scale-95 transition-transform">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          {!isLast ? (
            <Button onClick={handleNext} className="active:scale-95 transition-transform">
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={finish} disabled={saving} className="active:scale-95 transition-transform">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Award className="h-4 w-4" />} Finish & go to profile
            </Button>
          )}
        </div>
      </div>
      {celebrating && (
        <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center">
          <Confetti />
        </div>
      )}
    </div>
  )
}
