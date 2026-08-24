import { useRef, useState } from 'react'
import { FileText, Upload, Pencil, Check, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Label, Textarea } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/toast'
import { cn, fileToDataUrl } from '@/lib/utils'
import { onboardingApi } from '@/lib/api'

type Mode = 'choose' | 'upload' | 'manual'

// Step 2 — add a résumé. Accept PDF/DOCX (first release) or build manually.
// We store the file (data URL) and any text the student pastes so matching has
// something to read. Extraction is AI-assisted and every detail stays editable.
export function StepResume({
  initial,
  onNext,
}: {
  initial: { cv_text?: string; cv_filename?: string; cv_url?: string }
  onNext: () => void
}) {
  const { toast } = useToast()
  const cvRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<Mode>(initial.cv_filename || initial.cv_url ? 'upload' : initial.cv_text ? 'manual' : 'choose')
  const [filename, setFilename] = useState<string | null>(initial.cv_filename ?? null)
  const [cvUrl, setCvUrl] = useState<string | undefined>(initial.cv_url)
  const [cvText, setCvText] = useState(initial.cv_text ?? '')
  const [saving, setSaving] = useState(false)

  const hasResume = !!(cvUrl || cvText.trim())

  async function attachCv(file?: File | null) {
    if (!file) return
    try {
      const url = await fileToDataUrl(file)
      setCvUrl(url)
      setFilename(file.name)
      setCvText('')
      toast({ title: 'Attached', description: file.name, tone: 'success' })
    } catch (e) {
      toast({ title: "Couldn't read that file", description: e instanceof Error ? e.message : undefined, tone: 'error' })
    }
  }

  async function submit() {
    if (!hasResume) return
    setSaving(true)
    try {
      await onboardingApi.saveResume(cvText.trim() || undefined, cvUrl, filename ?? undefined)
      toast({ title: 'Saved', description: 'Your résumé is stored. You can refine it anytime.', tone: 'success' })
      onNext()
    } catch (e) {
      toast({ title: "Couldn't save", description: e instanceof Error ? e.message : 'Is the server running?', tone: 'error' })
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <FileText className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold tracking-tight">Add your résumé</h1>
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        Optryva extracts information for your review. It will not invent experience or add skills without your approval.
      </p>

      {mode === 'choose' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setMode('upload')}
            className="flex flex-col items-start gap-2 rounded-2xl border border-border p-5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Upload className="h-5 w-5" />
            </div>
            <span className="font-semibold">Upload my résumé</span>
            <span className="text-sm text-muted-foreground">PDF or Word document.</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('manual')}
            className="flex flex-col items-start gap-2 rounded-2xl border border-border p-5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Pencil className="h-5 w-5" />
            </div>
            <span className="font-semibold">Build my profile manually</span>
            <span className="text-sm text-muted-foreground">Paste or type your experience.</span>
          </button>
        </div>
      )}

      {mode === 'upload' && (
        <div>
          <input ref={cvRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => attachCv(e.target.files?.[0])} />
          {filename ? (
            <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/5 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-success/15 text-success">
                <Check className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{filename}</p>
                <p className="text-xs text-muted-foreground">Attached — we'll use it to match you.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setFilename(null); setCvUrl(undefined) }}>Remove</Button>
            </div>
          ) : (
            <button
              onClick={() => cvRef.current?.click()}
              className="flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-input p-5 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Upload className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium">Upload your CV</p>
                <p className="text-xs text-muted-foreground">PDF or Word</p>
              </div>
            </button>
          )}

          <p className="mt-3 text-xs text-muted-foreground">
            Prefer to paste the text?{' '}
            <button type="button" className="font-medium text-primary underline" onClick={() => setMode('manual')}>
              Build manually
            </button>
          </p>
        </div>
      )}

      {mode === 'manual' && (
        <div>
          <Label>Review &amp; edit your details</Label>
          <Textarea
            rows={9}
            value={cvText}
            onChange={(e) => setCvText(e.target.value)}
            placeholder="Paste your experience, education, projects, and skills — or just type what you'd put on a résumé. Everything here stays editable."
            className="mt-1.5"
          />
          <p className="mt-3 text-xs text-muted-foreground">
            You can also{' '}
            <button type="button" className="font-medium text-primary underline" onClick={() => setMode('upload')}>
              upload a file
            </button>{' '}
            instead.
          </p>
        </div>
      )}

      <div className="mt-3 flex items-start gap-2 rounded-lg bg-primary/5 p-3 text-xs text-muted-foreground">
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <span>Your résumé stays private and only powers your matches. You can refine or replace it anytime from your profile.</span>
      </div>

      <div className="mt-6 flex justify-end">
        <Button onClick={submit} loading={saving} disabled={!hasResume} className="gap-1.5">
          Continue <Check className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
