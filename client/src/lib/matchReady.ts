import type { Profile } from '@/types'

// ----------------------------------------------------------------------------
// Match readiness — the funnel ranks the whole catalog by similarity to the
// student's embedding (built from their résumé + preferences). With NEITHER,
// the "top 40" would be arbitrary, so we don't run matching until the student
// has both. Mirrors matchReadiness() on the server (routes/ai.ts).
// ----------------------------------------------------------------------------

export type MatchMissing = 'resume' | 'preferences'

export function matchReadiness(user: Profile | null | undefined): { ready: boolean; missing: MatchMissing[] } {
  const hasResume = !!((user?.cv_text ?? '').trim() || user?.cv_filename)
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
