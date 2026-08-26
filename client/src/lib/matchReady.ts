import type { Profile } from '@/types'

// ----------------------------------------------------------------------------
// Match readiness — the funnel ranks the whole catalog by similarity to the
// student's embedding (built from their résumé + preferences). With NEITHER,
// the "top 40" would be arbitrary, so we don't run matching until the student
// has both. Mirrors matchReadiness() on the server (routes/ai.ts).
// ----------------------------------------------------------------------------

export type MatchMissing = 'resume' | 'preferences'

export function matchReadiness(
  user: Profile | null | undefined,
  resumePresent?: boolean,
): { ready: boolean; missing: MatchMissing[] } {
  // Keyed on EXTRACTED text, not just a filename: the matcher reads cv_text, so an
  // uploaded file only counts once the server has pulled text out of it (it may
  // fail on scanned PDFs / legacy .doc). This mirrors the server gate exactly
  // (cv_text || resume_profile) so the two never disagree — a bare cv_filename
  // would let the client think "ready" while the server refuses to match.
  // `resumePresent` lets callers inject the new résumé system's "active résumé"
  // status (resume_profiles), which the user object itself doesn't carry.
  const hasResume = resumePresent ?? !!((user?.cv_text ?? '').trim())
  const hasPreferences =
    (user?.pref_listing_types?.length ?? 0) > 0 ||
    (user?.pref_countries?.length ?? 0) > 0 ||
    (user?.skills?.length ?? 0) > 0 ||
    (user?.desired_roles?.length ?? 0) > 0 ||
    (user?.preferred_industries?.length ?? 0) > 0
  const missing: MatchMissing[] = []
  if (!hasResume) missing.push('resume')
  if (!hasPreferences) missing.push('preferences')
  return { ready: missing.length === 0, missing }
}

// ----------------------------------------------------------------------------
// Onboarding gate. A student can't be matched without a résumé + preferences,
// so we make collecting them a REQUIRED onboarding step instead of letting them
// hit a silent "not ready" later. Only students need matching — companies and
// schools never go through this. Derived from real profile data (not a stored
// flag) so already-complete students skip onboarding automatically.
// ----------------------------------------------------------------------------
export function needsOnboarding(user: Profile | null | undefined): boolean {
  if (!user) return false // not loaded yet — don't bounce
  if (user.user_type !== 'student') return false
  return !matchReadiness(user).ready
}
