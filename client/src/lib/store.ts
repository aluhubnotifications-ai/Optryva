import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import * as db from '@/data/mockDb'
import { authApi, setAuthToken } from '@/lib/api'
import type { Profile } from '@/types'

// ----------------------------------------------------------------------------
// Session/auth store. You must log in to get a session — there is NO default
// user. A successful login (real backend) stores the access token + the user
// profile returned by the server.
// ----------------------------------------------------------------------------

interface SessionState {
  userId: string | null
  token: string | null
  profile: Profile | null
  /** Accounts created in this session that still owe the required onboarding
   *  steps. Keyed by user id and persisted so a refresh or a missed `?new=1`
   *  can't let a new user slip past the wizard. Cleared once they finish. */
  needsOnboarding: Record<string, boolean>
  /** Set the session from a successful backend login/register. */
  login: (profile: Profile, token: string) => void
  logout: () => void
  /** Update the cached profile (e.g. after the user edits their own profile). */
  setProfile: (profile: Profile) => void
  /** Mark (or clear) whether a user must finish onboarding before using the app. */
  setNeedsOnboarding: (userId: string, value: boolean) => void
  user: () => Profile | null
}

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      userId: null,
      token: null,
      profile: null,
      needsOnboarding: {},
      login: (profile, token) => {
        setAuthToken(token)
        db.session.currentUserId = profile.id
        set((s) => ({
          userId: profile.id,
          token,
          profile,
          // Preserve any existing per-user flag; logging in does NOT mean the
          // required onboarding steps are done.
          needsOnboarding: { ...s.needsOnboarding },
        }))
      },
      logout: () => {
        void authApi.logout()
        setAuthToken(null)
        db.session.currentUserId = null
        set({ userId: null, token: null, profile: null })
      },
      setProfile: (profile) => set({ profile }),
      setNeedsOnboarding: (userId, value) =>
        set((s) => ({ needsOnboarding: { ...s.needsOnboarding, [userId]: value } })),
      user: () => get().profile,
    }),
    {
      // Bumped name so any old auto-logged-in session is discarded.
      name: 'optryva-session-v2',
      partialize: (s) => ({ userId: s.userId, token: s.token, profile: s.profile, needsOnboarding: s.needsOnboarding }),
    },
  ),
)

/** Hook returning the current user profile from the session. */
export function useCurrentUser(): Profile | null {
  return useSession((s) => s.profile)
}
