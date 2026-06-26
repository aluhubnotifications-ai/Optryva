import { create } from 'zustand'

// ----------------------------------------------------------------------------
// AI activity bus. Every AI/matching call reports here (via `trackAi`) so the
// student always has a window into what the engine is doing — running, done, or
// failed — instead of guessing. There is no persistent "worker" to wake; this
// surfaces the real, request-driven activity as it happens.
// ----------------------------------------------------------------------------

export type TaskState = 'running' | 'done' | 'error'

export interface AiTask {
  id: string
  label: string
  state: TaskState
  startedAt: number
  endedAt?: number
  error?: string
}

interface AiActivityState {
  tasks: AiTask[] // most recent first, capped
  open: boolean
  start: (label: string) => string
  finish: (id: string, error?: string) => void
  toggle: () => void
  setOpen: (open: boolean) => void
  clear: () => void
}

const MAX = 25
let seq = 0

export const useAiActivity = create<AiActivityState>((set) => ({
  tasks: [],
  open: false,
  start: (label) => {
    const id = `ai_${Date.now()}_${seq++}`
    const task: AiTask = { id, label, state: 'running', startedAt: Date.now() }
    set((s) => ({ tasks: [task, ...s.tasks].slice(0, MAX) }))
    return id
  },
  finish: (id, error) =>
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id ? { ...t, state: error ? 'error' : 'done', endedAt: Date.now(), error } : t,
      ),
    })),
  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
  clear: () => set((s) => ({ tasks: s.tasks.filter((t) => t.state === 'running') })),
}))

/**
 * Wrap an AI operation so it shows up in the activity panel. Records a running
 * task, marks it done on success or error on failure, then rethrows so callers
 * keep their existing fallback behaviour.
 */
export async function trackAi<T>(label: string, run: () => Promise<T>): Promise<T> {
  const { start, finish } = useAiActivity.getState()
  const id = start(label)
  try {
    const r = await run()
    finish(id)
    return r
  } catch (e: any) {
    finish(id, e?.message ?? 'request failed')
    throw e
  }
}
