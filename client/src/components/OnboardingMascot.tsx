import { motion } from 'framer-motion'

// Optryva's hexagon logo reimagined as a friendly character. It pops in on mount
// (the parent remounts it per step via `key`) and gently bobs; on `celebrating`
// it does a happy spin-and-jump.
export function OnboardingMascot({ className, celebrating = false }: { className?: string; celebrating?: boolean }) {
  return (
    <motion.div
      className={className}
      initial={{ scale: 0.5, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 16 }}
    >
      <motion.div
        animate={celebrating ? { rotate: [0, -14, 14, -8, 8, 0], y: [0, -22, 0] } : { y: [0, -5, 0] }}
        transition={celebrating ? { duration: 0.9, ease: 'easeInOut' } : { duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <svg viewBox="0 0 64 64" className="h-full w-full drop-shadow-sm">
          <defs>
            <linearGradient id="mascotGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" />
              <stop offset="100%" stopColor="hsl(var(--accent))" />
            </linearGradient>
          </defs>
          <path
            d="M32 5 L54 18 L54 46 L32 59 L10 46 L10 18 Z"
            fill="url(#mascotGrad)"
            stroke="white"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <circle cx="24" cy="29" r="4.6" fill="white" />
          <circle cx="40" cy="29" r="4.6" fill="white" />
          <circle cx="25" cy="30" r="2.3" fill="#1f2937" />
          <circle cx="41" cy="30" r="2.3" fill="#1f2937" />
          <path d="M25 39 Q32 46 39 39" stroke="white" strokeWidth="2.6" fill="none" strokeLinecap="round" />
          <circle cx="17" cy="37" r="2.6" fill="white" opacity="0.55" />
          <circle cx="47" cy="37" r="2.6" fill="white" opacity="0.55" />
        </svg>
      </motion.div>
    </motion.div>
  )
}
