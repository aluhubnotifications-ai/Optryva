import { useEffect } from 'react'
import { Sparkles, AlertTriangle } from 'lucide-react'
import { Card, CardBody, Progress } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { useMatchProgress } from '@/lib/matchProgress'

/**
 * The "Run AI matching" gate + REAL progress. Driven by the global match-progress
 * store, so it shows an honest percentage and the role being scored right now —
 * and the run keeps going (and stays visible in the AI activity panel) even if
 * you switch tabs. `onComplete` fires once the run finishes.
 */
export function MatchRunner({
  userId,
  onComplete,
  title = 'Run your AI matches',
  subtitle,
}: {
  userId: string
  onComplete: () => void
  title?: string
  subtitle?: string
}) {
  const { phase, done, total, label } = useMatchProgress()
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  // Advance the page once the run completes.
  useEffect(() => {
    if (phase === 'done') onComplete()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const go = () => useMatchProgress.getState().run(userId, true)

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
