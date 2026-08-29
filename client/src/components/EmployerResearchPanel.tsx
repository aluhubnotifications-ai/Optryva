import { useState } from 'react'
import { Sparkles, Send } from 'lucide-react'
import { DancingMascot } from '@/components/DancingMascot'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/primitives'
import { Markdown } from '@/components/Markdown'
import { jobsApi } from '@/lib/api'

type QA = { role: 'user' | 'ai'; text: string }

const CANDIDATE_SUGGESTED = [
  'Summarize this candidate’s strengths for the role',
  'What are the biggest gaps versus the job requirements?',
  'Is this candidate worth an interview? What should I probe?',
]
const PIPELINE_SUGGESTED = [
  'Who are my strongest candidates right now?',
  'Where are the biggest gaps across this pipeline?',
  'Which candidates should I prioritize for interviews?',
]

/**
 * Employer-facing AI research. Ask a free-form question about ONE candidate
 * (pass `candidateId`) or the whole applicant PIPELINE for a job. Grounded only
 * in stored candidate data — it never invents people.
 */
export function EmployerResearchPanel({
  jobId,
  candidateId,
  candidateName,
  title,
}: {
  jobId: string
  candidateId?: string
  candidateName?: string
  title?: string
}) {
  const [turns, setTurns] = useState<QA[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)

  const suggested = candidateId ? CANDIDATE_SUGGESTED : PIPELINE_SUGGESTED
  const heading = title ?? (candidateId ? `Ask AI about ${candidateName ?? 'this candidate'}` : 'Ask AI about this pipeline')

  async function ask(q: string) {
    const question = q.trim()
    if (!question || busy) return
    setBusy(true)
    setTurns((t) => [...t, { role: 'user', text: question }])
    setInput('')
    try {
      const { answer } = await jobsApi.research(jobId, question, candidateId)
      setTurns((t) => [...t, { role: 'ai', text: answer }])
    } catch (e) {
      setTurns((t) => [...t, { role: 'ai', text: `Couldn’t reach the research AI${e instanceof Error ? `: ${e.message}` : ''}.` }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent" />
        <p className="text-sm font-semibold text-foreground">{heading}</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Grounded in each candidate’s profile, match, assessment, and Smart Shortlist read. It won’t invent people.
      </p>

      <div className="mt-3 space-y-3">
        {turns.map((t, i) => (
          <div key={i} className={t.role === 'user' ? 'text-right' : 'text-left'}>
            <div
              className={
                t.role === 'user'
                  ? 'inline-block max-w-[90%] rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground'
                  : 'inline-block max-w-[95%] rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm'
              }
            >
              {t.role === 'ai' ? <Markdown content={t.text} /> : t.text}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <DancingMascot size={14} /> Thinking…
          </div>
        )}
      </div>

      {turns.length === 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {suggested.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => ask(s)}
              className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground transition hover:border-accent hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-end gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              ask(input)
            }
          }}
          placeholder={candidateId ? 'Ask about this candidate…' : 'Ask about your applicant pipeline…'}
          className="min-h-[44px] flex-1"
        />
        <Button size="sm" onClick={() => ask(input)} disabled={busy || !input.trim()} className="gap-1.5">
          <Send className="h-4 w-4" /> Ask
        </Button>
      </div>
    </div>
  )
}
