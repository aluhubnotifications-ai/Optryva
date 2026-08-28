import { useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Sparkles } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { AssistantChat, type ChatMessage } from '@/components/AssistantChat'
import type { AssistantAction, SmartShortlistResponse, SmartShortlistCandidate } from '@/lib/api'
import type { EvidenceItem, JobListing, Profile } from '@/types'

interface ShortlistAssistantSidebarProps {
  open: boolean
  onClose: () => void
  onOpen?: () => void
  mode?: 'student' | 'employer' | 'university'
  candidate_id?: string
  candidateName?: string
  candidateMeta?: string
  evidenceItems?: EvidenceItem[]
  job?: JobListing | SmartShortlistResponse['job'] | null
  jobId?: string
  summary?: string | null
  candidates?: SmartShortlistCandidate[]
  initialMessage?: string
}

export function ShortlistAssistantSidebar({
  open,
  onClose,
  onOpen,
  mode = 'employer',
  candidate_id,
  candidateName,
  candidateMeta,
  evidenceItems,
  job,
  jobId,
  summary,
  candidates,
  initialMessage,
}: ShortlistAssistantSidebarProps) {
  const { toast } = useToast()
  const [sidebarKey, setSidebarKey] = useState<string>('new')

  // Build rich context for the AI — this becomes hidden system context
  const pageContext = useMemo(() => {
    const parts: string[] = []

    if (candidates && candidates.length > 0) {
      // Shortlist context
      parts.push(`Smart Shortlist for "${job?.title ?? 'this role'}" at ${job?.company_name ?? 'your company'}`)
      parts.push(`Job ID: ${jobId ?? 'unknown'} | Location: ${job?.location ?? 'Remote'} | Tags: ${(job?.tags ?? []).join(', ') || 'none'}`)

      if (summary) parts.push(`AI summary: ${summary}`)

      parts.push('')
      parts.push('Top candidates in the shortlist:')
      const topCands = candidates.slice(0, 10).map((c) =>
        `- ${c.name} (${c.major ?? 'no major'}) — fit score ${Math.round(c.fit_score ?? c.score * 100)}, ${c.category ?? 'uncategorized'}\n  Matched skills: ${(c.matched_skills ?? []).join(', ') || 'none'}\n  Gaps: ${(c.mismatch_flags ?? []).join(', ') || 'none'}`
      ).join('\n')
      parts.push(topCands)
      parts.push('')
      parts.push('The employer is viewing this shortlist. They may ask who to advance, what risks to watch, or for evidence-based recommendations.')
    }

    if (candidate_id || candidateName) {
      // Evidence context
      const meta = [candidateMeta].filter(Boolean).join(', ')
      parts.push(`${candidateName ?? 'This candidate'}${meta ? ` (${meta})` : ''} is being reviewed for "${job?.title ?? 'this role'}" at ${job?.company_name ?? 'your company'}.`)

      if (evidenceItems && evidenceItems.length > 0) {
        parts.push('')
        parts.push('Evidence items:')
        const evidenceLines = evidenceItems.map((i) => {
          const ep: string[] = [`**${i.title}**`]
          if (i.ai_summary) ep.push(i.ai_summary)
          else if (i.description) ep.push(i.description)
          if (i.links?.length) ep.push('Links: ' + i.links.join(', '))
          if (i.files?.length) ep.push('Files: ' + i.files.map((f) => f.name).join(', '))
          return ep.join('\n')
        }).join('\n\n')
        parts.push(evidenceLines)
      }
      parts.push('')
      parts.push('The employer is reviewing this candidate. They may ask for a critique, evidence verification, or gap analysis.')
    }

    return parts.join('\n')
  }, [candidates, job, jobId, summary, candidate_id, candidateName, candidateMeta, evidenceItems])

  // Handle actions from the AI — always stay in context, never navigate away
  const handleAction = useCallback(
    async (action: AssistantAction) => {
      switch (action.type) {
        case 'navigate':
          // Never navigate away — stay on the current page
          break
        case 'start_shortlist':
          toast({
            title: 'Shortlist analysis started',
            description: `Analyzing candidates for ${job?.title ?? 'this role'}…`,
            tone: 'info',
          })
          break
        case 'inject_data':
          if (action.target === 'job_editor') {
            window.dispatchEvent(new CustomEvent('optryva:inject_job', { detail: action.data }))
            toast({ title: 'Job data injected', description: 'Job Editor auto-filled.', tone: 'success' })
          }
          break
        default:
          break
      }
    },
    [job, toast],
  )

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="shortlist-sidebar"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'tween', duration: 0.2 }}
          className="fixed inset-y-0 right-0 z-50 flex w-[420px] flex-shrink-0 flex-col border-l border-border bg-card/95 shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border bg-gradient-to-r from-primary/10 via-accent/5 to-primary/10 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent">
                <Sparkles className="h-3 w-3 text-white" />
              </div>
              <span className="font-semibold text-sm">
                AI Assistant
              </span>
            </div>
            <button
              onClick={onClose}
              className="rounded-full p-1 text-muted-foreground hover:bg-muted"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* AI Chat */}
          <div className="flex-1 overflow-hidden">
            <AssistantChat
              key={`shortlist-chat-${sidebarKey}`}
              mode={mode}
              pageContext={pageContext}
              onAction={handleAction}
              onPendingConsumed={() => {}}
              initialMessages={[]}
              pendingMessage={initialMessage ?? ''}
              pendingContext={{ job_id: jobId, pageContext }}
            />
          </div>
        </motion.div>
      )}
      {!open && (
        <motion.button
          key="expand-btn"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'tween', duration: 0.2 }}
          onClick={onOpen || (() => {})}
          className="fixed inset-y-0 right-0 z-40 flex w-8 items-center justify-center border-l border-border bg-card/80 hover:bg-muted"
          aria-label="Open AI assistant"
        >
          <Sparkles className="h-4 w-4 text-muted-foreground" />
        </motion.button>
      )}
    </AnimatePresence>
  )
}
