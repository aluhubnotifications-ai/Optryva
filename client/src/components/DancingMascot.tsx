import { cn } from '@/lib/utils'

/**
 * A small dancing mascot built from the Optryva logo shape (a diamond with a
 * dot in the middle). It bounces with a slight wiggle so students watching a
 * longer load (e.g. AI job matching) see life instead of a frozen spinner.
 */
export function DancingMascot({ className, size = 48 }: { className?: string; size?: number }) {
  return (
    <div
      className={cn(
        'inline-flex items-center justify-center',
        'animate-bounce delay-150',
        '[animation-duration:1.6s]',
        className,
      )}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 32 32"
        fill="none"
        width={size}
        height={size}
        className="text-accent"
      >
        <path
          d="M16 5l9 5v12l-9 5-9-5V10l9-5z"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinejoin="round"
          className="drop-shadow-xl"
        />
        <circle cx="16" cy="15.5" r="3.4" fill="currentColor" />
      </svg>
    </div>
  )
}

/** Centered mascot + message for student loading / suspense states. */
export function LoadingMascot({ label }: { label?: string }) {
  return (
    <div className="flex w-full flex-col items-center justify-center gap-4 py-24 text-muted-foreground">
      <DancingMascot size={64} />
      {label && <p className="text-sm">{label}</p>}
    </div>
  )
}
