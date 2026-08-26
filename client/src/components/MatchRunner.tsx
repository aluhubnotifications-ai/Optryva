import { useEffect } from 'react'
import { useTransitionNavigate } from '@/lib/useTransitionNavigate'
import { Sparkles, AlertTriangle, FileText, SlidersHorizontal } from 'lucide-react'
import { Card, CardBody, Progress } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { useMatchProgress } from '@/lib/matchProgress'
import { useCurrentUser } from '@/lib/store'
import { matchReadiness, type MatchMissing } from '@/lib/matchReady'

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
  title = 'Run your AI matches',
  subtitle,
  resumePresent,
}: {
  userId: string
  onComplete: () => void
  title?: string
  subtitle?: string
  /** True when the user has an active structured résumé (resume_profiles). Lets the
   *  gate recognise résumés that live in the new résumé system, not just legacy cv_text. */
  resumePresent?: boolean
}) {
  const { phase, done, total, label, missing } = useMatchProgress()
  const user = useCurrentUser()
  const navigate = useTransitionNavigate()
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  // Advance the page once the run completes.
  useEffect(() => {
    if (phase === 'done') onComplete()
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
          <h2 className="text-xl font-bold tracking-tight">{errored ? 'Couldn’t run matching' : title}</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            {errored
              ? 'The AI scorer didn’t respond. This is usually temporary — check your connection and try again.'
              : subtitle ?? "We'll read your CV & profile and score today's opportunities 0–99 for fit, then show you the best ones first. You can switch tabs — progress keeps running in the AI activity panel."}
          </p>
          <Button size="lg" variant={errored ? 'outline' : 'default'} className="mt-2 gap-2" onClick={go}>
            <Sparkles className="h-4 w-4" /> {errored ? 'Try again' : 'Run AI matching'}
          </Button>
        </CardBody>
      </Card>
    )
  }

  // Running — honest percentage + the role currently being scored.
  return (
    <Card>
      <CardBody className="py-14">
        <div className="mx-auto max-w-md">
          <div className="mb-5 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/12 text-primary">
              <Sparkles className="h-8 w-8 animate-pulse" />
            </div>
          </div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">Scoring your matches…</span>
            <span className="font-bold text-primary">{pct}%</span>
          </div>
          <Progress value={pct} />
          <p className="mt-3 truncate text-center text-sm text-muted-foreground">
            {total > 0 ? `${done} of ${total} roles` : 'Reading your profile…'}
            {label ? ` · ${label}` : ''}
          </p>
        </div>
      </CardBody>
    </Card>
  )
}
