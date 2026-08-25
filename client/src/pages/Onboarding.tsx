import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Award,
  Briefcase,
  Check,
  FileText,
  GraduationCap,
  Landmark,
  Loader2,
  MapPin,
  Plus,
  Sparkles,
  Upload,
  User,
  X,
} from 'lucide-react'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/Button'
import { Input, Label, Textarea } from '@/components/ui/primitives'
import { CountryCombobox } from '@/components/ui/CountryCombobox'
import { useToast } from '@/components/ui/toast'
import { useCurrentUser, useSession } from '@/lib/store'
import { profilesApi, onboardingApi, authApi } from '@/lib/api'
import { fileToDataUrl } from '@/lib/utils'
import { requiresProfileCompletion, ROLE_OPTIONS, GOAL_OPTIONS } from '@/lib/onboarding'
import type { UserType } from '@/types'

const WORK_OPTIONS = [
  { value: 'remote', label: 'Remote' },
  { value: 'onsite', label: 'On-site' },
  { value: 'hybrid', label: 'Hybrid' },
]

const ROLE_ICONS: Record<UserType, typeof GraduationCap> = {
  student: GraduationCap,
  company: Briefcase,
  school: Landmark,
}

type StepId = 'role' | 'about' | 'location' | 'education' | 'skills' | 'resume'

const STEP_META: Record<StepId, { label: string; icon: typeof User; blurb: string }> = {
  role: { label: 'Who you are', icon: User, blurb: 'This shapes your experience.' },
  about: { label: 'About you', icon: User, blurb: 'Just the basics — refine anytime.' },
  location: { label: 'Location & work', icon: MapPin, blurb: 'So we can match you to the right places.' },
  education: { label: 'Education', icon: GraduationCap, blurb: 'So schools and employers can find you.' },
  skills: { label: 'Skills', icon: Sparkles, blurb: 'A few things you’re good at.' },
  resume: { label: 'Résumé', icon: FileText, blurb: 'Upload or paste — editable later.' },
}

export default function Onboarding() {
  const navigate = useNavigate()
  const user = useCurrentUser()
  const { toast } = useToast()

  const userId = useSession((s) => s.userId)
  if (!userId) return <Navigate to="/login" replace />
  // Already finished the required steps → go straight to the app.
  if (user && !requiresProfileCompletion(user)) return <Navigate to="/app/profile" replace />

  const [step, setStep] = useState(1)
  const [userType, setUserType] = useState<UserType | ''>(user?.user_type ?? '')
  const [name, setName] = useState(user?.full_name ?? '')
  const [goal, setGoal] = useState(user?.onboarding_goal ?? '')
  const [country, setCountry] = useState(user?.country ?? user?.location ?? '')
  const [workType, setWorkType] = useState(user?.work_type ?? '')
  const [school, setSchool] = useState(user?.school ?? '')
  const [major, setMajor] = useState(user?.major ?? '')
  const [gpa, setGpa] = useState(user?.gpa ?? '')
  const [skills, setSkills] = useState<string[]>(user?.skills ?? [])
  const [skillInput, setSkillInput] = useState('')
  const [cvUrl, setCvUrl] = useState<string | undefined>(user?.cv_url ?? undefined)
  const [cvText, setCvText] = useState(user?.cv_text ?? '')
  const [cvFilename, setCvFilename] = useState<string | null>(user?.cv_filename ?? null)
  const [saving, setSaving] = useState(false)

  const hasResume = !!(cvUrl || cvText.trim())

  // Steps adapt to the chosen role — only students answer the education step.
  const steps: { id: StepId; label: string }[] = [
    { id: 'role', label: 'Who you are' },
    { id: 'about', label: 'About you' },
    { id: 'location', label: 'Location & work' },
  ]
  if (userType === 'student') steps.push({ id: 'education', label: 'Education' })
  steps.push({ id: 'skills', label: 'Skills' }, { id: 'resume', label: 'Résumé' })

  const current = steps[Math.min(step, steps.length) - 1]
  const isLast = step === steps.length
  const meta = STEP_META[current.id]
  const StepIcon = meta.icon
  const progress = Math.round((step / steps.length) * 100)

  async function patchProfile(patch: Record<string, unknown>) {
    if (!user) return
    const updated = await profilesApi.update(user.id, patch)
    if (updated) useSession.getState().setProfile(updated)
  }

  function goNext() {
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

  async function handleNext() {
    try {
      if (current.id === 'role') {
        if (!userType) return toast({ title: 'Pick who you are', tone: 'error' })
        await patchProfile({ user_type: userType })
        goNext()
      } else if (current.id === 'about') {
        if (!name.trim()) return toast({ title: 'Add your name', tone: 'error' })
        if (!goal) return toast({ title: 'Choose a goal', tone: 'error' })
        await patchProfile({ full_name: name.trim(), onboarding_goal: goal })
        goNext()
      } else if (current.id === 'education') {
        if (!school.trim()) return toast({ title: 'Add your school', tone: 'error' })
        if (!major.trim()) return toast({ title: 'Add your major', tone: 'error' })
        if (!gpa.trim()) return toast({ title: 'Add your GPA or grades', tone: 'error' })
        await patchProfile({ school: school.trim(), major: major.trim(), gpa: gpa.trim() })
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
      }
    } catch (e) {
      toast({ title: "Couldn't save", description: e instanceof Error ? e.message : undefined, tone: 'error' })
    }
  }

  async function attachCv(file?: File | null) {
    if (!file) return
    try {
      const url = await fileToDataUrl(file)
      setCvUrl(url)
      setCvFilename(file.name)
      setCvText('')
      toast({ title: 'Attached', description: file.name, tone: 'success' })
    } catch (e) {
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
      })
      await onboardingApi.saveResume(cvText.trim() || undefined, cvUrl, cvFilename ?? undefined)
      // Refresh the cached profile so the completion gate sees the résumé and
      // doesn't bounce us straight back to onboarding.
      const refreshed = await authApi.me()
      if (refreshed) useSession.getState().setProfile(refreshed)
      toast({ title: "You're all set", description: 'Finish the rest anytime from your profile.', tone: 'success' })
      navigate('/app/profile', { replace: true })
    } catch (e) {
      toast({ title: "Couldn't finish", description: e instanceof Error ? e.message : undefined, tone: 'error' })
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/[0.07]">
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 py-8 sm:px-6">
        <header className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <Logo className="h-11 w-11" />
            <span className="text-2xl font-bold tracking-tight">Optryva</span>
          </Link>
          <span className="rounded-full bg-muted px-3.5 py-1.5 text-sm font-medium text-muted-foreground">Step {step} of {steps.length}</span>
        </header>

        {/* progress */}
        <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>

        {/* step pills */}
        <div className="mt-5 flex items-center gap-2">
          {steps.map((s, i) => {
            const n = i + 1
            const active = n === step
            const done = n < step
            const Icon = STEP_META[s.id].icon
            return (
              <div key={s.id} className="flex flex-1 items-center gap-2">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                    done
                      ? 'bg-primary text-primary-foreground'
                      : active
                        ? 'bg-primary/15 text-primary ring-2 ring-primary'
                        : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {done ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                </div>
                <span className={`hidden text-sm font-medium sm:block ${active ? 'text-foreground' : 'text-muted-foreground'}`}>{s.label}</span>
                {n < steps.length && <div className={`h-0.5 flex-1 rounded ${done ? 'bg-primary' : 'bg-muted'}`} />}
              </div>
            )
          })}
        </div>

        {/* card */}
        <div className="mt-6 flex-1 rounded-3xl border border-border bg-card p-8 shadow-xl shadow-black/5 sm:p-10">
          <div className="mb-7 flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <StepIcon className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">{current.id === 'role' ? 'Welcome to Optryva' : meta.label}</h1>
              <p className="mt-0.5 text-base text-muted-foreground">{meta.blurb}</p>
            </div>
          </div>

          {current.id === 'role' && (
            <div className="grid gap-4">
              {ROLE_OPTIONS.map((r) => {
                const Icon = ROLE_ICONS[r.value]
                return (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setUserType(r.value)}
                    className={`group flex items-center gap-5 rounded-2xl border p-5 text-left transition-all ${
                      userType === r.value
                        ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
                        : 'border-border hover:border-primary/40 hover:bg-muted/50'
                    }`}
                  >
                    <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl transition-colors ${
                      userType === r.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground group-hover:text-foreground'
                    }`}>
                      <Icon className="h-7 w-7" />
                    </div>
                    <div>
                      <span className="block text-lg font-semibold">{r.label}</span>
                      <span className="text-base text-muted-foreground">{r.hint}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {current.id === 'about' && (
            <div className="space-y-6">
              <div>
                <Label htmlFor="name" className="text-base">Your name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alex Rivera" className="mt-2 h-12 bg-background text-base" />
              </div>
              <div>
                <Label className="text-base">What brings you here?</Label>
                <div className="mt-2 grid gap-3 sm:grid-cols-3">
                  {GOAL_OPTIONS.map((g) => (
                    <button
                      key={g.value}
                      type="button"
                      onClick={() => setGoal(g.value)}
                      className={`rounded-xl border p-4 text-left transition-colors ${
                        goal === g.value ? 'border-primary bg-primary/5 ring-2 ring-primary/30' : 'border-border hover:border-primary/40 hover:bg-muted/50'
                      }`}
                    >
                      <span className="block font-semibold">{g.label}</span>
                      <span className="text-sm text-muted-foreground">{g.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {current.id === 'location' && (
            <div className="space-y-6">
              <div>
                <Label htmlFor="country" className="text-base">Country</Label>
                <CountryCombobox id="country" value={country} onChange={setCountry} placeholder="Search countries…" className="mt-2 h-12 bg-background text-base" />
              </div>
              <div>
                <Label className="text-base">Work preference</Label>
                <div className="mt-2 grid gap-3 sm:grid-cols-3">
                  {WORK_OPTIONS.map((w) => (
                    <button
                      key={w.value}
                      type="button"
                      onClick={() => setWorkType(w.value)}
                      className={`rounded-xl border p-4 text-base font-medium transition-colors ${
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
            <div className="space-y-6">
              <div>
                <Label htmlFor="school" className="text-base">School / University</Label>
                <Input id="school" value={school} onChange={(e) => setSchool(e.target.value)} placeholder="e.g. University of Nairobi" className="mt-2 h-12 bg-background text-base" />
              </div>
              <div>
                <Label htmlFor="major" className="text-base">Major / field of study</Label>
                <Input id="major" value={major} onChange={(e) => setMajor(e.target.value)} placeholder="e.g. Computer Science" className="mt-2 h-12 bg-background text-base" />
              </div>
              <div>
                <Label htmlFor="gpa" className="text-base">GPA / grades</Label>
                <Input
                  id="gpa"
                  value={gpa}
                  onChange={(e) => setGpa(e.target.value)}
                  placeholder="e.g. 3.8/4.0 or Second Class Upper"
                  className="mt-2 h-12 bg-background text-base"
                />
              </div>
            </div>
          )}

          {current.id === 'skills' && (
            <div>
              <div className="flex flex-wrap gap-2.5">
                {skills.map((s) => (
                  <span key={s} className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-4 py-2 text-base font-medium text-primary">
                    {s}
                    <button type="button" onClick={() => removeSkill(s)} aria-label={`Remove ${s}`} className="rounded-full p-0.5 hover:bg-primary/15">
                      <X className="h-4 w-4" />
                    </button>
                  </span>
                ))}
                {skills.length === 0 && <p className="text-base text-muted-foreground">No skills yet — add a few below.</p>}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  addSkill()
                }}
                className="mt-5 flex gap-2"
              >
                <Input
                  value={skillInput}
                  onChange={(e) => setSkillInput(e.target.value)}
                  placeholder="e.g. Python, Design, Public Speaking"
                  className="h-12 bg-background text-base"
                />
                <Button type="submit" variant="outline" size="icon" className="h-12 w-12" aria-label="Add skill">
                  <Plus className="h-5 w-5" />
                </Button>
              </form>
            </div>
          )}

          {current.id === 'resume' && (
            <div className="space-y-5">
              <label className="flex cursor-pointer flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-input bg-muted/30 p-10 text-center transition-colors hover:border-primary/50 hover:bg-primary/5">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Upload className="h-7 w-7" />
                </div>
                <div>
                  <p className="text-base font-medium">Upload your résumé</p>
                  <p className="text-sm text-muted-foreground">PDF or Word</p>
                </div>
                <input type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => attachCv(e.target.files?.[0])} />
              </label>

              {cvFilename && cvUrl && (
                <div className="flex items-center gap-4 rounded-xl border border-success/30 bg-success/5 p-5">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-success/15 text-success">
                    <FileText className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-medium">{cvFilename}</p>
                    <p className="text-sm text-muted-foreground">Attached</p>
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
        </div>

        {/* footer */}
        <div className="mt-8 flex items-center justify-between">
          <Button variant="ghost" size="lg" onClick={goBack} disabled={step === 1 || saving}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          {!isLast ? (
            <Button size="lg" onClick={handleNext}>
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button size="lg" onClick={finish} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Award className="h-4 w-4" />} Finish & go to profile
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
