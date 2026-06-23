import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Modal({
  open,
  onClose,
  children,
  title,
  description,
  className,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  title?: React.ReactNode
  description?: React.ReactNode
  className?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
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

  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
          <motion.div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className={cn(
              'relative z-10 max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-border bg-card shadow-card sm:rounded-2xl',
              widths[size],
              className,
            )}
          >
            <button
              onClick={onClose}
              className="absolute right-4 top-4 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
            {(title || description) && (
              <div className="border-b border-border p-5 pr-12">
                {title && <h2 className="text-lg font-semibold tracking-tight">{title}</h2>}
                {description && (
                  <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                )}
              </div>
            )}
            <div className="p-5">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
