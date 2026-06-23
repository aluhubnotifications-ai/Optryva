import { createContext, useContext, useState } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

const TabsCtx = createContext<{ value: string; set: (v: string) => void } | null>(null)

export function Tabs({
  defaultValue,
  value,
  onValueChange,
  children,
  className,
}: {
  defaultValue?: string
  value?: string
  onValueChange?: (v: string) => void
  children: React.ReactNode
  className?: string
}) {
  const [internal, setInternal] = useState(defaultValue ?? '')
  const current = value ?? internal
  const set = (v: string) => {
    setInternal(v)
    onValueChange?.(v)
  }
  return (
    <TabsCtx.Provider value={{ value: current, set }}>
      <div className={className}>{children}</div>
    </TabsCtx.Provider>
  )
}

export function TabsList({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-xl border border-border bg-muted/50 p-1',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function TabsTrigger({ value, children }: { value: string; children: React.ReactNode }) {
  const ctx = useContext(TabsCtx)!
  const active = ctx.value === value
  return (
    <button
      onClick={() => ctx.set(value)}
      className={cn(
        'relative rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {active && (
        <motion.span
          layoutId="tab-active"
          className="absolute inset-0 rounded-lg bg-card shadow-soft"
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        />
      )}
      <span className="relative z-10">{children}</span>
    </button>
  )
}

export function TabsContent({
  value,
  children,
  className,
}: {
  value: string
  children: React.ReactNode
  className?: string
}) {
  const ctx = useContext(TabsCtx)!
  if (ctx.value !== value) return null
  return <div className={cn('animate-fade-in', className)}>{children}</div>
}
