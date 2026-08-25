import type { Profile, UserType } from '@/types'

// ----------------------------------------------------------------------------
// Unified onboarding / profile-completion model.
//
// The redesign sends every new user straight to their Profile after sign-in and
// keeps them there (the router bounces them back) until the *important* steps
// are done. We deliberately do NOT trap users forever: once the required steps
// are complete they can explore the app, and a progress card keeps nudging them
// to finish the optional fields up to 100%.
//
// Required steps (gates the app — kept intentionally simple):
//   1. Name            2. Who you are (user type)   3. First goal (onboarding_goal)
//   4. Location        5. Work preferences
// Optional steps (Skip for now available, and NOT required to leave Profile):
//   bio, major, year, a link, skills, career direction, and résumé/evidence.
// Résumé and evidence are deliberately optional — users add them in Profile if
// they have them; they must never block onboarding.
// ----------------------------------------------------------------------------

export type StepSection = 'about' | 'resumes' | 'intro'

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

export function profileCompletion(p: Profile | null | undefined, resumeCount = 0): OnboardingState {
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

  const required: OnboardingStep[] = [
    { key: 'name', label: 'Your name', done: !!p.full_name?.trim(), required: true, section: 'about' },
    { key: 'role', label: 'Who you are — Student, Employer, or University', done: !!p.user_type, required: true, section: 'intro' },
    { key: 'goal', label: 'Your first goal', done: !!p.onboarding_goal?.trim(), required: true, section: 'intro' },
    { key: 'location', label: 'Location', done: !!p.location?.trim(), required: true, section: 'about' },
    { key: 'work', label: 'Work preferences', done: !!p.work_type && p.work_type !== 'any', required: true, section: 'about' },
    { key: 'resume', label: 'Résumé or basic profile', done: hasCv, required: true, section: 'resumes' },
  ]

  const optional: OnboardingStep[] = [
    { key: 'bio', label: 'Short bio', done: !!p.bio?.trim(), required: false, section: 'about' },
    { key: 'major', label: 'Major or field of study', done: !!p.major?.trim(), required: false, section: 'about' },
    { key: 'year', label: 'Year of study', done: !!(p.year || p.graduated), required: false, section: 'about' },
    { key: 'links', label: 'A link (LinkedIn or GitHub)', done: !!(p.linkedin?.trim() || p.github?.trim() || p.website?.trim()), required: false, section: 'about' },
    { key: 'skills', label: 'Add your skills', done: (p.skills?.length ?? 0) > 0, required: false, section: 'about' },
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
 * Whether the router should keep the user on their Profile until the important
 * steps are complete. Every new account — student, company, school, or a Google
 * sign-in that hasn't picked a role yet — is held on Profile until the required
 * (simple) steps are done. Once complete they can explore freely.
 */
export function requiresProfileCompletion(p: Profile | null | undefined): boolean {
  if (!p) return false
  return !profileCompletion(p).requiredComplete
}

export const GOAL_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: 'find_opportunities', label: 'Find opportunities', hint: 'Internships, roles, and fellowships' },
  { value: 'hire_talent', label: 'Hire talent', hint: 'Post roles and review candidates' },
  { value: 'manage_university', label: 'Manage university careers', hint: 'Support students and track outcomes' },
]

export const ROLE_OPTIONS: { value: UserType; label: string; hint: string }[] = [
  { value: 'student', label: 'Student', hint: 'Find roles and build evidence' },
  { value: 'company', label: 'Employer', hint: 'Hire talent' },
  { value: 'school', label: 'University', hint: 'Manage student careers' },
]
