import { useState } from 'react'
import { Sparkles, Plus, Link2, Check, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Label, Textarea } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { evidenceApi, onboardingApi } from '@/lib/api'
import { EVIDENCE_SOURCES } from './shared'

interface AddedEvidence {
  id: string
  title: string
  source: string
}

// Step 3 — add evidence (optional). The student can add anything that shows
// their abilities. We create lightweight evidence items now; AI analysis and
// confirmation happen later from the profile so onboarding never blocks.
export function StepEvidence({
  initialIds,
  onNext,
  onSkip,
}: {
  initialIds?: string[]
  onNext: () => void
  onSkip: () => void
}) {
  const { toast } = useToast()
  const [source, setSource] = useState<string>(EVIDENCE_SOURCES[0])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [link, setLink] = useState('')
  const [added, setAdded] = useState<AddedEvidence[]>([])
  const [saving, setSaving] = useState(false)

  const canAdd = title.trim().length > 1

  async function addEvidence() {
    if (!canAdd) return
    try {
      const item = await evidenceApi.create({
        title: title.trim(),
        description: `Source: ${source}${description.trim() ? `\n\n${description.trim()}` : ''}`,
        links: link.trim() ? [link.trim()] : [],
      })
      setAdded((a) => [...a, { id: item.id, title: item.title, source }])
      setTitle('')
      setDescription('')
      setLink('')
      toast({ title: 'Added', description: 'Evidence saved. You can analyze it later.', tone: 'success' })
    } catch (e) {
      toast({ title: "Couldn't add evidence", description: e instanceof Error ? e.message : undefined, tone: 'error' })
    }
  }

  async function submit() {
    setSaving(true)
    try {
      await onboardingApi.saveEvidence(added.map((a) => a.id))
      onNext()
    } catch (e) {
      toast({ title: "Couldn't save", description: e instanceof Error ? e.message : 'Is the server running?', tone: 'error' })
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold tracking-tight">What have you done that shows your abilities?</h1>
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        Add anything that proves your skills — a portfolio, project, research, certificate, leadership role, volunteer work, or a GitHub repo. This step is optional; you can add more later.
      </p>

      <Label>Type of evidence</Label>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {EVIDENCE_SOURCES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSource(s)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm transition-colors',
              source === s ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label>Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Climate data dashboard, Debate society presidency" className="mt-1.5" />
        </div>
        <div className="sm:col-span-2">
          <Label>What did you do? <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One or two sentences about your contribution." className="mt-1.5" />
        </div>
        <div className="sm:col-span-2">
          <Label>Link <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <div className="relative mt-1.5">
            <Link2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" className="pl-9" />
          </div>
        </div>
      </div>

      <Button type="button" variant="outline" className="mt-3 gap-1.5" onClick={addEvidence} disabled={!canAdd}>
        <Plus className="h-4 w-4" /> Add evidence
      </Button>

      {added.length > 0 && (
        <ul className="mt-4 space-y-2">
          {added.map((a) => (
            <li key={a.id} className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success/15 text-success">
                <Check className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{a.title}</p>
                <p className="text-xs text-muted-foreground">{a.source}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex items-center justify-between">
        <Button variant="ghost" onClick={onSkip} className="text-muted-foreground">
          Skip for now
        </Button>
        <Button onClick={submit} loading={saving} className="gap-1.5">
          {added.length ? 'Continue' : 'Skip for now'} <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
