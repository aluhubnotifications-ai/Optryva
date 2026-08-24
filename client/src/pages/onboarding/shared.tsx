import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Spec-aligned option lists for the onboarding steps.
// ---------------------------------------------------------------------------

export const DIRECTIONS = [
  'Data and Analytics',
  'Software and Technology',
  'Product',
  'Business and Finance',
  'Marketing and Communications',
  'Operations and Project Management',
  'Design and Creative Work',
  'Research and Policy',
  'Social Impact and Development',
  'Entrepreneurship',
] as const

export const INDUSTRIES = [
  'Technology',
  'Finance',
  'Development',
  'Health',
  'Education',
  'Agriculture',
  'Energy',
  'Manufacturing',
  'Media and Entertainment',
  'Nonprofit and NGO',
  'Public Sector',
  'Retail and E-commerce',
] as const

export const WORK_MODES = ['Remote', 'Hybrid', 'On-site'] as const

export const OPPORTUNITY_TYPES = ['Internship', 'Fellowship', 'Graduate role', 'Part-time', 'Project', 'Full-time'] as const

// Suggested locations — free-text is always allowed on top of these.
export const LOCATION_SUGGESTIONS = [
  'Kigali, Rwanda',
  'Rwanda',
  'Nairobi, Kenya',
  'Kenya',
  'Accra, Ghana',
  'Lagos, Nigeria',
  'South Africa',
  'Africa',
  'Worldwide',
  'Europe',
  'United States',
  'United Kingdom',
  'Singapore',
  'United Arab Emirates',
] as const

export const EVIDENCE_SOURCES = [
  'Portfolio or personal website',
  'Project document',
  'Research paper or policy brief',
  'Presentation or pitch deck',
  'Certificate or course project',
  'Leadership or community initiative',
  'Volunteer work',
  'Internship or employment work sample',
  'Creative work (video, audio, design, photography)',
  'Business or entrepreneurship project',
  'External professional profile',
  'GitHub or technical repository',
] as const

// Small shared building blocks for the onboarding steps.

export function ChipGroup({ options, selected, onToggle }: { options: string[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o)
        return (
          <button
            key={o}
            type="button"
            onClick={() => onToggle(o)}
            aria-pressed={on}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm transition-colors',
              on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {o}
          </button>
        )
      })}
    </div>
  )
}

export function Toggle({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-xl border border-border p-3.5 text-left transition-colors hover:bg-muted/40"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>}
      </span>
      <span
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors',
          checked ? 'bg-primary' : 'bg-muted-foreground/30',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  )
}

export function StepDot({ n, active, done, label }: { n: number; active: boolean; done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold',
          done ? 'bg-success text-white' : active ? 'bg-primary text-white' : 'bg-muted text-muted-foreground',
        )}
      >
        {done ? <Check className="h-4 w-4" /> : n}
      </div>
      <span className={cn('hidden text-sm font-medium sm:inline', active || done ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
    </div>
  )
}

/** Horizontal stepper with a progress bar: "Step 2 of 5". */
export function Stepper({
  steps,
  current,
}: {
  steps: string[]
  current: number
}) {
  const pct = Math.round(((current - 1) / (steps.length - 1)) * 100)
  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Step {current} of {steps.length}
        </span>
        <span className="truncate text-xs font-medium text-primary">{steps[current - 1]}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {steps.map((_, i) => (
          <div
            key={i}
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors',
              i < current ? 'bg-primary' : i === current - 1 ? 'bg-primary/40' : 'bg-muted',
            )}
          />
        ))}
      </div>
    </div>
  )
}

export function SelectedChips({ items, onRemove }: { items: string[]; onRemove: (v: string) => void }) {
  if (!items.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((s) => (
        <span key={s} className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2.5 py-1 text-xs font-medium text-primary">
          {s}
          <button type="button" aria-label={`Remove ${s}`} onClick={() => onRemove(s)}>
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  )
}
