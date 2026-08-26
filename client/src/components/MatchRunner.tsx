import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTransitionNavigate } from '@/lib/useTransitionNavigate'
import { Sparkles, AlertTriangle, FileText, SlidersHorizontal, Check, Loader2, User, FileSearch, BarChart3, ListOrdered } from 'lucide-react'
import { Card, CardBody, Progress } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { useMatchProgress } from '@/lib/matchProgress'
import { useCurrentUser } from '@/lib/store'
import { matchReadiness, type MatchMissing } from '@/lib/matchReady'
import { cn } from '@/lib/utils'

/**
 * The "Run AI matching" gate + REAL progress. Driven by the global match-progress
 * store, so it shows an honest percentage and the role being scored right now —
 * and the run keeps going (and stays visible in the AI activity panel) even if
 * you switch tabs. `onComplete` fires once the run finishes.
 *
 * Before anything runs we check the student has a résumé AND preferences — the
 * funnel ranks the whole catalog by similarity to their profile, so with neither
 * there's nothing to rank against. When they're missing we prompt to complete the
 * profile instead of running (the server enforces the same gate).
 */
export function MatchRunner({
  userId,
  onComplete,
  onError,
  title = 'Run your AI matches',
  subtitle,
  resumePresent,
}: {
  userId: string
  onComplete: () => void
  /** Called when the AI is unavailable/failed — lets the parent return the student
   *  to the opportunities board (with a basic fallback) instead of stranding them
   *  on the match screen. */
  onError?: () => void
  title?: string
  subtitle?: string
  /** True when the user has an active structured résumé (resume_profiles). Lets the
   *  gate recognise résumés that live in the new résumé system, not just legacy cv_text. */
  resumePresent?: boolean
}) {
  const { phase, done, total, label, missing, activity } = useMatchProgress()
  const user = useCurrentUser()
  const navigate = useTransitionNavigate()
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  // When the run finishes, advance to the opportunities. If the AI is unavailable we
  // also return to the board (with a basic fallback) rather than stranding the user.
  useEffect(() => {
    if (phase === 'done') onComplete()
    else if (phase === 'error') (onError ?? onComplete)()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const go = () => useMatchProgress.getState().run(userId, true)

  // Profile completeness gate — checked client-side up front, and again via the
  // server's `notReady` signal (phase === 'notReady') as the source of truth.
  const local = matchReadiness(user, resumePresent)
  // If we already know a CV file or active résumé exists, treat the résumé as present
  // even though the server's text extraction (a slow Claude call) may not have run yet.
  // This prevents a false "no résumé" prompt while the server is still parsing.
  const clientHasResume = !!((user?.cv_text ?? '').trim() || user?.cv_filename || user?.cv_url || resumePresent)
  const serverMissing = phase === 'notReady' ? ((missing as MatchMissing[] | undefined) ?? []) : []
  const effectiveMissing = Array.from(new Set([...local.missing, ...serverMissing])).filter(
    (m) => (m === 'resume' ? !clientHasResume : true),
  )
  const blocked = effectiveMissing.length > 0
  if (blocked && phase !== 'running') {
    const needsResume = effectiveMissing.includes('resume')
    const needsPrefs = effectiveMissing.includes('preferences')
    return (
      <Card>
        <CardBody className="mesh-bg flex flex-col items-center justify-center gap-3 rounded-2xl py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/12 text-primary shadow-glow">
            <Sparkles className="h-8 w-8" />
          </div>
          <h2 className="text-xl font-bold tracking-tight">Let’s set up your matches first</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            To score the best opportunities for you, we match your{' '}
            {needsResume && needsPrefs ? 'résumé and preferences' : needsResume ? 'résumé' : 'preferences'} against open
            roles. Add {needsResume && needsPrefs ? 'them' : 'it'} below and we’ll find your top fits.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            {needsResume && (
              <Button variant="default" className="gap-2" onClick={() => navigate('/app/profile')}>
                <FileText className="h-4 w-4" /> Upload your résumé
              </Button>
            )}
            {needsPrefs && (
              <Button variant={needsResume ? 'outline' : 'default'} className="gap-2" onClick={() => navigate('/app/profile')}>
                <SlidersHorizontal className="h-4 w-4" /> Set your preferences
              </Button>
            )}
          </div>
        </CardBody>
      </Card>
    )
  }

  if (phase === 'idle' || phase === 'error') {
    const errored = phase === 'error'
    return (
      <Card>
        <CardBody className="mesh-bg flex flex-col items-center justify-center gap-3 rounded-2xl py-16 text-center">
          <div className={`flex h-16 w-16 items-center justify-center rounded-2xl ${errored ? 'bg-danger/12 text-danger' : 'bg-primary/12 text-primary shadow-glow'}`}>
            {errored ? <AlertTriangle className="h-8 w-8" /> : <Sparkles className="h-8 w-8" />}
          </div>
          <h2 className="text-xl font-bold tracking-tight">{errored ? 'Couldn’t reach the AI' : title}</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            {errored
              ? 'The AI scorer is unavailable right now, so we’re showing opportunities without AI ranking. You can browse roles and try matching again later.'
              : subtitle ?? "We'll read your CV & profile and score today's opportunities 0–99 for fit, then show you the best ones first. You can switch tabs — progress keeps running in the AI activity panel."}
          </p>
          {errored ? (
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <Button size="lg" variant="default" className="gap-2" onClick={() => (onError ?? onComplete)()}>
                <Sparkles className="h-4 w-4" /> Browse opportunities
              </Button>
              <Button size="lg" variant="outline" className="gap-2" onClick={go}>
                <Sparkles className="h-4 w-4" /> Try again
              </Button>
            </div>
          ) : (
            <Button size="lg" variant="default" className="mt-2 gap-2" onClick={go}>
              <Sparkles className="h-4 w-4" /> Run AI matching
            </Button>
          )}
        </CardBody>
      </Card>
    )
  }

  // Running — a live, animated "AI is working" pipeline so the wait feels alive
  // (like a file-copy dialog): it shows exactly what's happening, step by step.
  const PIPELINE = [
    { key: 'reading', label: 'Reading your profile', icon: User },
    { key: 'resume', label: 'Extracting & understanding your résumé', icon: FileSearch },
    { key: 'scoring', label: 'Scoring open roles', icon: BarChart3 },
    { key: 'ranking', label: 'Ranking your best fits', icon: ListOrdered },
  ] as const
  const stepKey = phase === 'done' ? 'ranking' : activity?.step ?? (total > 0 ? 'scoring' : 'reading')
  const activeIdx = PIPELINE.findIndex((s) => s.key === stepKey)
  const pctNow = total > 0 ? Math.round((done / total) * 100) : pct

  return (
    <Card className="overflow-hidden border-primary/20">
      <CardBody className="mesh-bg py-10">
        <div className="mx-auto max-w-lg">
          {/* Header */}
          <div className="mb-7 flex items-center gap-3">
            <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-white shadow-glow">
              <Sparkles className="h-6 w-6 animate-pulse" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">Matching you to open roles</h2>
              <p className="text-sm text-muted-foreground">
                {activity?.label ?? (total > 0 ? 'Scoring open roles…' : 'Reading your profile…')}
              </p>
            </div>
          </div>

          {/* Pipeline steps */}
          <ol className="relative ml-1 space-y-3">
            {PIPELINE.map((s, i) => {
              const status = phase === 'done' || i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending'
              const Icon = s.icon
              return (
                <li key={s.key} className="flex items-center gap-3">
                  <motion.div
                    initial={false}
                    animate={{ scale: status === 'active' ? [1, 1.08, 1] : 1 }}
                    transition={{ duration: 1.1, repeat: status === 'active' ? Infinity : 0, ease: 'easeInOut' }}
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                      status === 'done' && 'border-success bg-success text-white',
                      status === 'active' && 'border-primary bg-primary/15 text-primary shadow-glow',
                      status === 'pending' && 'border-border bg-muted text-muted-foreground',
                    )}
                  >
                    {status === 'done' ? (
                      <Check className="h-4 w-4" />
                    ) : status === 'active' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Icon className="h-4 w-4" />
                    )}
                  </motion.div>
                  <span
                    className={cn(
                      'text-sm',
                      status === 'pending' ? 'text-muted-foreground' : 'font-medium',
                      status === 'done' && 'text-success',
                    )}
                  >
                    {s.label}
                  </span>
                  {s.key === 'scoring' && total > 0 && (
                    <span className="ml-auto text-xs font-semibold text-primary">{done}/{total}</span>
                  )}
                </li>
              )
            })}
          </ol>

          {/* Live "what's happening right now" + progress */}
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="truncate font-medium text-foreground/80">
                {label ? `Scoring: ${label}` : total > 0 ? `Scoring ${done} of ${total} roles…` : 'Preparing your profile…'}
              </span>
              <span className="ml-3 shrink-0 font-bold text-primary">{pctNow}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              {total > 0 ? (
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-primary via-accent to-primary"
                  animate={{ width: `${pctNow}%` }}
                  transition={{ ease: 'easeOut', duration: 0.4 }}
                />
              ) : (
                <motion.div
                  className="h-full w-1/3 rounded-full bg-gradient-to-r from-primary/40 via-accent to-primary/40"
                  animate={{ x: ['-100%', '300%'] }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}
            </div>
          </div>

          {/* AI activity visualization — reflects the live step so the wait feels alive */}
          <div className="mt-6 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 to-accent/5 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/70" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
                </span>
                <span className="text-xs font-semibold uppercase tracking-wide text-accent">AI activity</span>
              </div>
              <span className="max-w-[12rem] truncate text-xs text-muted-foreground">
                {activity?.label ?? 'Thinking…'}
              </span>
            </div>
            <div className="flex h-12 items-end justify-center gap-1">
              {Array.from({ length: 20 }).map((_, i) => (
                <motion.span
                  key={i}
                  className="w-1.5 rounded-full bg-gradient-to-t from-primary/40 via-accent to-primary"
                  initial={{ height: 6 }}
                  animate={{ height: [6, 40 - (i % 6) * 5, 14, 32 - (i % 5) * 4, 6] }}
                  transition={{ duration: 0.7 + (i % 6) * 0.12, repeat: Infinity, ease: 'easeInOut' }}
                />
              ))}
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}
