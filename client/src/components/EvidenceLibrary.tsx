import { useEffect, useRef, useState } from 'react'
import { Upload, Sparkles, ShieldCheck, FileText, Link2, BadgeCheck, RefreshCw, CheckCircle2 } from 'lucide-react'
import { evidenceApi } from '@/lib/api'
import type { EvidenceItem, EvidenceStatus } from '@/types'
import { Card, CardBody, Badge, Input, Textarea, Label } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/toast'
import { cn, fileToDataUrl } from '@/lib/utils'

const STATUS: Record<EvidenceStatus, { label: string; tone: 'default' | 'accent' | 'success' }> = {
  self_reported: { label: 'Self-reported', tone: 'default' },
  student_approved: { label: 'Student-approved', tone: 'accent' },
  verified: { label: 'Verified', tone: 'success' },
}

function StatusBadge({ status }: { status: EvidenceStatus }) {
  const s = STATUS[status]
  return <Badge tone={s.tone}>{s.label}</Badge>
}

export function EvidenceLibrary({ studentId, mode }: { studentId: string; mode: 'owner' | 'viewer' }) {
  const { toast } = useToast()
  const [items, setItems] = useState<EvidenceItem[] | null>(null)
  const [draft, setDraft] = useState<Record<string, { extracted: string[]; selected: string[] }>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<{ data: string; name: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    try {
      const list = mode === 'owner' ? await evidenceApi.list() : await evidenceApi.listForStudent(studentId)
      setItems(list)
    } catch (e) {
      setItems([])
    }
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, mode])

  async function addEvidence() {
    if (!title.trim()) return toast({ title: 'Add a title', tone: 'error' })
    setBusy('add')
    try {
      await evidenceApi.create({
        title: title.trim(),
        description,
        url: url.trim() || undefined,
        file: file?.data,
        fileName: file?.name,
      })
      setTitle(''); setDescription(''); setUrl(''); setFile(null); if (fileRef.current) fileRef.current.value = ''
      toast({ title: 'Evidence added', tone: 'success' })
      await load()
    } catch {
      toast({ title: 'Could not add evidence', tone: 'error' })
    } finally {
      setBusy(null)
    }
  }

  async function doExtract(id: string) {
    setBusy(id + ':extract')
    try {
      const updated = await evidenceApi.extract(id)
      setDraft((d) => ({ ...d, [id]: { extracted: updated.extracted_skills, selected: [...updated.extracted_skills] } }))
    } catch {
      toast({ title: 'AI extraction failed', tone: 'error' })
    } finally {
      setBusy(null)
    }
  }

  function toggleSkill(id: string, skill: string) {
    setDraft((d) => {
      const cur = d[id]?.selected ?? []
      const next = cur.includes(skill) ? cur.filter((s) => s !== skill) : [...cur, skill]
      return { ...d, [id]: { extracted: d[id].extracted, selected: next } }
    })
  }

  async function confirmContribution(id: string) {
    const sel = draft[id]?.selected ?? []
    setBusy(id + ':confirm')
    try {
      await evidenceApi.confirm(id, sel)
      setDraft((d) => { const n = { ...d }; delete n[id]; return n })
      toast({ title: 'Contribution confirmed', tone: 'success' })
      await load()
    } catch {
      toast({ title: 'Could not confirm', tone: 'error' })
    } finally {
      setBusy(null)
    }
  }

  async function requestVerification(id: string) {
    setBusy(id + ':req')
    try {
      await evidenceApi.requestVerification(id)
      toast({ title: 'Verification requested', tone: 'success' })
      await load()
    } finally {
      setBusy(null)
    }
  }

  async function verify(id: string, v: boolean) {
    setBusy(id + ':verify')
    try {
      await evidenceApi.verify(id, v)
      toast({ title: v ? 'Evidence verified' : 'Verification removed', tone: 'success' })
      await load()
    } finally {
      setBusy(null)
    }
  }

  if (items === null) return <p className="text-sm text-muted-foreground">Loading evidence…</p>

  return (
    <div className="space-y-4">
      {mode === 'owner' && (
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold">Add evidence of your work</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label>Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. ALU Data Fellowship project" />
              </div>
              <div>
                <Label>Project / GitHub URL</Label>
                <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/…" />
              </div>
            </div>
            <div>
              <Label>What did you do?</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe your contribution…" />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (f) setFile({ data: await fileToDataUrl(f), name: f.name })
                }}
              />
              <Button variant="outline" size="sm" type="button" onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4" /> {file ? file.name : 'Attach file'}
              </Button>
              <Button size="sm" type="button" onClick={addEvidence} loading={busy === 'add'}>
                Add evidence
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {mode === 'owner' ? 'No evidence yet. Add work above — AI can suggest the skills you demonstrated.' : 'This candidate has not added evidence yet.'}
        </p>
      )}

      {items.map((ev) => (
        <Card key={ev.id}>
          <CardBody className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{ev.title}</p>
              <StatusBadge status={ev.status} />
            </div>
            {ev.description && <p className="text-sm text-muted-foreground">{ev.description}</p>}
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              {ev.url && (
                <a href={ev.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
                  <Link2 className="h-3.5 w-3.5" /> Project link
                </a>
              )}
              {ev.file_path && (
                <a href={`${(import.meta as any).env?.VITE_API_URL ?? 'http://localhost:4000/api'}${ev.file_path}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
                  <FileText className="h-3.5 w-3.5" /> {ev.file_name ?? 'File'}
                </a>
              )}
            </div>

            {/* Confirmed / verified skills */}
            {ev.confirmed_skills.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {ev.confirmed_skills.map((s) => (
                  <Badge key={s} tone={ev.status === 'verified' ? 'success' : 'accent'}>{s}</Badge>
                ))}
              </div>
            )}

            {ev.status === 'verified' && ev.verified_at && (
              <p className="flex items-center gap-1 text-xs text-success">
                <BadgeCheck className="h-3.5 w-3.5" /> Verified
              </p>
            )}

            {/* Owner: extract + confirm flow */}
            {mode === 'owner' && (
              <div className="pt-1">
                {!draft[ev.id] ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" type="button" onClick={() => doExtract(ev.id)} loading={busy === ev.id + ':extract'}>
                      <Sparkles className="h-4 w-4" /> Extract skills (AI)
                    </Button>
                    {ev.status !== 'verified' && (
                      <Button size="sm" variant="ghost" type="button" onClick={() => requestVerification(ev.id)} loading={busy === ev.id + ':req'}>
                        <RefreshCw className="h-4 w-4" /> Request verification
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2 rounded-lg border border-border p-3">
                    <p className="text-xs font-medium text-foreground">AI suggested skills — confirm what you actually did:</p>
                    <div className="flex flex-wrap gap-2">
                      {draft[ev.id].extracted.map((s) => {
                        const on = draft[ev.id].selected.includes(s)
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => toggleSkill(ev.id, s)}
                            className={cn(
                              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                              on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground',
                            )}
                          >
                            {s}
                          </button>
                        )
                      })}
                    </div>
                    <Button size="sm" type="button" onClick={() => confirmContribution(ev.id)} loading={busy === ev.id + ':confirm'}>
                      <CheckCircle2 className="h-4 w-4" /> Confirm contribution
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Viewer (employer/supervisor): verify */}
            {mode === 'viewer' && (
              <div className="pt-1">
                <Button
                  size="sm"
                  variant={ev.status === 'verified' ? 'outline' : 'default'}
                  type="button"
                  onClick={() => verify(ev.id, ev.status !== 'verified')}
                  loading={busy === ev.id + ':verify'}
                >
                  <ShieldCheck className="h-4 w-4" /> {ev.status === 'verified' ? 'Remove verification' : 'Verify as reviewer'}
                </Button>
              </div>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  )
}
