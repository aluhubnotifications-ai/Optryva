import { Repeat, ArrowRight } from 'lucide-react'

/**
 * Verification Flywheel (#5 from the Innovation Addendum).
 * Surfaces the two-sided loop: employer verification (reviews + skill
 * assessments) strengthens the next student's matching, which brings stronger
 * candidates back. Uses real contribution counts, not fabricated metrics.
 */
export function VerificationFlywheel({
  reviews,
  assessments,
  shortlists,
}: {
  reviews: number
  assessments: number
  shortlists: number
}) {
  return (
    <div className="rounded-2xl border border-primary/20 bg-primary/[0.04] p-5">
      <div className="flex items-center gap-2">
        <Repeat className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">Verification Flywheel</h3>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Every review and assessment you complete verifies real skills. That verified data improves the next
        student's matching — and better matches bring you stronger candidates.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-md bg-muted px-2 py-1">
          You reviewed <b className="text-foreground">{reviews}</b> applicants
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="rounded-md bg-muted px-2 py-1">
          Verified <b className="text-foreground">{assessments}</b> skill assessments
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="rounded-md bg-muted px-2 py-1">
          Shortlisted <b className="text-foreground">{shortlists}</b>
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Your contributions strengthen matching for every student on Optryva.
      </p>
    </div>
  )
}
