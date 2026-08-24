import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ShieldCheck } from 'lucide-react'
import type { AiMatch } from '@/types'
import { cn } from '@/lib/utils'

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === '') return null
  return (
    <p className="text-muted-foreground">
      <span className="font-medium text-foreground">{label}:</span> {value}
    </p>
  )
}

/**
 * "Show your work" — the explainability certification from the Innovation
 * Addendum (#6). Surfaces the evidence and rules behind any Optryva conclusion
 * so a match or review is never a black box. Works for student matching and for
 * the employer decision view.
 */
export function ShowYourWork({
  match,
  employerScore,
  rationale,
  verdict,
  category,
  assessment,
  decisionNote,
}: {
  match?: AiMatch
  employerScore?: number | null
  rationale?: string | null
  verdict?: string | null
  category?: string | null
  assessment?: string | null
  decisionNote?: string | null
}) {
  const hasStudent = !!match && (match.reasons?.length || match.mismatch_flags?.length || match.tip)
  const hasEmployer =
    employerScore != null || rationale || verdict || category || assessment || decisionNote
  if (!hasStudent && !hasEmployer) return null

  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-lg border border-dashed border-primary/30 bg-primary/[0.03]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
          <ShieldCheck className="h-3.5 w-3.5" /> Show your work — how this conclusion was reached
        </span>
        <span className="text-xs text-muted-foreground">{open ? 'Hide' : 'Show'}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="space-y-2 px-3 pb-3 text-xs">
              {hasStudent && (
                <div className="rounded-md bg-card p-2.5">
                  <p className="mb-1 font-medium text-foreground">Student matching ({match!.score}/99)</p>
                  {match!.reasons?.length > 0 && (
                    <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                      {match!.reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  )}
                  {match!.mismatch_flags?.length > 0 && (
                    <p className="mt-1 text-muted-foreground">
                      <span className="font-medium text-foreground">Gaps:</span> {match!.mismatch_flags.join('; ')}
                    </p>
                  )}
                  {match!.tip && <p className="mt-1 text-muted-foreground">{match!.tip}</p>}
                </div>
              )}
              {hasEmployer && (
                <div className="rounded-md bg-card p-2.5 space-y-0.5">
                  <p className="mb-1 font-medium text-foreground">Employer review</p>
                  <Row label="Match fit (student matching)" value={employerScore ?? undefined} />
                  <Row
                    label="Smart Shortlist verdict"
                    value={verdict ? <span className="capitalize">{verdict}</span> : undefined}
                  />
                  <Row
                    label="Category"
                    value={
                      category === 'not_qualified'
                        ? 'Not qualified'
                        : category === 'insufficient_evidence'
                          ? 'Insufficient evidence'
                          : category === 'potential_fit'
                            ? 'Potential fit'
                            : undefined
                    }
                  />
                  <Row label="Assessment" value={assessment} />
                  <Row label="Why this fit" value={rationale} />
                  <Row label="Decision note" value={decisionNote} />
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                Every Optryva conclusion shows its evidence and rules. AI suggests; a human makes the final call.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
