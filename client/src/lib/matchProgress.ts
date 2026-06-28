import { create } from 'zustand'
import type { AiMatch } from '@/types'
import { aiApi } from '@/lib/api'
import { useAiActivity } from '@/lib/aiActivity'
import { useMatchRun } from '@/lib/matchRun'

// ----------------------------------------------------------------------------
// Global match-run progress. Lives outside any component so matching keeps going
// — and stays visible — when the user switches tabs or navigates away and back.
// It streams from /ai/matches/stream, updating a real percentage + the current
// role being scored, and mirrors that into the AI activity panel.
// ----------------------------------------------------------------------------

export type MatchPhase = 'idle' | 'running' | 'done' | 'error'

interface MatchProgressState {
  userId: string | null
  phase: MatchPhase
  done: number
  total: number
  label: string // the role currently being scored
  matches: AiMatch[] // accumulated, by arrival
  /** Start a run. Idempotent: no-op if a run is already in flight for this user,
   *  or already finished with results (so navigating between pages reuses the
   *  same matches instead of re-scoring). Pass force=true to re-run. */
  run: (userId: string, force?: boolean) => Promise<void>
  /** Drop results (e.g. on logout) so a fresh user starts clean. */
  reset: () => void
}

export const useMatchProgress = create<MatchProgressState>((set, get) => ({
  userId: null,
  phase: 'idle',
  done: 0,
  total: 0,
  label: '',
  matches: [],

  run: async (userId, force = false) => {
    const s = get()
    if (!force && s.userId === userId && (s.phase === 'running' || (s.phase === 'done' && s.matches.length > 0))) return
    set({ userId, phase: 'running', done: 0, total: 0, label: 'Reading your profile…', matches: [] })

    const act = useAiActivity.getState()
    const taskId = act.start('Matching you to open roles')
    act.update(taskId, { done: 0, total: 0, label: 'Reading your profile…' })

    try {
      await aiApi.matchAllStream({
        onMeta: (total) => {
          set({ total })
          act.update(taskId, { done: 0, total, label: 'Scoring open roles…' })
        },
        onProgress: (done, total, title, match) => {
          set((st) => ({
            done,
            total,
            label: title,
            matches: match ? [...st.matches, match] : st.matches,
          }))
          act.update(taskId, { done, total, label: title })
        },
      })
      act.finish(taskId)
      set({ phase: 'done', label: '' })
      useMatchRun.getState().markRun(userId)
    } catch {
      // Streaming unavailable → fall back to the one-shot endpoint so the user
      // still gets matches (just without per-role progress).
      try {
        const matches = await aiApi.matchAll({ id: userId } as any, [])
        set({ matches, phase: matches.length ? 'done' : 'error', label: '' })
        act.finish(taskId, matches.length ? undefined : 'matching unavailable')
        if (matches.length) useMatchRun.getState().markRun(userId)
      } catch {
        set({ phase: 'error', label: '' })
        act.finish(taskId, 'matching unavailable')
      }
    }
  },

  reset: () => set({ userId: null, phase: 'idle', done: 0, total: 0, label: '', matches: [] }),
}))
