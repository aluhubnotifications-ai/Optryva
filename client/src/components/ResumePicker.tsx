import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, FileText, Sparkles, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ResumeProfile } from '@/types'
import { resumesApi } from '@/lib/api'
import { useMatchProgress } from '@/lib/matchProgress'
import { Button } from '@/components/ui/Button'

interface ResumePickerProps {
  userId: string
  jobId?: string
  className?: string
}

export function ResumePicker({ userId, jobId, className }: ResumePickerProps) {
  const [resumes, setResumes] = useState<ResumeProfile[]>([])
  const [open, setOpen] = useState(false)
  const selectedResumeId = useMatchProgress((s) => s.selectedResumeId)
  const resumeScores = useMatchProgress((s) => s.resumeScores)

  useEffect(() => {
    let cancelled = false
    resumesApi
      .list()
      .then((rs) => {
        if (!cancelled) setResumes(rs)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [userId])

  const selected = useMemo(
    () => resumes.find((r) => r.id === selectedResumeId) ?? resumes.find((r) => r.active) ?? resumes[0],
    [resumes, selectedResumeId],
  )

  if (!resumes.length) return null

  const score = selectedResumeId && resumeScores[selectedResumeId]
  const label = selected?.name ?? 'Select résumé'
  const isAggregate = !selectedResumeId

  return (
    <div className={cn('relative inline-flex items-center gap-2', className)}>
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
          isAggregate
            ? 'border-primary/30 bg-primary/10 text-primary'
            : 'border-border bg-card text-foreground hover:border-primary/30',
        )}
      >
        <FileText className="h-4 w-4" />
        <span className="max-w-[180px] truncate">{label}</span>
        {score !== undefined && (
          <span className="ml-1 flex items-center gap-1 text-xs">
            <Sparkles className="h-3 w-3 text-primary" />
            <span>{score}/99</span>
          </span>
        )}
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground transition-transform" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0)' }} />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 z-30 mt-2 w-60 overflow-hidden rounded-xl border border-border bg-popover shadow-card"
          >
            <div className="p-1 text-xs font-semibold text-muted-foreground">Switch résumé to update match scores everywhere</div>
            {resumes.map((r) => {
              const s = resumeScores[r.id]
              const isActive = r.active
              const isSelected = selectedResumeId === r.id
              return (
                <motion.button
                  key={r.id}
                  layout
                  onClick={() => {
                    void useMatchProgress.getState().setActiveResume(userId, r.id)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors',
                    isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0" />
                    <span>{r.name}</span>
                    {isActive && <span className="text-xs text-muted-foreground">(active)</span>}
                  </span>
                  {s !== undefined && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Sparkles className="h-3 w-3" /> {s}/99
                    </span>
                  )}
                </motion.button>
              )
            })}
            <motion.button
              layout
              onClick={() => {
                void useMatchProgress.getState().setActiveResume(userId, null)
                setOpen(false)
              }}
              className={cn('flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-xs text-muted-foreground hover:bg-muted')}
            >
              <RefreshCw className="h-3 w-3" /> Show best across all résumés
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
