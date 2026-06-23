import { create } from 'zustand'
import { persist } from 'zustand/middleware'

function today() {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

interface MatchRunState {
  // userId -> last run date (YYYY-MM-DD)
  lastRun: Record<string, string>
  markRun: (userId: string) => void
  /** Force a re-run (e.g. after a CV upload or profile change). */
  invalidate: (userId: string) => void
}

export const useMatchRun = create<MatchRunState>()(
  persist(
    (set) => ({
      lastRun: {},
      markRun: (userId) => set((s) => ({ lastRun: { ...s.lastRun, [userId]: today() } })),
      invalidate: (userId) =>
        set((s) => {
          const n = { ...s.lastRun }
          delete n[userId]
          return { lastRun: n }
        }),
    }),
    { name: 'optryva-matchrun' },
  ),
)

/** True if this user hasn't run matching today (new day, new user, or invalidated). */
export function needsMatchRun(lastRunDate: string | undefined) {
  return lastRunDate !== today()
}
