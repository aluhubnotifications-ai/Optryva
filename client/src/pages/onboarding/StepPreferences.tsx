import { useState } from 'react'
import { Briefcase, ArrowRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Label, Textarea } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { onboardingApi } from '@/lib/api'
import { ChipGroup, SelectedChips, INDUSTRIES, WORK_MODES, OPPORTUNITY_TYPES, LOCATION_SUGGESTIONS } from './shared'
import { CountryMultiSelect } from '@/components/ui/CountryMultiSelect'

function FreeList({
  label,
  hint,
  placeholder,
  items,
  setItems,
  suggestions,
}: {
  label: string
  hint?: string
  placeholder: string
  items: string[]
  setItems: (v: string[]) => void
  suggestions?: readonly string[]
}) {
  const [value, setValue] = useState('')
  function add() {
    const v = value.trim()
    if (v && !items.includes(v)) setItems([...items, v])
    setValue('')
  }
  return (
    <div>
      <Label>{label}</Label>
      {hint && <p className="mb-1.5 text-xs text-muted-foreground">{hint}</p>}
      <SelectedChips items={items} onRemove={(v) => setItems(items.filter((x) => x !== v))} />
      {suggestions && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {suggestions
            .filter((s) => !items.includes(s))
            .map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setItems([...items, s])}
                className="rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
              >
                + {s}
              </button>
            ))}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
        className="mt-2 flex gap-2"
      >
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} className="max-w-sm" />
        <Button type="submit" variant="outline" size="icon" aria-label="Add"><Plus className="h-4 w-4" /></Button>
      </form>
    </div>
  )
}

// Step 4 — résumé-specific preferences. These belong to this résumé direction
// only; every additional résumé can have its own.
export function StepPreferences({
  resumeName,
  onNext,
}: {
  resumeName?: string
  onNext: () => void
}) {
  const { toast } = useToast()
  const [targetRoles, setTargetRoles] = useState<string[]>([])
  const [industries, setIndustries] = useState<string[]>([])
  const [locations, setLocations] = useState<string[]>([])
  const [workModes, setWorkModes] = useState<string[]>([])
  const [opportunityTypes, setOpportunityTypes] = useState<string[]>([])
  const [availabilityStart, setAvailabilityStart] = useState('')
  const [availabilityEnd, setAvailabilityEnd] = useState('')
  const [availabilityHours, setAvailabilityHours] = useState('')
  const [academicScheduleVal, setAcademicScheduleVal] = useState('')
  const [paidOnly, setPaidOnly] = useState(false)
  const [stipendOk, setStipendOk] = useState(false)
  const [unpaidOk, setUnpaidOk] = useState(false)
  const [compMin, setCompMin] = useState('')
  const [workAuth, setWorkAuth] = useState<string[]>([])
  const [excludedRoles, setExcludedRoles] = useState<string[]>([])
  const [excludedCountries, setExcludedCountries] = useState<string[]>([])
  const [excludedIndustries, setExcludedIndustries] = useState<string[]>([])
  const [excludedSchedules, setExcludedSchedules] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const hasPrefs =
    targetRoles.length || industries.length || locations.length || workModes.length || opportunityTypes.length

  async function submit() {
    if (!hasPrefs) return
    setSaving(true)
    try {
      await onboardingApi.savePreferences({
        target_roles: targetRoles,
        industries,
        locations,
        work_modes: workModes,
        opportunity_types: opportunityTypes,
        availability_start: availabilityStart || null,
        availability_end: availabilityEnd || null,
        availability_hours: availabilityHours || null,
        academic_schedule: academicScheduleVal || null,
        compensation_paid_only: paidOnly,
        compensation_stipend_ok: stipendOk,
        compensation_unpaid_ok: unpaidOk,
        compensation_min_amount: compMin ? Number(compMin) : null,
        work_authorization: workAuth,
        excluded_roles: excludedRoles,
        excluded_countries: excludedCountries,
        excluded_industries: excludedIndustries,
        excluded_schedules: excludedSchedules,
      })
      toast({ title: 'Saved', description: 'Preferences set for this résumé.', tone: 'success' })
      onNext()
    } catch (e) {
      toast({ title: "Couldn't save", description: e instanceof Error ? e.message : 'Is the server running?', tone: 'error' })
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <Briefcase className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold tracking-tight">Preferences for your résumé</h1>
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        {resumeName ? (
          <>These preferences apply to <span className="font-medium text-foreground">{resumeName}</span> only. Add another résumé later for different ones.</>
        ) : (
          <>These preferences apply to this résumé direction only.</>
        )}
      </p>

      <FreeList label="Target roles" placeholder="e.g. Data Analyst, Research Assistant" items={targetRoles} setItems={setTargetRoles} />
      <div className="mt-4">
        <Label>Industries</Label>
        <ChipGroup options={[...INDUSTRIES]} selected={industries} onToggle={(v) => setIndustries(industries.includes(v) ? industries.filter((x) => x !== v) : [...industries, v])} />
      </div>
      <div className="mt-4">
        <Label>Locations</Label>
        <p className="mb-1.5 text-xs text-muted-foreground">Where you'd like to work. Pick from the list or type a city/country.</p>
        <CountryMultiSelect value={locations} onChange={setLocations} placeholder="Search countries or type a city…" suggestions={LOCATION_SUGGESTIONS} />
      </div>
      <div className="mt-4">
        <Label>Work mode</Label>
        <ChipGroup options={[...WORK_MODES]} selected={workModes} onToggle={(v) => setWorkModes(workModes.includes(v) ? workModes.filter((x) => x !== v) : [...workModes, v])} />
      </div>
      <div className="mt-4">
        <Label>Opportunity type</Label>
        <ChipGroup options={[...OPPORTUNITY_TYPES]} selected={opportunityTypes} onToggle={(v) => setOpportunityTypes(opportunityTypes.includes(v) ? opportunityTypes.filter((x) => x !== v) : [...opportunityTypes, v])} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Available from</Label>
          <Input type="date" value={availabilityStart} onChange={(e) => setAvailabilityStart(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label>Available until</Label>
          <Input type="date" value={availabilityEnd} onChange={(e) => setAvailabilityEnd(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <Label>Hours per week</Label>
          <Input value={availabilityHours} onChange={(e) => setAvailabilityHours(e.target.value)} placeholder="e.g. 20" className="mt-1.5" />
        </div>
        <div>
          <Label>Academic schedule</Label>
          <Input value={academicScheduleVal} onChange={(e) => setAcademicScheduleVal(e.target.value)} placeholder="e.g. Classes Mon/Wed/Fri" className="mt-1.5" />
        </div>
      </div>

      <div className="mt-4">
        <Label>Compensation</Label>
        <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
          {[
            { label: 'Paid only', v: paidOnly, set: setPaidOnly },
            { label: 'Stipend OK', v: stipendOk, set: setStipendOk },
            { label: 'Unpaid OK', v: unpaidOk, set: setUnpaidOk },
          ].map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => c.set(!c.v)}
              className={cn('rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors', c.v ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}
            >
              {c.label}
            </button>
          ))}
        </div>
        <Input value={compMin} onChange={(e) => setCompMin(e.target.value)} placeholder="Minimum amount (optional)" className="mt-2 max-w-xs" />
      </div>

      <div className="mt-4">
        <FreeList label="Work authorization" hint="Countries or arrangements you can legally work in" placeholder="e.g. Rwanda, EU" items={workAuth} setItems={setWorkAuth} />
      </div>

      <div className="mt-4 rounded-xl border border-border p-3">
        <Label>Exclusions <span className="font-normal text-muted-foreground">— roles, countries, industries, or schedules to avoid</span></Label>
        <div className="mt-2 space-y-3">
          <FreeList label="Roles to avoid" placeholder="e.g. Sales" items={excludedRoles} setItems={setExcludedRoles} />
          <FreeList label="Countries to avoid" placeholder="e.g. Antarctica" items={excludedCountries} setItems={setExcludedCountries} />
          <FreeList label="Industries to avoid" placeholder="e.g. Tobacco" items={excludedIndustries} setItems={setExcludedIndustries} />
          <FreeList label="Schedules to avoid" placeholder="e.g. Weekends" items={excludedSchedules} setItems={setExcludedSchedules} />
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <Button onClick={submit} loading={saving} disabled={!hasPrefs} className="gap-1.5">
          Continue <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
