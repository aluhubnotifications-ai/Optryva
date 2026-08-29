import { cn } from '@/lib/utils'
import { useEffect, useState } from 'react'

const DANCE_FRAMES = [
  { transform: 'translateY(0) rotate(-5deg) scale(1)', tail1: 'M20 16L24 12' },
  { transform: 'translateY(-4px) rotate(8deg) scale(1.08)', tail1: 'M20 18L24 12' },
  { transform: 'translateY(0) rotate(0deg) scale(1)', tail1: 'M20 16L24 12' },
  { transform: 'translateY(-2px) rotate(6deg) scale(1.05)', tail1: 'M20 18L24 13' },
  { transform: 'translateY(0) rotate(-3deg) scale(1)', tail1: 'M20 16L24 12' },
]

/**
 * A small dancing mosquito mascot. Bounces with a slight wiggle using
 * frame-by-frame keyframes so students watching a longer load (e.g. AI job
 * matching) see life instead of a frozen spinner.
 */
export function DancingMascot({ className, size = 48 }: { className?: string; size?: number }) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % DANCE_FRAMES.length), 320)
    return () => clearInterval(id)
  }, [])

  const f = DANCE_FRAMES[frame]
  return (
    <div
      className={cn('inline-flex items-center justify-center', className)}
      style={{ transform: f.transform }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 32 32"
        fill="none"
        width={size}
        height={size}
        className="text-accent"
        xmlns="http://www.w3.org/2000/svg"
      >
        <style>{`
          @keyframes wing-flap { 0% { transform: rotate(0deg); } 50% { transform: rotate(15deg); } 100% { transform: rotate(0deg); } }
          .wing1 { animation: wing-flap 0.32s infinite ease-in-out; transform-origin: 20px 16px; }
          .wing2 { animation: wing-flap 0.32s infinite ease-in-out 0.16s; transform-origin: 20px 16px; }
        `}</style>
        <path
          d="M10 14c0-3.3 2.7-6 6-6s6 2.7 6 6-2.7 6-6 6-6-2.7-6-6z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <line x1="5" y1="5" x2="8" y2="8" />
          <line x1="24" y1="5" x2="21" y2="8" />
          <line x1="10" y1="22" x2="14" y2="26" />
          <line x1="22" y1="22" x2="18" y2="26" />
        </g>
        <line x1="20" y1="16" x2="24" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="wing1" />
        <path
          d="M16 16c-1.2 0-2.2-.4-3-1 .8-.6 1.8-1 3-1s2.2.4 3 1c.8.6 1.8 1 3 1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <circle cx="16" cy="24" r="1.5" fill="currentColor" />
        <circle cx="13.5" cy="13" r="1.2" fill="currentColor" />
        <circle cx="18.5" cy="13" r="1.2" fill="currentColor" />
      </svg>
    </div>
  )
}

/** Centered mosquito mascot + message for student loading / suspense states. */
export function LoadingMascot({ label }: { label?: string }) {
  return (
    <div className="flex w-full flex-col items-center justify-center gap-4 py-24 text-muted-foreground">
      <DancingMascot size={80} />
      {label && <p className="text-sm">{label}</p>}
    </div>
  )
}
