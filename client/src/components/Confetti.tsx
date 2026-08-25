import { motion } from 'framer-motion'
import { useMemo } from 'react'

const COLORS = ['#6366f1', '#22d3ee', '#f59e0b', '#ec4899', '#10b981', '#a855f7']

// Self-contained confetti burst (no extra dependency) — pieces fly up and fall
// away. Rendered only while the onboarding finish celebration is active.
export function Confetti({ count = 28 }: { count?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }).map((_, i) => ({
        id: i,
        x: (Math.random() * 2 - 1) * 260,
        y: -(120 + Math.random() * 180),
        rot: Math.random() * 540 - 270,
        delay: Math.random() * 0.12,
        color: COLORS[i % COLORS.length],
        w: 7 + Math.random() * 6,
        h: 10 + Math.random() * 8,
      })),
    [count],
  )
  return (
    <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center overflow-hidden">
      {pieces.map((p) => (
        <motion.div
          key={p.id}
          initial={{ opacity: 1, x: 0, y: 0, rotate: 0 }}
          animate={{ opacity: 0, x: p.x, y: p.y + 240, rotate: p.rot }}
          transition={{ duration: 1.2, delay: p.delay, ease: 'easeOut' }}
          style={{ position: 'absolute', width: p.w, height: p.h, borderRadius: 2, background: p.color }}
        />
      ))}
    </div>
  )
}
