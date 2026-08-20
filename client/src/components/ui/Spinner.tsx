import { cn } from '@/lib/utils'

/** Indeterminate spinner. Sizes via className; color follows `currentColor`. */
export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-label={label ?? 'Loading'} className="inline-flex items-center gap-2">
      <span
        className={cn(
          'inline-block animate-spin rounded-full border-2 border-current border-t-transparent',
          className ?? 'h-4 w-4',
        )}
      />
      {label && <span className="text-sm">{label}</span>}
    </span>
  )
}

/** Centered full-width spinner for empty/suspense states. */
export function PageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex w-full flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
      <Spinner className="h-7 w-7 text-accent" />
      {label && <p className="text-sm">{label}</p>}
    </div>
  )
}
