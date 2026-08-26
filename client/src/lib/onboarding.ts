import type { Profile, UserType } from '@/types'

// Onboarding is shown ONLY to accounts created in this session. The server flags
// a brand-new account by redirecting to `/onboarding?new=1` (register, or a
// first-time Google sign-in). Returning users never receive that flag, so the
// router never forces them through the wizard — they land on their Profile and
// complete optional fields at their leisure.
export function isNewAccount(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('new') === '1'
}

// ----------------------------------------------------------------------------
// Unified onboarding / profile-completion model.
//
// New accounts are held in the onboarding wizard (flagged via ?new=1) until the
// *important* steps are done. Returning users skip onboarding entirely. We
// deliberately do NOT trap users forever: once the required steps are complete
// they can explore the app, and a progress card keeps nudging them to finish
// the optional fields up to 100%.
//
// Required steps (gates the app — kept intentionally simple):
//   1. Name            2. Who you are (user type)   3. First goal (onboarding_goal)
//   4. Location        5. Work preferences
// Optional steps (Skip for now available, and NOT required to leave Profile):
//   bio, major, year, a link, skills, career direction, and résumé/evidence.
// Résumé and evidence are deliberately optional — users add them in Profile if
// they have them; they must never block onboarding.
// ----------------------------------------------------------------------------

export type StepSection = 'about' | 'resumes' | 'intro' | 'evidence'

export interface OnboardingStep {
  key: string
  label: string
  done: boolean
  required: boolean
  section: StepSection
}

export interface OnboardingState {
  required: OnboardingStep[]
  optional: OnboardingStep[]
  requiredDone: number
  requiredTotal: number
  /** Completion of the required (gating) steps, 0..100. */
  requiredPercent: number
  /** Overall completion including optional fields, 0..100. */
  overallPercent: number
  requiredComplete: boolean
  nextStep: OnboardingStep | null
  optionalRemaining: number
}

export function profileCompletion(p: Profile | null | undefined, resumeCount = 0, evidenceCount = 0): OnboardingState {
  if (!p) {
    return {
      required: [],
      optional: [],
      requiredDone: 0,
      requiredTotal: 0,
      requiredPercent: 0,
      overallPercent: 0,
      requiredComplete: false,
      nextStep: null,
      optionalRemaining: 0,
    }
  }

  const hasCv = !!(p.cv_text || p.cv_url) || resumeCount > 0
  const hasEvidence = evidenceCount > 0 || isEvidenceDeclined(p.id)

  const required: OnboardingStep[] = [
    { key: 'name', label: 'Your name', done: !!p.full_name?.trim(), required: true, section: 'about' },
    { key: 'role', label: 'Who you are — Student, Employer, or University', done: !!p.user_type, required: true, section: 'intro' },
    { key: 'goal', label: 'Your first goal', done: !!p.onboarding_goal?.trim(), required: true, section: 'intro' },
    {
      key: 'work',
      label: 'Work preferences',
      // Work preference (remote/onsite/hybrid) is a student concept — where they
      // want to work. Schools/companies never set it, so it's neither required
      // nor "incomplete" for them (otherwise the router would loop them in onboarding).
      done: p.user_type === 'student' ? !!p.work_type && p.work_type !== 'any' : true,
      required: p.user_type === 'student',
      section: 'about',
    },
    { key: 'skills', label: 'Your skills', done: p.user_type === 'student' ? (p.skills?.length ?? 0) > 0 : true, required: true, section: 'about' },
    {
      key: 'education',
      label: 'School, major & GPA',
      done: p.user_type === 'student' ? !!(p.major?.trim() && p.school?.trim() && p.gpa?.trim()) : true,
      required: true,
      section: 'about',
    },
    {
      key: 'institution',
      label: 'Institution description',
      done: p.user_type === 'school' ? !!p.bio?.trim() : true,
      required: true,
      section: 'about',
    },
    {
       key: 'companyInfo',
       label: 'Industry & company size',
       done: p.user_type === 'company' || p.user_type === 'school' ? !!(p.industry?.trim() && p.company_size?.trim()) : true,
       required: true,
       section: 'about',
     },
    { key: 'resume', label: 'Résumé or basic profile', done: p.user_type === 'student' ? hasCv : true, required: true, section: 'resumes' },
    { key: 'evidence', label: 'Evidence of your work (required)', done: hasEvidence, required: true, section: 'evidence' },
  ]

  const optional: OnboardingStep[] = [
    { key: 'bio', label: 'Short bio', done: !!p.bio?.trim(), required: false, section: 'about' },
    { key: 'year', label: 'Year of study', done: !!(p.year || p.graduated), required: false, section: 'about' },
    { key: 'links', label: 'A link (LinkedIn or GitHub)', done: !!(p.linkedin?.trim() || p.github?.trim() || p.website?.trim()), required: false, section: 'about' },
    { key: 'career', label: 'First career direction or role', done: (p.desired_roles?.length ?? 0) > 0, required: false, section: 'about' },
  ]

  const requiredDone = required.filter((s) => s.done).length
  const requiredTotal = required.length
  const optionalDone = optional.filter((s) => s.done).length
  const allTotal = requiredTotal + optional.length
  const allDone = requiredDone + optionalDone

  return {
    required,
    optional,
    requiredDone,
    requiredTotal,
    requiredPercent: requiredTotal ? Math.round((requiredDone / requiredTotal) * 100) : 100,
    overallPercent: allTotal ? Math.round((allDone / allTotal) * 100) : 100,
    requiredComplete: requiredDone === requiredTotal,
    nextStep: required.find((s) => !s.done) ?? null,
    optionalRemaining: optional.length - optionalDone,
  }
}

/**
 * Client-side acknowledgment that a user has chosen "I don't have any evidence
 * yet". Stored per-user in localStorage so the required-evidence gate can be
 * satisfied without a dedicated DB column. Evidence the user later adds also
 * satisfies the gate (see `profileCompletion`).
 */
export function setEvidenceDeclined(id: string, declined: boolean) {
  try {
    if (declined) localStorage.setItem(`optryva:evidence_declined:${id}`, '1')
    else localStorage.removeItem(`optryva:evidence_declined:${id}`)
  } catch {
    /* ignore storage errors */
  }
}

export function isEvidenceDeclined(id?: string): boolean {
  if (!id) return false
  try {
    return localStorage.getItem(`optryva:evidence_declined:${id}`) === '1'
  } catch {
    return false
  }
}

/**
 * Whether the router should bounce the user to onboarding. Every new account is
 * held until the *blocking* required steps are done — role, name, goal, country,
 * work, skills, education, and résumé. Evidence is also required, but it's
 * completed from the Profile (with an "I don't have any" option) and the router
 * can't see the evidence count, so it's intentionally excluded from this bounce.
 */
export function requiresProfileCompletion(p: Profile | null | undefined): boolean {
  if (!p) return false
  const blocking = profileCompletion(p).required.filter((s) => s.key !== 'evidence')
  return blocking.some((s) => !s.done)
}

export const GOAL_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: 'find_opportunities', label: 'Find opportunities', hint: 'Internships, roles, and fellowships' },
  { value: 'hire_talent', label: 'Hire talent', hint: 'Post roles and review candidates' },
  { value: 'manage_university', label: 'Manage university careers', hint: 'Support students and track outcomes' },
]

// Role choices shown on the onboarding "What brings you here?" step. Each maps
// to a user_type and a default onboarding_goal.
export const ROLE_CHOICES: { value: UserType; label: string; hint: string; goal: string; icon: string }[] = [
  { value: 'student', label: 'Student', hint: 'Find roles and build evidence', goal: 'find_opportunities', icon: '🎓' },
  { value: 'school', label: 'University', hint: 'Support students and track outcomes', goal: 'manage_university', icon: '🏛️' },
  { value: 'company', label: 'Company', hint: 'Post roles and review candidates', goal: 'hire_talent', icon: '🏢' },
]

export const ROLE_OPTIONS: { value: UserType; label: string; hint: string }[] = [
  { value: 'student', label: 'Student', hint: 'Find roles and build evidence' },
  { value: 'company', label: 'Employer', hint: 'Hire talent' },
  { value: 'school', label: 'University', hint: 'Manage student careers' },
]
