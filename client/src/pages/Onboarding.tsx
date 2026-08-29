import { Suspense, useEffect, useMemo, useRef, useState, startTransition } from 'react'
import { Link } from 'react-router-dom'
import { useTransitionNavigate } from '@/lib/useTransitionNavigate'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  Award,
  Briefcase,
  Building2,
  Check,
   FileText,
   GraduationCap,
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
import { Input, Label, Textarea, Select } from '@/components/ui/primitives'
import { CountryCombobox } from '@/components/ui/CountryCombobox'
import { COUNTRIES } from '@/lib/geo'
import { useToast } from '@/components/ui/toast'
import { useCurrentUser, useSession } from '@/lib/store'
import { DancingMascot, LoadingMascot } from '@/components/DancingMascot'
import { profilesApi, onboardingApi, authApi } from '@/lib/api'
import { invalidateCache } from '@/lib/dataCache'
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
const CAREER_EXAMPLES = [
  'Software Engineering',
  'Data Science / ML',
  'Web Development',
  'Mobile Development',
  'Product Management',
  'UX / UI Design',
  'Mechanical Engineering',
  'Electrical Engineering',
  'Business / Strategy',
  'Marketing',
  'Sales',
  'Finance / Accounting',
  'Consulting',
  'Operations',
  'Research',
  'Public Health',
  'Medicine / Nursing',
  'Education / Teaching',
  'Law',
  'Entrepreneurship',
]

type StepId = 'about' | 'location' | 'education' | 'school' | 'company' | 'skills' | 'resume' | 'preferences'

// Multi-select country picker (with a "Remote (anywhere)" option) used for the
// student "preferred countries" preference. Selecting a country adds a chip;
// the chosen set is the student's matching geography.
function CountryMultiSelect({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const list = useMemo(() => {
    const all = [{ code: 'remote', name: 'Remote (anywhere)', flagUrl: '' }, ...COUNTRIES]
    const query = q.trim().toLowerCase()
    return query ? all.filter((c) => c.name.toLowerCase().includes(query)) : all
  }, [q])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  function add(name: string) {
    if (!value.includes(name)) {
      onChange([...value, name])
      playStep()
    }
    setQ('')
    setOpen(false)
  }
  function remove(name: string) {
    onChange(value.filter((x) => x !== name))
  }

  return (
    <div>
      <div className="mt-2 flex flex-wrap gap-2">
        {value.map((c) => (
          <motion.span
            key={c}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-sm text-primary"
          >
            {c}
            <button type="button" onClick={() => remove(c)} aria-label={`Remove ${c}`}>
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.span>
        ))}
      </div>
      <div className="relative mt-2" ref={wrapRef}>
        <input
          type="text"
          value={q}
          placeholder="Search countries…"
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          className="flex h-9 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        />
        {open && list.length > 0 && (
          <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-card">
            {list.slice(0, 60).map((c) => (
              <button
                type="button"
                key={c.code}
                onMouseDown={(e) => {
                  e.preventDefault()
                  add(c.name)
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted"
              >
                {c.flagUrl ? (
                  <img src={c.flagUrl} alt="" className="h-3.5 w-5 rounded-sm object-cover shadow-sm" />
                ) : (
                  <span className="h-3.5 w-5" />
                )}
                <span className="flex-1">{c.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

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

function OnboardingContent() {
  const navigate = useTransitionNavigate()
  const user = useCurrentUser()
  const { toast } = useToast()

  const userId = useSession((s) => s.userId)
  const setNeedsOnboarding = useSession((s) => s.setNeedsOnboarding)

  // Already finished the required steps → go straight to the app. Navigate inside
  // an effect (not via <Navigate>) so it runs as a transition; otherwise mounting
  // the lazy /app/profile chunk during a discrete update throws React #300.
  const finished = !!user && !requiresProfileCompletion(user)
  useEffect(() => {
    if (finished) navigate('/app', { replace: true })
  }, [finished, navigate])

  // This user is in the wizard because they're a new account (flagged ?new=1 by
  // register / the OAuth callback). Mirror that into the persisted
  // `needsOnboarding` flag so a refresh or navigating away can't let them skip
  // the required steps — the router re-holds them here until they finish.
  // IMPORTANT: this hook MUST run before the `if (finished) return null` below so
  // the hook order stays identical on every render (Rules of Hooks). It only
  // flags the user while onboarding is incomplete; once `finished` is true the
  // finish() flow clears the flag, and we must not re-set it here.
  useEffect(() => {
    if (!userId) return
    // Flag the user as owing onboarding only while still incomplete; clear it the
    // moment they're finished so a stale flag can't bounce them back later.
    if (!finished) setNeedsOnboarding(userId, true)
    else setNeedsOnboarding(userId, false)
  }, [userId, finished, setNeedsOnboarding])

  // Transition-wrapped state for all form fields to prevent React #300
  const [step, _setStep] = useState(1)
  const [userType, _setUserType] = useState<UserType | ''>(user?.user_type ?? '')
  const [name, _setName] = useState(user?.full_name ?? '')
  const [goal, _setGoal] = useState(user?.onboarding_goal?.trim() ?? '')
  const [country, _setCountry] = useState(user?.country ?? user?.location ?? '')
  const [workType, _setWorkType] = useState(user?.work_type ?? '')
  const [school, _setSchool] = useState(user?.school ?? '')
  const [major, _setMajor] = useState(user?.major ?? '')
  const [gpa, _setGpa] = useState(user?.gpa ?? '')
  const [year, _setYear] = useState(user?.year ? String(user.year) : '')
  const [bio, _setBio] = useState(user?.bio ?? '')
  const [studentDomains, _setStudentDomains] = useState(
    Array.isArray(user?.student_domains) ? (user?.student_domains as string[]).join(', ') : '',
  )
  const [industry, _setIndustry] = useState(user?.industry ?? '')
  const [companySize, _setCompanySize] = useState(user?.company_size ?? '')
  const [skills, _setSkills] = useState<string[]>(user?.skills ?? [])
  const [skillInput, _setSkillInput] = useState('')
  const [desiredRoles, _setDesiredRoles] = useState<string[]>(user?.desired_roles ?? [])
  const [roleInput, _setRoleInput] = useState('')
  const [preferredIndustries, _setPreferredIndustries] = useState<string[]>(user?.preferred_industries ?? [])
  const [prefCountries, _setPrefCountries] = useState<string[]>(user?.pref_countries ?? [])
  const [prefListingTypes, _setPrefListingTypes] = useState<string[]>(user?.pref_listing_types ?? [])
  const [cvUrl, _setCvUrl] = useState<string | undefined>(user?.cv_url ?? undefined)
  const [cvText, _setCvText] = useState(user?.cv_text ?? '')
  const [cvFilename, _setCvFilename] = useState<string | null>(user?.cv_filename ?? null)
  const [uploadProgress, _setUploadProgress] = useState<number | null>(null)
  const [saving, _setSaving] = useState(false)
  const [celebrating, _setCelebrating] = useState(false)
  const [resumeBurst, _setResumeBurst] = useState(false)

  // Transition-wrapped setters to prevent React #300 on synchronous updates
  const setStep = (v: number | ((prev: number) => number)) => startTransition(() => _setStep(v))
  const setUserType = (v: UserType | '' | ((prev: UserType | '') => UserType | '')) => startTransition(() => _setUserType(v))
  const setName = (v: string | ((prev: string) => string)) => startTransition(() => _setName(v))
  const setGoal = (v: string | ((prev: string) => string)) => startTransition(() => _setGoal(v))
  const setCountry = (v: string | ((prev: string) => string)) => startTransition(() => _setCountry(v))
  const setWorkType = (v: string | ((prev: string) => string)) => startTransition(() => _setWorkType(v))
  const setSchool = (v: string | ((prev: string) => string)) => startTransition(() => _setSchool(v))
  const setMajor = (v: string | ((prev: string) => string)) => startTransition(() => _setMajor(v))
  const setGpa = (v: string | ((prev: string) => string)) => startTransition(() => _setGpa(v))
  const setYear = (v: string | ((prev: string) => string)) => startTransition(() => _setYear(v))
  const setBio = (v: string | ((prev: string) => string)) => startTransition(() => _setBio(v))
  const setStudentDomains = (v: string | ((prev: string) => string)) => startTransition(() => _setStudentDomains(v))
  const setIndustry = (v: string | ((prev: string) => string)) => startTransition(() => _setIndustry(v))
  const setCompanySize = (v: string | ((prev: string) => string)) => startTransition(() => _setCompanySize(v))
  const setSkills = (v: string[] | ((prev: string[]) => string[])) => startTransition(() => _setSkills(v))
  const setSkillInput = (v: string | ((prev: string) => string)) => startTransition(() => _setSkillInput(v))
  const setDesiredRoles = (v: string[] | ((prev: string[]) => string[])) => startTransition(() => _setDesiredRoles(v))
  const setRoleInput = (v: string | ((prev: string) => string)) => startTransition(() => _setRoleInput(v))
  const setPreferredIndustries = (v: string[] | ((prev: string[]) => string[])) => startTransition(() => _setPreferredIndustries(v))
  const setPrefCountries = (v: string[] | ((prev: string[]) => string[])) => startTransition(() => _setPrefCountries(v))
  const setPrefListingTypes = (v: string[] | ((prev: string[]) => string[])) => startTransition(() => _setPrefListingTypes(v))
  const setCvUrl = (v: string | undefined | ((prev: string | undefined) => string | undefined)) => startTransition(() => _setCvUrl(v))
  const setCvText = (v: string | ((prev: string) => string)) => startTransition(() => _setCvText(v))
  const setCvFilename = (v: string | null | ((prev: string | null) => string | null)) => startTransition(() => _setCvFilename(v))
  const setUploadProgress = (v: number | null | ((prev: number | null) => number | null)) => startTransition(() => _setUploadProgress(v))
  const setSaving = (v: boolean | ((prev: boolean) => boolean)) => startTransition(() => _setSaving(v))
  const setCelebrating = (v: boolean | ((prev: boolean) => boolean)) => startTransition(() => _setCelebrating(v))
  const setResumeBurst = (v: boolean | ((prev: boolean) => boolean)) => startTransition(() => _setResumeBurst(v))

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
  // Students answer country + work preference inside the Preferences step, so
  // they don't get a duplicate Location step. Companies get country + work
  // preference; schools get country only (no work preference).
  if (userType !== 'student')
    steps.push({ id: 'location', label: userType === 'school' ? 'Your location' : 'Location & work' })

  const current = steps[Math.min(step, steps.length) - 1]
  const isLast = step === steps.length
  const meta = STEP_META[current.id]
  const progress = Math.round((step / steps.length) * 100)

  async function patchProfile(patch: Record<string, unknown>) {
    if (!user) return
    const updated = await profilesApi.update(user.id, patch)
    if (updated) useSession.getState().setProfile(updated)
    // `authApi.me()` is cached for 60s (see dataCache). After we mutate the
    // current user, bust that cache so the next `me()` (e.g. at finish()) sees
    // the freshly-saved user_type/company_name instead of the stale login copy.
    invalidateCache('auth:me')
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
    if (s && !skills.includes(s)) {
      setSkills([...skills, s])
      playStep()
    }
    setSkillInput('')
  }
  function removeSkill(s: string) {
    setSkills(skills.filter((x) => x !== s))
  }

  function addRole() {
    const s = roleInput.trim()
    if (s && !desiredRoles.includes(s)) {
      setDesiredRoles([...desiredRoles, s])
      playStep()
    }
    setRoleInput('')
  }
  function toggleRole(r: string) {
    setDesiredRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]))
    playStep()
  }
  function toggleIndustry(ind: string) {
    setPreferredIndustries((prev) => (prev.includes(ind) ? prev.filter((x) => x !== ind) : [...prev, ind]))
    playStep()
  }
  function toggleListingType(t: string) {
    setPrefListingTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
    playStep()
  }

  async function handleNext() {
    try {
      if (current.id === 'about') {
        if (!name.trim()) return toast({ title: 'Add your name', tone: 'error' })
        if (!goal) return toast({ title: 'Choose a goal', tone: 'error' })
        // Companies/schools store their display name in `company_name`; students
        // use `full_name`. Both columns get the value so the org profile (which
        // reads `company_name`) shows the right name.
        const aboutPatch: Record<string, unknown> = {
          full_name: name.trim(),
          onboarding_goal: goal,
          user_type: userType,
        }
        if (userType === 'company' || userType === 'school') aboutPatch.company_name = name.trim()
        await patchProfile(aboutPatch)
        goNext()
      } else if (current.id === 'education') {
        if (!school.trim()) return toast({ title: 'Add your school', tone: 'error' })
        if (!major.trim()) return toast({ title: 'Add your major', tone: 'error' })
        if (!gpa.trim()) return toast({ title: 'Add your GPA or grades', tone: 'error' })
        if (!country.trim()) return toast({ title: 'Pick your country', tone: 'error' })
        if (!year) return toast({ title: 'Pick your year of study', tone: 'error' })
        const graduated = year === 'grad'
        await patchProfile({
          school: school.trim(),
          major: major.trim(),
          gpa: gpa.trim(),
          country: country.trim(),
          location: country.trim(),
          ...(graduated ? { graduated: true, year: '' } : { graduated: false, year }),
        })
        goNext()
        } else if (current.id === 'school') {
          if (!bio.trim()) return toast({ title: 'Add a short description', tone: 'error' })
          if (!industry) return toast({ title: 'Choose an industry', tone: 'error' })
          if (!companySize) return toast({ title: 'Choose an institution size', tone: 'error' })
          await patchProfile({
            bio: bio.trim(),
            student_domains: studentDomains
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
            industry,
            company_size: companySize,
          })
          goNext()
        } else if (current.id === 'company') {
        if (!industry) return toast({ title: 'Choose an industry', tone: 'error' })
        if (!companySize) return toast({ title: 'Choose a company size', tone: 'error' })
        await patchProfile({ industry, company_size: companySize })
        goNext()
      } else if (current.id === 'location') {
        if (!country.trim()) return toast({ title: 'Choose your country', tone: 'error' })
        if (userType === 'company' && !workType) return toast({ title: 'Choose a work preference', tone: 'error' })
        await patchProfile({
          country: country.trim(),
          location: country.trim(),
          // Work preference (remote/onsite/hybrid) is a student concept. Companies
          // may set it as their own working model; schools never need it.
          ...(userType === 'company' ? { work_type: workType } : {}),
        })
        goNext()
      } else if (current.id === 'skills') {
        if (skills.length === 0) return toast({ title: 'Add at least one skill', tone: 'error' })
        await patchProfile({ skills })
        goNext()
      } else if (current.id === 'resume') {
        if (!hasResume) return toast({ title: 'Add a résumé or paste your experience', tone: 'error' })
        goNext()
      } else if (current.id === 'preferences') {
        if (desiredRoles.length === 0) return toast({ title: 'Pick a career direction', tone: 'error' })
        if (preferredIndustries.length === 0) return toast({ title: 'Pick at least one industry', tone: 'error' })
        if (prefCountries.length === 0) return toast({ title: 'Pick at least one country (or Remote)', tone: 'error' })
        if (!workType) return toast({ title: 'Choose a work preference', tone: 'error' })
        if (prefListingTypes.length === 0) return toast({ title: 'Pick at least one opportunity type', tone: 'error' })
        await patchProfile({
          desired_roles: desiredRoles,
          preferred_industries: preferredIndustries,
          pref_countries: prefCountries,
          pref_listing_types: prefListingTypes,
          work_type: workType,
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
      playSuccess()
      setResumeBurst(true)
      setTimeout(() => setResumeBurst(false), 1300)
      toast({ title: 'Attached', description: file.name, tone: 'success' })
      setTimeout(() => setUploadProgress(null), 500)
    } catch (e) {
      setUploadProgress(null)
      toast({ title: "Couldn't read file", description: e instanceof Error ? e.message : undefined, tone: 'error' })
    }
  }

  async function finish() {
    // Only students have a résumé step. Schools/companies finish without one,
    // so do NOT block them on a résumé they were never asked for.
    if (userType === 'student' && !hasResume) return toast({ title: 'Add a résumé or paste your experience', tone: 'error' })
    // Students finish straight from the Preferences step (their last step), so
    // validate here too — the per-step handleNext guard is skipped on the last.
    if (userType === 'student') {
      if (desiredRoles.length === 0) return toast({ title: 'Pick a career direction', tone: 'error' })
      if (preferredIndustries.length === 0) return toast({ title: 'Pick at least one industry', tone: 'error' })
      if (prefCountries.length === 0) return toast({ title: 'Pick at least one country (or Remote)', tone: 'error' })
      if (!workType) return toast({ title: 'Choose a work preference', tone: 'error' })
      if (prefListingTypes.length === 0) return toast({ title: 'Pick at least one opportunity type', tone: 'error' })
    }
    // Students now pick their country in the Education step; schools/companies
    // pick it in the Location step. Either way `country` holds the base country.
    const baseCountry = country.trim()
    const graduated = year === 'grad'
    setSaving(true)
    try {
      await patchProfile({
        user_type: userType,
        full_name: name.trim(),
        onboarding_goal: goal,
        country: baseCountry,
        location: baseCountry,
        ...(userType === 'company' || userType === 'school' ? { company_name: name.trim() } : {}),
        ...(userType === 'company' ? { work_type: workType } : {}),
        school: school.trim(),
        major: major.trim(),
        gpa: gpa.trim(),
        // `year` / `graduated` are student-only concepts. Schools and companies have
        // no Education step, so their `year` state is '' — sending that to the
        // integer `year` column 500s. Only students write these.
        ...(userType === 'student' ? { year: graduated ? '' : year, graduated } : {}),
        skills,
        ...(userType === 'school'
          ? {
              bio: bio.trim(),
              student_domains: studentDomains.split(',').map((s) => s.trim()).filter(Boolean),
            }
          : {}),
        ...(userType === 'company' || userType === 'school' ? { industry, company_size: companySize } : {}),
        ...(userType === 'student'
          ? {
              desired_roles: desiredRoles,
              preferred_industries: preferredIndustries,
              pref_countries: prefCountries,
              pref_listing_types: prefListingTypes,
            }
          : {}),
      })
      // Only students have a résumé step. Employers/universities must NOT call the
      // student résumé endpoint — an empty payload returns HTTP 400 (missing_resume)
      // and would abort onboarding for them.
      if (userType === 'student') {
        await onboardingApi.saveResume(cvText.trim() || undefined, cvUrl, cvFilename ?? undefined)
      }
      // Refresh the cached profile so the completion gate sees the résumé and
      // doesn't bounce us straight back to onboarding.
      const refreshed = await authApi.me()
      if (refreshed) useSession.getState().setProfile(refreshed)
      // Mark onboarding complete so the router never forces this user through
      // the wizard again.
      if (userId) useSession.getState().setNeedsOnboarding(userId, false)
      setCelebrating(true)
      playSuccess()
      toast({ title: "You're all set!", description: 'Taking you to your dashboard…', tone: 'success' })
      setTimeout(() => navigate('/app', { replace: true }), 1500)
    } catch (e) {
      toast({ title: "Couldn't finish", description: e instanceof Error ? e.message : undefined, tone: 'error' })
      setSaving(false)
    }
  }

  // Early-out AFTER every hook above has been declared, so the hook count/order
  // is identical on every render (Rules of Hooks). An early return placed before
  // the useState declarations would crash with React #300/#310 when `finished`
  // flips between renders (e.g. the moment onboarding completes).
  if (finished) return null

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
          <div
            className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
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

          <div
            key={current.id}
            className="animate-slide-in"
            style={{ opacity: 1, transform: 'translateX(0)' }}
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
              {/* Work preference (remote/onsite/hybrid) only applies to companies
                  — it describes their working model. Schools never need it. */}
              {userType === 'company' && (
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
              )}
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
              <div>
                <Label>Country</Label>
                <CountryCombobox
                  value={country}
                  onChange={setCountry}
                  placeholder="Select your country"
                />
                <p className="mt-1 text-xs text-muted-foreground">We use this to match you to the right opportunities.</p>
              </div>
              <div>
                <Label>Year of study</Label>
                <Select value={year} onChange={(e) => setYear(e.target.value)} className="bg-background">
                  <option value="">Select…</option>
                  <option value="1">Year 1</option>
                  <option value="2">Year 2</option>
                  <option value="3">Year 3</option>
                  <option value="4">Year 4</option>
                  <option value="grad">Graduate</option>
                </Select>
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

              {/* Schools, like companies, describe themselves by industry + size so their
                  public profile reads "Technology · 11-50 employees" instead of a blank line. */}
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
                <Label>Institution size</Label>
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
                  <motion.span
                    key={s}
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary"
                  >
                    {s}
                    <button type="button" onClick={() => removeSkill(s)} aria-label={`Remove ${s}`} className="rounded-full p-0.5 hover:bg-primary/15">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </motion.span>
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
                <Label>Career direction — pick what fits (or add your own)</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {CAREER_EXAMPLES.map((ex) => {
                    const active = desiredRoles.includes(ex)
                    return (
                      <motion.button
                        key={ex}
                        type="button"
                        whileTap={{ scale: 0.92 }}
                        whileHover={{ scale: 1.04 }}
                        onClick={() => toggleRole(ex)}
                        className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                          active ? 'border-primary bg-primary/10 text-primary' : 'border-input bg-background hover:border-primary/40'
                        }`}
                      >
                        {ex}
                      </motion.button>
                    )
                  })}
                </div>
                {desiredRoles.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {desiredRoles.map((r) => (
                      <motion.span
                        key={r}
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-sm text-primary"
                      >
                        {r}
                        <button type="button" onClick={() => setDesiredRoles(desiredRoles.filter((x) => x !== r))}>
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </motion.span>
                    ))}
                  </div>
                )}
                <Input
                  value={roleInput}
                  onChange={(e) => setRoleInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addRole()
                    }
                  }}
                  placeholder="Add a custom role and press Enter"
                  className="mt-3 bg-background"
                />
              </div>

              <div>
                <Label>Preferred industries</Label>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {INDUSTRIES.map((ind) => {
                    const active = preferredIndustries.includes(ind)
                    return (
                      <motion.button
                        key={ind}
                        type="button"
                        whileTap={{ scale: 0.94 }}
                        whileHover={{ scale: 1.03 }}
                        onClick={() => toggleIndustry(ind)}
                        className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
                          active ? 'border-primary bg-primary/10 text-primary' : 'border-input bg-background hover:border-primary/40'
                        }`}
                      >
                        {ind}
                      </motion.button>
                    )
                  })}
                </div>
              </div>

              <div>
                <Label>Preferred countries (where you want to work)</Label>
                <CountryMultiSelect value={prefCountries} onChange={setPrefCountries} />
              </div>

              <div>
                <Label>Work preference</Label>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {WORK_OPTIONS.map((o) => {
                    const active = workType === o.value
                    return (
                      <motion.button
                        key={o.value}
                        type="button"
                        whileTap={{ scale: 0.94 }}
                        whileHover={{ scale: 1.03 }}
                        onClick={() => {
                          setWorkType(o.value)
                          playStep()
                        }}
                        className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
                          active ? 'border-primary bg-primary/10 text-primary' : 'border-input bg-background hover:border-primary/40'
                        }`}
                      >
                        {o.label}
                      </motion.button>
                    )
                  })}
                </div>
              </div>

              <div>
                <Label>Opportunity types</Label>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {LISTING_TYPES.map((t) => {
                    const active = prefListingTypes.includes(t)
                    return (
                      <motion.button
                        key={t}
                        type="button"
                        whileTap={{ scale: 0.94 }}
                        whileHover={{ scale: 1.03 }}
                        onClick={() => toggleListingType(t)}
                        className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
                          active ? 'border-primary bg-primary/10 text-primary' : 'border-input bg-background hover:border-primary/40'
                        }`}
                      >
                        {t}
                      </motion.button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
          </div>
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
              {saving ? <DancingMascot size={16} /> : <Award className="h-4 w-4" />}
              {userType === 'company' ? 'Finish & post opportunities' : userType === 'school' ? 'Finish & invite students' : 'Finish & go to profile'}
            </Button>
          )}
        </div>
      </div>
      {resumeBurst && (
        <div className="pointer-events-none fixed inset-0 z-[55] flex items-center justify-center">
          <Confetti count={40} />
        </div>
      )}
      {celebrating && (
        <div
          className="pointer-events-none fixed inset-0 z-[60] flex flex-col items-center justify-center gap-5 bg-background/85 backdrop-blur-sm animate-fade-in"
        >
          <div className="flex flex-col items-center gap-2 animate-scale-in">
            <Logo className="h-20 w-20 drop-shadow-lg" />
            <OnboardingMascot celebrating className="h-20 w-20" />
          </div>
          <h1 className="text-center text-3xl font-extrabold tracking-tight animate-slide-up">
            {userType === 'company' ? 'Ready to hire! 🎉' : userType === 'school' ? "You're live! 🎉" : 'Welcome to Optryva! 🎉'}
          </h1>
          <p className="text-center text-sm text-muted-foreground">
            {userType === 'company'
              ? 'Post your first opportunity and connect with top students — taking you there…'
              : userType === 'school'
                ? 'Invite your students and share opportunities — taking you there…'
                : 'Your profile is ready — taking you there…'}
          </p>
          <div className="mt-1">
            <LoadingMascot label="Loading your profile…" />
          </div>
          <Confetti count={70} />
          <Confetti count={70} />
        </div>
      )}
    </div>
  )
}

export default function Onboarding() {
  return (
    <Suspense fallback={
      <div className="mesh-bg flex min-h-screen items-center justify-center">
        <DancingMascot size={80} />
      </div>
    }>
      <OnboardingContent />
    </Suspense>
  )
}
