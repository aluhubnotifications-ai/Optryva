import { cn } from '@/lib/utils'

export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-glow',
        className,
      )}
    >
      <svg viewBox="0 0 32 32" fill="none" className="h-[60%] w-[60%]">
        <path
          d="M16 5l9 5v12l-9 5-9-5V10l9-5z"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
        <circle cx="16" cy="15.5" r="3.4" fill="currentColor" />
      </svg>
    </span>
  )
}
