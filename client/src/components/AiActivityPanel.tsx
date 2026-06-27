import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Activity, Loader2, CheckCircle2, AlertTriangle, X, Sparkles } from 'lucide-react'
import { useAiActivity, type AiTask, type TaskProgress } from '@/lib/aiActivity'
import { cn } from '@/lib/utils'

/**
 * Always-on window into what Optryva's AI is doing — matching, research, the
 * career compass, CV review. Lives bottom-right of the student app: a small
 * status pill that expands into a live activity log. No infra jargon; this is
 * the user's "is it working?" answer at a glance.
 */
export function AiActivityPanel() {
  const { tasks, open, toggle, setOpen, clear } = useAiActivity()
  const running = tasks.filter((t) => t.state === 'running')
  const latest = tasks[0]
  const hasError = tasks.some((t) => t.state === 'error') && !running.length

  // Auto-open briefly when work starts, so the user notices the AI is busy.
  useEffect(() => {
    if (running.length > 0) setOpen(true)
  }, [running.length, setOpen])

  const status: 'busy' | 'error' | 'idle' = running.length ? 'busy' : hasError ? 'error' : 'idle'
  const dot =
    status === 'busy' ? 'bg-accent' : status === 'error' ? 'bg-danger' : 'bg-muted-foreground/50'
  const runningPct = (() => {
    const p = running[0]?.progress
    return p && p.total > 0 ? Math.round((p.done / p.total) * 100) : null
  })()
  const pillLabel =
    status === 'busy'
      ? `${running[0]?.label ?? 'AI working…'}${runningPct != null ? ` · ${runningPct}%` : ''}`
      : status === 'error'
        ? 'AI had an issue'
        : 'AI idle'

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 360, damping: 30 }}
            className="glass w-[19rem] overflow-hidden rounded-2xl border border-border shadow-card"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-accent" />
                <span className="text-sm font-semibold">AI activity</span>
              </div>
              <div className="flex items-center gap-1">
                {tasks.length > 0 && (
                  <button onClick={clear} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted">
                    Clear
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto p-2">
              {tasks.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
                  <Activity className="h-5 w-5 text-muted-foreground" />
                  <p className="text-sm font-medium">Nothing running</p>
                  <p className="text-xs text-muted-foreground">
                    Matching, company research, and the career compass will show up here while they work.
                  </p>
                </div>
              ) : (
                <ul className="space-y-0.5">
                  {tasks.map((t) => (
                    <TaskRow key={t.id} task={t} />
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={toggle}
        className="glass flex items-center gap-2 rounded-full border border-border px-3.5 py-2 text-sm font-medium shadow-card transition-colors hover:bg-muted"
        title="What the AI is doing"
      >
        {status === 'busy' ? (
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
        ) : (
          <span className={cn('h-2.5 w-2.5 rounded-full', dot, status === 'error' && 'animate-pulse')} />
        )}
        <span className="max-w-[10rem] truncate">{pillLabel}</span>
        {running.length > 1 && (
          <span className="rounded-full bg-accent/15 px-1.5 text-xs font-semibold text-accent">{running.length}</span>
        )}
      </button>
    </div>
  )
}

function TaskRow({ task }: { task: AiTask }) {
  return (
    <li className="flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-muted/60">
      <span className="mt-0.5">
        {task.state === 'running' ? (
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
        ) : task.state === 'error' ? (
          <AlertTriangle className="h-4 w-4 text-danger" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-success" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{task.label}</p>
        {task.state === 'error' ? (
          <p className="text-xs text-danger">Couldn’t reach the AI — using a basic fallback.</p>
        ) : task.state === 'running' && task.progress && task.progress.total > 0 ? (
          <ProgressLine progress={task.progress} />
        ) : (
          <p className="text-xs text-muted-foreground">
            {task.state === 'running' ? 'Working…' : 'Done'} · <RelTime ts={task.endedAt ?? task.startedAt} />
          </p>
        )}
      </div>
    </li>
  )
}

/** Percentage bar + "X of N · <current step>" for a long, multi-step task. */
function ProgressLine({ progress }: { progress: TaskProgress }) {
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  return (
    <div className="mt-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{progress.done} of {progress.total} roles</span>
        <span className="font-semibold text-accent">{pct}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
      {progress.label && <p className="mt-1 truncate text-xs text-muted-foreground">Scoring: {progress.label}</p>}
    </div>
  )
}

/** Tiny live-updating relative timestamp ("just now", "2m ago"). */
function RelTime({ ts }: { ts: number }) {
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 15000)
    return () => clearInterval(id)
  }, [])
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000))
  const label = secs < 10 ? 'just now' : secs < 60 ? `${secs}s ago` : secs < 3600 ? `${Math.floor(secs / 60)}m ago` : `${Math.floor(secs / 3600)}h ago`
  return <span>{label}</span>
}
