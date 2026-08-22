import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ApplicationStatus } from '@/types'

const STEPS = ['Applied', 'Reviewed', 'Shortlisted', 'Decision'] as const

function stepIndex(status: ApplicationStatus) {
  switch (status) {
    case 'pending':
      return 0
    case 'reviewed':
      return 1
    case 'shortlisted':
      return 2
    case 'hired':
    case 'rejected':
      return 3
    default:
      return -1
  }
}

export function AppProgressSteps({ status, compact }: { status: ApplicationStatus; compact?: boolean }) {
  const current = stepIndex(status)
  const rejected = status === 'rejected'

  return (
    <div className="flex items-center">
      {STEPS.map((label, i) => {
        const done = i < current || (i === current && (status === 'hired' || status === 'rejected'))
        const active = i === current
        const isDecision = i === 3
        const decided = isDecision && (status === 'hired' || status === 'rejected')
        return (
          <div key={label} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'flex items-center justify-center rounded-full border-2 transition-colors',
                  compact ? 'h-6 w-6' : 'h-8 w-8',
                  decided
                    ? rejected
                      ? 'border-danger bg-danger text-danger-foreground'
                      : 'border-success bg-success text-success-foreground'
                    : done || active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card text-muted-foreground',
                )}
              >
                {decided ? (
                  rejected ? <X className={compact ? 'h-3 w-3' : 'h-4 w-4'} /> : <Check className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
                ) : done ? (
                  <Check className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
                ) : (
                  <span className={compact ? 'text-[10px]' : 'text-xs'}>{i + 1}</span>
                )}
              </div>
              {!compact && (
                <span className={cn('mt-1.5 text-[11px] font-medium', active || done ? 'text-foreground' : 'text-muted-foreground')}>
                  {isDecision && decided ? (rejected ? 'Rejected' : 'Accepted') : label}
                </span>
              )}
            </div>
            {i < STEPS.length - 1 && (
              <div className={cn('mx-1 h-0.5 flex-1 rounded-full', i < current ? 'bg-primary' : 'bg-border')} />
            )}
          </div>
        )
      })}
    </div>
  )
}
