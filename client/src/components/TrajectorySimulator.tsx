import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { TrendingUp, Target, RotateCcw } from 'lucide-react'
import type { AiMatch } from '@/types'
import { cn } from '@/lib/utils'

// Illustrative projection constants. The simulator does NOT call the scorer —
// it models how closing a known gap dimension would move the (already computed)
// match score. Clearly labeled as a projection, never a guarantee.
const TARGET = 90 // a gap dimension is "closed" once raised to this %
const MAX_GAIN = 35 // most a single round of gap-closing can add to the /99 score

type DimKey = 'skills' | 'experience' | 'location' | 'compensation'

const DIM_LABELS: Record<DimKey, string> = {
  skills: 'Strengthen skills alignment',
  experience: 'Gain relevant experience',
  location: 'Broaden location / remote flexibility',
  compensation: 'Align compensation expectations',
}
const DIM_SHORT: Record<DimKey, string> = {
  skills: 'Skills',
  experience: 'Experience',
  location: 'Location',
  compensation: 'Compensation',
}

function statusOf(score: number) {
  if (score >= 80) return { label: 'Strong match', tone: 'text-success' }
  if (score >= 60) return { label: 'Potential match', tone: 'text-accent' }
  return { label: 'Insufficient evidence', tone: 'text-muted-foreground' }
}

export function TrajectorySimulator({ match }: { match: AiMatch }) {
  const dims = match.breakdown

  const actions = useMemo(() => {
    return (Object.keys(DIM_LABELS) as DimKey[])
      .map((k) => {
        const current = Math.round(dims[k] ?? 0)
        const headroom = Math.max(0, TARGET - current)
        return { key: k, current, headroom }
      })
      .filter((a) => a.headroom > 4)
  }, [dims])

  const [selected, setSelected] = useState<Set<DimKey>>(new Set())

  const { totalHeadroom, selectedHeadroom } = useMemo(() => {
    let t = 0
    let s = 0
    for (const a of actions) {
      t += a.headroom
      if (selected.has(a.key)) s += a.headroom
    }
    return { totalHeadroom: t, selectedHeadroom: s }
  }, [actions, selected])

  const cap = Math.min(MAX_GAIN, 99 - match.score)
  const gain = totalHeadroom > 0 ? Math.round((selectedHeadroom / totalHeadroom) * cap) : 0
  const projected = Math.min(99, match.score + gain)

  const currentStatus = statusOf(match.score)
  const projectedStatus = statusOf(projected)

  // Greedily pick the highest-headroom actions until a Strong match is reachable.
  const minimal = useMemo(() => {
    if (match.score >= 80) return []
    const sorted = [...actions].sort((a, b) => b.headroom - a.headroom)
    const picked: DimKey[] = []
    let acc = 0
    for (const a of sorted) {
      picked.push(a.key)
      acc += a.headroom
      const g = totalHeadroom > 0 ? Math.round((acc / totalHeadroom) * cap) : 0
      if (match.score + g >= 80) break
    }
    return picked
  }, [actions, match.score, totalHeadroom, cap])

  function toggle(k: DimKey) {
    setSelected((s) => {
      const n = new Set(s)
      n.has(k) ? n.delete(k) : n.add(k)
      return n
    })
  }

  if (actions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Target className="mb-1 inline h-4 w-4 text-primary" /> Your profile already covers the main fit
        dimensions for this role — there's little room to project further gains here.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-3">
      <div className="mb-2 flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-primary" />
        <p className="text-sm font-semibold">Readiness Trajectory Simulator</p>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Plan the gaps you'll close. Toggle an action to project your future fit. This is an illustration of
        potential progress, not a guarantee.
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        {actions.map((a) => {
          const on = selected.has(a.key)
          return (
            <button
              key={a.key}
              type="button"
              onClick={() => toggle(a.key)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                on
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
              )}
            >
              {DIM_LABELS[a.key]}
              <span className="ml-1 opacity-60">+{a.headroom}</span>
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg bg-card p-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Current → Projected</p>
          <p className="text-sm font-medium">
            <span className={currentStatus.tone}>{match.score}</span>
            <span className="mx-1 text-muted-foreground">→</span>
            <motion.span
              key={projected}
              initial={{ opacity: 0.4 }}
              animate={{ opacity: 1 }}
              className={cn('font-bold', projectedStatus.tone)}
            >
              {projected}
            </motion.span>
            <span className="text-xs text-muted-foreground">/99</span>
          </p>
        </div>
        <div className="text-right">
          <p className={cn('text-sm font-semibold', projectedStatus.tone)}>{projectedStatus.label}</p>
          {gain > 0 && <p className="text-xs text-success">+{gain} pts if planned actions done</p>}
        </div>
      </div>

      {minimal.length > 0 && match.score < 80 && (
        <div className="mt-3 rounded-lg border border-border bg-muted/30 p-2.5 text-xs">
          <p className="font-medium text-foreground">Smallest path to a Strong match:</p>
          <p className="mt-1 text-muted-foreground">
            Close {minimal.map((k) => DIM_SHORT[k]).join(' + ')} to reach a Strong match for this role.
          </p>
        </div>
      )}

      {selected.size > 0 && (
        <button
          type="button"
          onClick={() => setSelected(new Set())}
          className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="h-3 w-3" /> Reset simulation
        </button>
      )}
    </div>
  )
}
