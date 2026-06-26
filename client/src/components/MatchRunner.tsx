import { useState } from 'react'
import { Sparkles, FileSearch, ScanLine, Trophy, CheckCircle2, AlertTriangle } from 'lucide-react'
import { Card, CardBody, Progress } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { sleep } from '@/lib/utils'
import { trackAi } from '@/lib/aiActivity'

const STAGES = [
  { icon: FileSearch, label: 'Reading your résumé & profile…' },
  { icon: ScanLine, label: 'Scanning open opportunities…' },
  { icon: Sparkles, label: 'Scoring each role against your skills…' },
  { icon: Trophy, label: 'Ranking your best matches…' },
]

/**
 * The "Run AI matching" gate + staged loader. `onRun` should resolve when the
 * real (mock) matching data is ready; `onComplete` fires after the animation.
 */
export function MatchRunner({
  onRun,
  onComplete,
  title = 'Run your AI matches',
  subtitle,
}: {
  onRun: () => Promise<void>
  onComplete: () => void
  title?: string
  subtitle?: string
}) {
  const [phase, setPhase] = useState<'idle' | 'running' | 'error'>('idle')
  const [stage, setStage] = useState(0)

  async function go() {
    setPhase('running')
    setStage(0)
    try {
      // Real work + activity-panel reporting; the staged labels animate over it.
      const work = trackAi('Running your AI matches', onRun)
      for (let i = 0; i < STAGES.length; i++) {
        setStage(i)
        await sleep(620)
      }
      await work // surfaces a real failure instead of faking success
      onComplete()
    } catch {
      setPhase('error')
    }
  }

  if (phase === 'idle') {
    return (
      <Card>
        <CardBody className="mesh-bg flex flex-col items-center justify-center gap-3 rounded-2xl py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/12 text-primary shadow-glow">
            <Sparkles className="h-8 w-8" />
          </div>
          <h2 className="text-xl font-bold tracking-tight">{title}</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            {subtitle ?? "We'll read your CV & profile and score today's opportunities 0–99 for fit, then show you the best ones first."}
          </p>
          <Button size="lg" className="mt-2 gap-2" onClick={go}>
            <Sparkles className="h-4 w-4" /> Run AI matching
          </Button>
        </CardBody>
      </Card>
    )
  }

  if (phase === 'error') {
    return (
      <Card>
        <CardBody className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-danger/12 text-danger">
            <AlertTriangle className="h-8 w-8" />
          </div>
          <h2 className="text-xl font-bold tracking-tight">Couldn’t run matching</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            The AI scorer didn’t respond. This is usually temporary — check your connection and try again.
          </p>
          <Button size="lg" variant="outline" className="mt-2 gap-2" onClick={go}>
            <Sparkles className="h-4 w-4" /> Try again
          </Button>
        </CardBody>
      </Card>
    )
  }

  const pct = Math.round(((stage + 1) / STAGES.length) * 100)
  return (
    <Card>
      <CardBody className="py-14">
        <div className="mx-auto max-w-md">
          <div className="mb-6 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/12 text-primary">
              <Sparkles className="h-8 w-8 animate-pulse" />
            </div>
          </div>
          <Progress value={pct} />
          <div className="mt-6 space-y-2.5">
            {STAGES.map((s, i) => {
              const state = i < stage ? 'done' : i === stage ? 'active' : 'pending'
              return (
                <div key={i} className={`flex items-center gap-2.5 text-sm transition-opacity ${state === 'pending' ? 'opacity-40' : ''}`}>
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full ${state === 'done' ? 'bg-success/15 text-success' : state === 'active' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
                    {state === 'done' ? <CheckCircle2 className="h-4 w-4" /> : <s.icon className={`h-3.5 w-3.5 ${state === 'active' ? 'animate-pulse' : ''}`} />}
                  </span>
                  <span className={state === 'active' ? 'font-medium' : 'text-muted-foreground'}>{s.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      </CardBody>
    </Card>
  )
}
