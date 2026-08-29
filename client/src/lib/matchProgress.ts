import { create } from 'zustand'
import type { AiMatch, JobListing } from '@/types'
import { aiApi } from '@/lib/api'
import { useAiActivity } from '@/lib/aiActivity'
import { useMatchRun, needsMatchRun } from '@/lib/matchRun'
import { useSession } from '@/lib/store'
import { matchReadiness } from '@/lib/matchReady'

// ----------------------------------------------------------------------------
// Global match-run progress. Lives outside any component so matching keeps going
// — and stays visible — when the user switches tabs or navigates away and back.
// It streams from /ai/matches/stream, updating a real percentage + the current
// role being scored, and mirrors that into the AI activity panel.
// ----------------------------------------------------------------------------

export type MatchPhase = 'idle' | 'running' | 'done' | 'error' | 'notReady'

interface MatchProgressState {
  userId: string | null
  phase: MatchPhase
  done: number
  total: number
  label: string // the role currently being scored
  matches: AiMatch[] // accumulated, by arrival
  missing: string[] // what's blocking matching when phase==='notReady' (resume/preferences)
  activity: { step: string; label: string } | null // live pipeline stage from the server
  scoring: string[] // job ids being scored on demand right now
  activeResumeId: string | null // which resume profile the current matches are for
  /** Start a run. Idempotent: no-op if a run is already in flight for this user,
   *  or already finished with results (so navigating between pages reuses the
   *  same matches instead of re-scoring). Pass force=true to re-run.
   *  Pass resumeId to score against a specific résumé profile. */
  run: (userId: string, force?: boolean, resumeId?: string) => Promise<void>
  /** Restore stored scores without starting matching. Pass resumeId for a
   *  specific résumé profile's cached scores. */
  hydrate: (userId: string, resumeId?: string) => Promise<void>
  /** Score ONE opportunity on demand (for roles the funnel didn't auto-score).
   *  The result is upserted into `matches`, so a scored role "joins matches"
   *  everywhere the store is read. Returns the match, or null on failure. */
  scoreOne: (job: JobListing) => Promise<AiMatch | null>
  /** Bounded re-score of the student's EXISTING matches only (after a CV edit),
   *  then reload the fresh cached scores into the store. Cheaper and safer than
   *  a full Re-run — the server caps concurrency. Pass resumeId to refresh only
   *  that résumé's matches. */
  refresh: (userId: string, resumeId?: string) => Promise<void>
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
  missing: [],
  activity: null,
  scoring: [],
  activeResumeId: null,

  hydrate: async (userId, resumeId) => {
    const s = get()
    if (resumeId && s.activeResumeId !== resumeId) {
      // Different resume — clear and re-hydrate.
      set({ userId, phase: 'idle', done: 0, total: 0, label: '', matches: [], missing: [], scoring: [], activeResumeId: resumeId })
    }
    if (s.userId === userId && resumeId === s.activeResumeId && s.matches.length > 0) return
    const cached = await aiApi.cachedMatches(resumeId)
    if (cached.length) {
      const taskId = useAiActivity.getState().start('Restoring cached match scores')
      useAiActivity.getState().finish(taskId)
      set({ userId, phase: 'done', matches: cached, done: cached.length, total: cached.length, label: '', missing: [], scoring: [], activeResumeId: resumeId ?? null })
    }
  },

  scoreOne: async (job) => {
    const id = job.id
    if (get().scoring.includes(id)) return null
    set((st) => ({ scoring: [...st.scoring, id] }))
    try {
      const m = await aiApi.match({} as never, job)
      set((st) => ({
        scoring: st.scoring.filter((x) => x !== id),
        // Upsert: replace any prior entry for this job, so it "joins matches".
        matches: m ? [...st.matches.filter((x) => x.job_id !== id), m] : st.matches,
      }))
      return m
    } catch {
      set((st) => ({ scoring: st.scoring.filter((x) => x !== id) }))
      return null
    }
  },

  run: async (userId, force = false, resumeId) => {
    const s = get()
    if (resumeId !== s.activeResumeId) {
      // Resume changed — clear and start fresh for the new resume.
      set({ userId, phase: 'idle', done: 0, total: 0, label: '', matches: [], missing: [], scoring: [], activeResumeId: resumeId ?? null })
    }
    if (!force && !needsMatchRun(useMatchRun.getState().lastRun[userId])) {
      if (s.userId === userId && resumeId === s.activeResumeId && s.matches.length > 0) return
      const cached = await aiApi.cachedMatches(resumeId)
      if (cached.length) {
        const taskId = useAiActivity.getState().start('Restoring cached match scores')
        useAiActivity.getState().finish(taskId)
        set({ userId, phase: 'done', matches: cached, done: cached.length, total: cached.length, label: '', missing: [], scoring: [], activeResumeId: resumeId ?? null })
        return
      }
    }
    if (!force && s.userId === userId && resumeId === s.activeResumeId && (s.phase === 'running' || (s.phase === 'done' && s.matches.length > 0))) return

    // Don't start a run for a student without a résumé + preferences — the funnel
    // has nothing to rank a top-40 against. Surface what's missing so the UI can
    // prompt them instead. (The server enforces the same gate as a backstop.)
    const profile = useSession.getState().profile
    const readiness = matchReadiness(profile)
    if (!readiness.ready) {
      set({ userId, phase: 'notReady', missing: readiness.missing, matches: [], done: 0, total: 0, label: '', scoring: [], activeResumeId: resumeId ?? null })
      return
    }

    set({ userId, phase: 'running', done: 0, total: 0, label: 'Reading your profile…', matches: [], missing: [], scoring: [], activity: { step: 'reading', label: 'Reading your profile…' }, activeResumeId: resumeId ?? null })

    const act = useAiActivity.getState()
    const taskId = act.start(resumeId ? `Matching you to open roles (${resumeId})` : 'Matching you to open roles')
    act.update(taskId, { done: 0, total: 0, label: 'Reading your profile…' })

    // Safety net: if the run is still going after 120s with no completion (e.g. the
    // AI request hangs), fail it so the student returns to the board with a fallback
    // instead of being stranded on the match screen.
    const watchdog = setTimeout(() => {
      if (get().phase === 'running') {
        set({ phase: 'error', label: '', activity: null })
        act.finish(taskId, 'matching unavailable')
      }
    }, 120000)

    let notReady = false
    try {
      await aiApi.matchAllStream({
        onActivity: (step, label) => set({ activity: { step, label } }),
        onNotReady: (missing) => {
          notReady = true
          set({ phase: 'notReady', missing, label: '', done: 0, total: 0, activity: null, activeResumeId: resumeId ?? null })
          act.finish(taskId, 'complete your profile first')
        },
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
      }, resumeId)
      if (notReady) return // server refused — leave phase==='notReady' for the UI to prompt.
      act.finish(taskId)
      set({ phase: 'done', label: '', activity: null })
      useMatchRun.getState().markRun(userId)
    } catch {
      // Streaming unavailable → fall back to the one-shot endpoint so the user
      // still gets matches (just without per-role progress).
      try {
        const matches = await aiApi.matchAll({ id: userId } as any, [], resumeId)
        set({ matches, phase: matches.length ? 'done' : 'error', label: '', activity: null })
        act.finish(taskId, matches.length ? undefined : 'matching unavailable')
        if (matches.length) useMatchRun.getState().markRun(userId)
      } catch {
        set({ phase: 'error', label: '', activity: null })
        act.finish(taskId, 'matching unavailable')
      }
    } finally {
      clearTimeout(watchdog)
    }
  },

  reset: () => set({ userId: null, phase: 'idle', done: 0, total: 0, label: '', matches: [], missing: [], scoring: [], activeResumeId: null }),

  refresh: async (userId, resumeId) => {
    set({ phase: 'running', label: 'Refreshing your scores…', total: 0, done: 0, activeResumeId: resumeId ?? null })
    const act = useAiActivity.getState()
    const taskId = act.start('Refreshing your match scores')
    try {
      await aiApi.refreshMatches(resumeId)
      const fresh = await aiApi.cachedMatches(resumeId)
      act.finish(taskId, fresh.length ? undefined : 'nothing to refresh')
      set({ userId, phase: 'done', matches: fresh, done: fresh.length, total: fresh.length, label: '', missing: [], scoring: [], activeResumeId: resumeId ?? null })
    } catch {
      set({ phase: 'done', label: '' })
      act.finish(taskId, 'refresh failed')
    }
  },
}))
