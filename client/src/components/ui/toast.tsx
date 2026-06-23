import { createContext, useCallback, useContext, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, Info, XCircle, AlertTriangle } from 'lucide-react'
import { uid } from '@/lib/utils'

type ToastTone = 'success' | 'error' | 'info' | 'warning'
interface Toast {
  id: string
  title: string
  description?: string
  tone: ToastTone
}

const ToastCtx = createContext<{
  toast: (t: { title: string; description?: string; tone?: ToastTone }) => void
} | null>(null)

const icons = {
  success: <CheckCircle2 className="h-5 w-5 text-success" />,
  error: <XCircle className="h-5 w-5 text-danger" />,
  info: <Info className="h-5 w-5 text-primary" />,
  warning: <AlertTriangle className="h-5 w-5 text-warning" />,
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback(
    ({ title, description, tone = 'info' }: { title: string; description?: string; tone?: ToastTone }) => {
      const id = uid('toast')
      setToasts((t) => [...t, { id, title, description, tone }])
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
    },
    [],
  )

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2">
          <AnimatePresence>
            {toasts.map((t) => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, x: 40, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40, scale: 0.9 }}
                className="pointer-events-auto flex items-start gap-3 rounded-xl border border-border bg-card p-4 shadow-card"
              >
                {icons[t.tone]}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{t.title}</p>
                  {t.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
