import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, FileText, Sparkles, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ResumeProfile } from '@/types'
import { resumesApi } from '@/lib/api'
import { useMatchProgress } from '@/lib/matchProgress'

interface ResumePickerProps {
  userId: string
  className?: string
  /** Dropdown placement relative to the button. 'right' = grows rightward
   * (for pages where the picker is left-aligned). 'left' = grows leftward
   * (for pages with a right sidebar, e.g. Jobs/Opportunities, so the
   * dropdown doesn't get hidden behind it). */
  placement?: 'left' | 'right'
}

export function ResumePicker({ userId, className, placement = 'right' }: ResumePickerProps) {
  const [resumes, setResumes] = useState<ResumeProfile[]>([])
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
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

  // Close the dropdown when clicking outside.
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

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
        ref={btnRef}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => setOpen(!open)}
        className={cn(
           'flex items-center gap-2 rounded-lg border-2 px-3 py-1.5 text-sm font-medium transition-colors',
           isAggregate
             ? 'border-primary/40 bg-primary/15 text-primary'
             : 'border-border bg-card text-foreground hover:border-primary/40',
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
          {open && btnRef.current && (
           <motion.div
             initial={{ opacity: 0, y: -6, scale: 0.96 }}
             animate={{ opacity: 1, y: 0, scale: 1 }}
             exit={{ opacity: 0, y: -6, scale: 0.96 }}
             transition={{ duration: 0.15 }}
             className="fixed z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border-2 border-primary/30 bg-card shadow-2xl shadow-black/30"
             style={{
               top: btnRef.current.getBoundingClientRect().bottom + window.scrollY + 8,
               ...(placement === 'right'
                 ? {
                     right: window.innerWidth - btnRef.current.getBoundingClientRect().right - window.scrollX,
                     transformOrigin: 'top right',
                   }
                 : {
                     left: btnRef.current.getBoundingClientRect().left + window.scrollX,
                     transformOrigin: 'top left',
                   }),
             }}
>
             <div className="border-b border-border/50 bg-muted/50 px-3 py-2 text-xs font-semibold text-muted-foreground">Switch résumé — scores update everywhere</div>
             {resumes.map((r) => {
               const s = resumeScores[r.id]
               const isActive = r.active
               const isSelected = selectedResumeId === r.id
               const isBest = s !== undefined && s === Math.max(...Object.values(resumeScores).filter((v) => typeof v === 'number'))
               return (
                 <motion.button
                   key={r.id}
                   layout
                   onClick={() => {
                     void useMatchProgress.getState().setActiveResume(userId, r.id)
                     setOpen(false)
                   }}
                   className={cn(
                     'flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-all',
                     isSelected
                       ? 'bg-primary/15 text-primary ring-2 ring-primary/30'
                       : 'hover:bg-muted',
                   )}
                 >
                   <span className="flex items-center gap-2">
                     <FileText className={cn('h-4 w-4 shrink-0', isSelected ? 'text-primary' : 'text-muted-foreground')} />
                     <span>{r.name}</span>
                     {isActive && <span className="text-xs text-muted-foreground">(active)</span>}
                     {isBest && <Sparkles className="h-3 w-3 text-primary" />}
                   </span>
                   {s !== undefined && (
                     <span className={cn('flex items-center gap-1 text-xs font-semibold', isSelected ? 'text-primary' : 'text-muted-foreground')}>
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
               className={cn('flex w-full items-center justify-center gap-2 border-t border-border/30 px-3 py-2.5 text-center text-sm text-muted-foreground hover:bg-muted')}
             >
               <RefreshCw className="h-3 w-3" /> Show best across all résumés
             </motion.button>
           </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
