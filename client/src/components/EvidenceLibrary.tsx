import { useEffect, useRef, useState } from 'react'
import { Upload, Sparkles, ShieldCheck, FileText, Link2, BadgeCheck, RefreshCw, CheckCircle2, X, Image as ImageIcon, Plus, ExternalLink } from 'lucide-react'
import { evidenceApi } from '@/lib/api'
import type { EvidenceItem, EvidenceStatus } from '@/types'
import { Card, CardBody, Badge, Input, Textarea, Label } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/toast'
import { cn, fileToDataUrl } from '@/lib/utils'

const API = ((import.meta as any).env?.VITE_API_URL as string | undefined) ?? 'http://localhost:4000/api'

const STATUS: Record<EvidenceStatus, { label: string; tone: 'default' | 'accent' | 'success' }> = {
  self_reported: { label: 'Self-reported', tone: 'default' },
  student_approved: { label: 'Student-approved', tone: 'accent' },
  verified: { label: 'Verified', tone: 'success' },
}

const isImage = (name: string) => /\.(png|jpe?g|gif|webp|svg)$/i.test(name)

function StatusBadge({ status }: { status: EvidenceStatus }) {
  const s = STATUS[status]
  return <Badge tone={s.tone}>{s.label}</Badge>
}

export function EvidenceLibrary({ studentId, mode }: { studentId: string; mode: 'owner' | 'viewer' }) {
  const { toast } = useToast()
  const [items, setItems] = useState<EvidenceItem[] | null>(null)
  const [draft, setDraft] = useState<Record<string, { extracted: string[]; selected: string[] }>>({})
  const [busy, setBusy] = useState<string | null>(null)

  // Add-evidence form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [linkInput, setLinkInput] = useState('')
  const [links, setLinks] = useState<string[]>([])
  const [pendingFiles, setPendingFiles] = useState<{ data: string; name: string }[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    try {
      const list = mode === 'owner' ? await evidenceApi.list() : await evidenceApi.listForStudent(studentId)
      setItems(list)
    } catch {
      setItems([])
    }
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, mode])

  function addLink() {
    const v = linkInput.trim()
    if (v && !links.includes(v)) setLinks([...links, v])
    setLinkInput('')
  }
  function removeLink(l: string) {
    setLinks(links.filter((x) => x !== l))
  }
  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    const converted = await Promise.all(picked.map(async (f) => ({ data: await fileToDataUrl(f), name: f.name })))
    setPendingFiles((p) => [...p, ...converted])
    if (fileRef.current) fileRef.current.value = ''
  }
  function removeFile(i: number) {
    setPendingFiles(pendingFiles.filter((_, idx) => idx !== i))
  }

  async function addEvidence() {
    if (!title.trim()) return toast({ title: 'Add a title', tone: 'error' })
    setBusy('add')
    try {
      await evidenceApi.create({ title: title.trim(), description, links, files: pendingFiles })
      setTitle(''); setDescription(''); setLinks([]); setPendingFiles([]); setLinkInput('')
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
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
              <div>
                <p className="text-sm font-semibold">Add proof of your work</p>
                <p className="text-xs text-muted-foreground">
                  Paste any link — website, GitHub, Instagram, YouTube, an article — or upload a picture/file. Optryva's AI can suggest the skills you demonstrated.
                </p>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label>Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. ALU Data Fellowship project" />
              </div>
              <div>
                <Label>Links</Label>
                <div className="flex gap-1.5">
                  <Input
                    value={linkInput}
                    onChange={(e) => setLinkInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink() } }}
                    placeholder="https://…"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={addLink} aria-label="Add link">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            {links.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {links.map((l) => (
                  <span key={l} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs">
                    <Link2 className="h-3 w-3 text-muted-foreground" />
                    <span className="max-w-[14rem] truncate">{l}</span>
                    <button type="button" onClick={() => removeLink(l)} className="text-muted-foreground hover:text-danger">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div>
              <Label>What did you do?</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe your contribution…" />
            </div>

            <input ref={fileRef} type="file" multiple className="hidden" onChange={onPickFiles} />
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" type="button" onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4" /> {pendingFiles.length ? `${pendingFiles.length} file(s) ready` : 'Attach pictures / files'}
              </Button>
              <Button size="sm" type="button" onClick={addEvidence} loading={busy === 'add'}>
                Add evidence
              </Button>
            </div>

            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {pendingFiles.map((f, i) => (
                  <div key={i} className="relative flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs">
                    {isImage(f.name) ? <ImageIcon className="h-3.5 w-3.5 text-primary" /> : <FileText className="h-3.5 w-3.5 text-muted-foreground" />}
                    <span className="max-w-[10rem] truncate">{f.name}</span>
                    <button type="button" onClick={() => removeFile(i)} className="text-muted-foreground hover:text-danger">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {mode === 'owner'
            ? 'No evidence yet. Add a link or upload a picture/file above — AI can suggest the skills you demonstrated.'
            : 'This candidate has not added evidence yet.'}
        </p>
      )}

      {items.map((ev) => (
        <Card key={ev.id}>
          <CardBody className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{ev.title}</p>
              <StatusBadge status={ev.status} />
            </div>
            {ev.description && <p className="text-sm text-muted-foreground">{ev.description}</p>}

            {/* Links */}
            {(ev.links?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {ev.links!.map((l) => (
                  <a
                    key={l}
                    href={l}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs text-primary hover:bg-primary/10"
                  >
                    <ExternalLink className="h-3 w-3" /> <span className="max-w-[16rem] truncate">{l}</span>
                  </a>
                ))}
              </div>
            )}

            {/* Files / pictures */}
            {(ev.files?.length ?? 0) > 0 && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {ev.files!.map((f, i) => (
                  <a
                    key={i}
                    href={`${API}${f.path}`}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex flex-col gap-1 rounded-lg border border-border p-2 hover:border-primary/40"
                  >
                    {isImage(f.name) ? (
                      <img src={`${API}${f.path}`} alt={f.name} className="h-24 w-full rounded object-cover" />
                    ) : (
                      <span className="flex h-24 items-center justify-center rounded bg-muted/50 text-muted-foreground">
                        <FileText className="h-6 w-6" />
                      </span>
                    )}
                    <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                      <FileText className="h-3 w-3 shrink-0" /> <span className="truncate">{f.name}</span>
                    </span>
                  </a>
                ))}
              </div>
            )}

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
