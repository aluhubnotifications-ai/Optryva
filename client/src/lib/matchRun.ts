import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { aiApi } from '@/lib/api'

function today() {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

interface MatchRunState {
  // userId -> last run date (YYYY-MM-DD)
  lastRun: Record<string, string>
  markRun: (userId: string) => void
  /** Force a re-run (e.g. after a CV upload or profile change). */
  invalidate: (userId: string) => void
  /** True if this user hasn't run matching today (new day, new user, or invalidated). */
  needsRun: (userId: string) => boolean
}

export const useMatchRun = create<MatchRunState>()(
  persist(
    (set, get) => ({
      lastRun: {},
      markRun: (userId) => set((s) => ({ lastRun: { ...s.lastRun, [userId]: today() } })),
      invalidate: (userId) =>
        set((s) => {
          const n = { ...s.lastRun }
          delete n[userId]
          return { lastRun: n }
        }),
      needsRun: (userId) => get().lastRun[userId] !== today(),
    }),
    { name: 'optryva-matchrun' },
  ),
)

export function needsMatchRun(lastRunDate: string | undefined) {
  return lastRunDate !== today()
}

// ---------------------------------------------------------------------------
// Status-based polling — replaces the old streaming approach.
// The frontend polls GET /api/ai/matches/status for queue/pair states.
// ---------------------------------------------------------------------------

export type MatchScoreState =
  | 'provisional'
  | 'queued'
  | 'processing'
  | 'ai_reviewed'
  | 'stale'
  | 'failed'
  | 'excluded'

export interface MatchStatusInfo {
  score_state: MatchScoreState
  ai_status: string
  filter_points: number
  rank_position: number | null
  updated_at: string
  matched_skills: string[]
  missing_skills: string[]
}

let _pollInterval: ReturnType<typeof setInterval> | null = null

/**
 * Poll match status for the authenticated user. Calls `onUpdate` with the
 * latest queue + pair statuses. Stops when all pairs are complete or failed.
 */
export function startMatchStatusPolling(
  userId: string,
  onUpdate: (status: {
    queue: { queued: number; processing: number; completed: number; failed: number }
    pairs: MatchStatusInfo[]
  }) => void,
  intervalMs = 5000,
): void {
  if (_pollInterval) clearInterval(_pollInterval)

  const poll = async () => {
    try {
      const res = await aiApi.matchStatus()
      onUpdate({
        queue: res.queue,
        pairs: (res.pairs ?? []).map((p: any) => ({
          score_state: deriveScoreState(p.ai_status),
          ai_status: p.ai_status,
          filter_points: p.filter_points,
          rank_position: p.rank_position,
          updated_at: p.updated_at,
          matched_skills: [],
          missing_skills: [],
        })),
      })

      // Stop polling if no work is in flight
      if (res.queue.queued === 0 && res.queue.processing === 0) {
        if (_pollInterval) clearInterval(_pollInterval)
        _pollInterval = null
      }
    } catch (e) {
      console.warn('[matchRun] status poll failed:', (e as Error).message)
    }
  }

  poll()
  _pollInterval = setInterval(poll, intervalMs)
}

export function stopMatchStatusPolling(): void {
  if (_pollInterval) clearInterval(_pollInterval)
  _pollInterval = null
}

function deriveScoreState(aiStatus: string): MatchScoreState {
  switch (aiStatus) {
    case 'not_requested': return 'provisional'
    case 'queued': return 'queued'
    case 'processing': return 'processing'
    case 'completed': return 'ai_reviewed'
    case 'stale': return 'stale'
    case 'failed': return 'failed'
    default: return 'provisional'
  }
}
