import { useState } from 'react'
import { Compass, ArrowRight } from 'lucide-react'
import { Input, Label } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/toast'
import { onboardingApi } from '@/lib/api'
import { ChipGroup, DIRECTIONS } from './shared'

// Step 1 — career direction. The choice becomes the name of the first résumé
// profile (e.g. "Data Analyst") so matching starts from one clear focus.
export function StepDirection({
  direction,
  setDirection,
  custom,
  setCustom,
  onNext,
}: {
  direction: string
  setDirection: (v: string) => void
  custom: string
  setCustom: (v: string) => void
  onNext: () => void
}) {
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const showCustom = direction === 'Other'
  const chosen = direction === 'Other' ? custom.trim() : direction

  async function submit() {
    if (!chosen) return
    setSaving(true)
    try {
      await onboardingApi.saveCareerDirection(direction === 'Other' ? '' : direction, direction === 'Other' ? custom.trim() : undefined)
      onNext()
    } catch (e) {
      toast({ title: "Couldn't save", description: e instanceof Error ? e.message : 'Is the server running?', tone: 'error' })
      setSaving(false)
    }
  }

  return (
    <>
      <div className="mb-1 flex items-center gap-2">
        <Compass className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold tracking-tight">What kind of opportunity are you looking for first?</h1>
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        Pick one direction to start with. You can add more later — each gets its own résumé and its own matches.
      </p>
      <ChipGroup options={[...DIRECTIONS]} selected={direction && direction !== 'Other' ? [direction] : []} onToggle={(v) => setDirection(direction === v ? '' : v)} />
      <div className="mt-3">
        <ChipGroup
          options={['Other']}
          selected={showCustom ? ['Other'] : []}
          onToggle={() => setDirection(showCustom ? '' : 'Other')}
        />
        {showCustom && (
          <div className="mt-3">
            <Label>Name your direction</Label>
            <Input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="e.g. Data Analyst, Product Intern, Social Impact Research"
            />
          </div>
        )}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        This becomes your first résumé profile name and shapes your first matches.
      </p>

      <div className="mt-6 flex justify-end">
        <Button onClick={submit} loading={saving} disabled={!chosen} className="gap-1.5">
          Continue <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </>
  )
}
