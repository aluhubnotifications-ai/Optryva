import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Drawer({
  open,
  onClose,
  children,
  title,
  description,
  width = 'md',
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  title?: React.ReactNode
  description?: React.ReactNode
  width?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (open) {
      document.addEventListener('keydown', onKey)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  const widths = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-xl', xl: 'max-w-2xl' }

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            className={cn(
              'absolute right-0 top-0 flex h-[100dvh] w-full flex-col border-l border-border bg-card shadow-card',
              widths[width],
            )}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border p-5">
              <div className="min-w-0">
                {title && <h2 className="text-lg font-semibold tracking-tight">{title}</h2>}
                {description && (
                  <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
                )}
              </div>
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">{children}</div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
