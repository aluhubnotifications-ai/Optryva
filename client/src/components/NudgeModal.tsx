import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Check, ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { OnboardingMascot } from '@/components/OnboardingMascot'
import { Confetti } from '@/components/Confetti'
import { Button } from '@/components/ui/Button'

export interface NudgeItem {
  key: string
  label: string
  cta: string
  to: string
}

const DISMISS_KEY = 'optryva-nudge-dismissed'

/** Animated modal that nudges a student (who finished onboarding) to complete the
 *  still-missing important profile bits — preferences, portfolio/evidence, skills.
 *  Shown only after the required onboarding steps are done (the router sends
 *  unfinished users back into the wizard instead). */
export function NudgeModal({ items, onClose }: { items: NudgeItem[]; onClose: () => void }) {
  const navigate = useNavigate()
  const [burst, setBurst] = useState(false)

  function act(item: NudgeItem) {
    setBurst(true)
    window.setTimeout(() => {
      onClose()
      navigate(item.to)
    }, 650)
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[70] flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="relative w-full max-w-md rounded-3xl border border-border bg-card p-6 text-center shadow-card"
          initial={{ opacity: 0, scale: 0.9, y: 24 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        >
          <button
            onClick={onClose}
            aria-label="Dismiss"
            className="absolute right-3 top-3 rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>

          <motion.div
            className="mx-auto mb-3"
            animate={{ rotate: [0, -8, 8, -5, 0], y: [0, -6, 0] }}
            transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
          >
            <OnboardingMascot celebrating className="h-20 w-20" />
          </motion.div>

          <h2 className="text-xl font-extrabold tracking-tight">You&apos;re almost there! 🚀</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add a few details to stand out to employers and unlock smarter matches.
          </p>

          <ul className="mt-4 space-y-2 text-left">
            {items.map((it) => (
              <li
                key={it.key}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 p-3"
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  {it.label}
                </span>
                <Button size="sm" className="gap-1" onClick={() => act(it)}>
                  {it.cta} <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>

          <button
            onClick={onClose}
            className="mt-4 text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
          >
            Remind me later
          </button>
        </motion.div>

        {burst && (
          <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center">
            <Confetti count={60} />
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  )
}

export function nudgeDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

export function dismissNudge() {
  try {
    sessionStorage.setItem(DISMISS_KEY, '1')
  } catch {
    /* ignore */
  }
}
