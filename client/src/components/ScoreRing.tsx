import { cn } from '@/lib/utils'

function band(score: number) {
  if (score >= 85) return { label: 'Excellent', color: 'hsl(var(--success))', tone: 'text-success' }
  if (score >= 70) return { label: 'Strong', color: 'hsl(var(--accent))', tone: 'text-accent' }
  if (score >= 50) return { label: 'Possible', color: 'hsl(210 90% 52%)', tone: 'text-[hsl(210_90%_52%)]' }
  if (score >= 30) return { label: 'Weak', color: 'hsl(var(--warning))', tone: 'text-warning' }
  return { label: 'Poor', color: 'hsl(var(--danger))', tone: 'text-danger' }
}

export function scoreBand(score: number) {
  return band(score)
}

export function ScoreRing({
  score,
  size = 64,
  stroke = 6,
  showLabel = false,
  className,
}: {
  score: number
  size?: number
  stroke?: number
  showLabel?: boolean
  className?: string
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c - (score / 100) * c
  const b = band(score)
  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={b.color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('font-bold leading-none', b.tone)} style={{ fontSize: size * 0.28 }}>
          {score}
        </span>
        {showLabel && <span className={cn('mt-0.5 text-[9px] font-medium', b.tone)}>{b.label}</span>}
      </div>
    </div>
  )
}
