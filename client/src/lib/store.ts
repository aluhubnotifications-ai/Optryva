import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import * as db from '@/data/mockDb'
import { authApi, setAuthToken } from '@/lib/api'
import type { Profile } from '@/types'

// ----------------------------------------------------------------------------
// Right sidebar open state — shared so the Topbar can pad its right-side icons
// when the AI assistant sidebar is open (prevents overlap), and so the
// sidebar itself can be styled with partial transparency.
// ----------------------------------------------------------------------------

interface UiState {
  rightSidebarOpen: boolean
  setRightSidebarOpen: (open: boolean) => void
}

export const useUiStore = create<UiState>()((set) => ({
  rightSidebarOpen: true,
  setRightSidebarOpen: (open) => set({ rightSidebarOpen: open }),
}))

/** Convenience hook for components that need to know sidebar state. */
export function useRightSidebarOpen(): boolean {
  return useUiStore((s) => s.rightSidebarOpen)
}

// ----------------------------------------------------------------------------
// Session/auth store. You must log in to get a session — there is NO default
// user. A successful login (real backend) stores the access token + the user
// profile returned by the server.
//
// Sessions are hard-capped at 7 days (SESSION_TTL_MS) to match the server-side
// refresh-token TTL (REFRESH_TTL = '7d' in server/src/lib/auth.ts). We enforce
// this both ways:
//   - Boot-time guard: a persisted session older than 7d is force-logged-out
//     before the app renders (so a stale tab can't ride a silently-rotated
//     access token past the window).
//   - Live watchdog: login() schedules a single timeout that fires at the 7d
//     mark and logs the user out of the open tab immediately.
// ----------------------------------------------------------------------------

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

interface SessionState {
  userId: string | null
  token: string | null
  profile: Profile | null
  /** Wall-clock time of the most recent login(). Persisted so a page reload
   *  mid-session still enforces the absolute 5h cap. */
  loginAt: number | null
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

let sessionTimeoutId: ReturnType<typeof setTimeout> | null = null
function clearSessionTimeout() {
  if (sessionTimeoutId) {
    clearTimeout(sessionTimeoutId)
    sessionTimeoutId = null
  }
}
function startSessionTimeout(loginAt: number) {
  clearSessionTimeout()
  const remaining = loginAt + SESSION_TTL_MS - Date.now()
  if (remaining <= 0) {
    // Already expired — force logout synchronously on the next tick.
    sessionTimeoutId = setTimeout(() => useSession.getState().logout(), 0)
    return
  }
  sessionTimeoutId = setTimeout(() => useSession.getState().logout(), remaining)
}

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      userId: null,
      token: null,
      profile: null,
      loginAt: null,
      needsOnboarding: {},
      login: (profile, token) => {
        setAuthToken(token)
        db.session.currentUserId = profile.id
        const loginAt = Date.now()
        startSessionTimeout(loginAt)
        set((s) => ({
          userId: profile.id,
          token,
          profile,
          loginAt,
          // Preserve any existing per-user flag; logging in does NOT mean the
          // required onboarding steps are done.
          needsOnboarding: { ...s.needsOnboarding },
        }))
      },
      logout: () => {
        clearSessionTimeout()
        void authApi.logout()
        setAuthToken(null)
        db.session.currentUserId = null
        set({ userId: null, token: null, profile: null, loginAt: null })
      },
      setProfile: (profile) => set({ profile }),
      setNeedsOnboarding: (userId, value) =>
        set((s) => ({ needsOnboarding: { ...s.needsOnboarding, [userId]: value } })),
      user: () => get().profile,
    }),
    {
      // Bumped name so any old auto-logged-in session is discarded.
      name: 'optryva-session-v2',
      partialize: (s) => ({
        userId: s.userId,
        token: s.token,
        profile: s.profile,
        loginAt: s.loginAt,
        needsOnboarding: s.needsOnboarding,
      }),
    },
  ),
)

// On module load, enforce the boot-time guard: if a persisted session is older
// than SESSION_TTL_MS, log it out before anything renders. Also arm the
// watchdog for any still-valid session so an open tab times out at 5h.
{
  const { loginAt, userId } = useSession.getState()
  if (userId && loginAt) {
    if (Date.now() - loginAt >= SESSION_TTL_MS) {
      useSession.getState().logout()
    } else {
      startSessionTimeout(loginAt)
    }
  }
}

/** Hook returning the current user profile from the session. */
export function useCurrentUser(): Profile | null {
  return useSession((s) => s.profile)
}
