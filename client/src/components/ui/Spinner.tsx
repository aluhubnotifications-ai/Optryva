import { cn } from '@/lib/utils'
import { DancingMascot } from '@/components/DancingMascot'

/** Dancing mascot loader. Sizes via className; color follows `currentColor`. */
export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-label={label ?? 'Loading'} className="inline-flex items-center gap-2">
      <DancingMascot size={16} className={className} />
      {label && <span className="text-sm">{label}</span>}
    </span>
  )
}

/** Centered full-width mascot loader for empty/suspense states. */
export function PageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex w-full flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
      <DancingMascot size={80} />
      {label && <p className="text-sm">{label}</p>}
    </div>
  )
}
