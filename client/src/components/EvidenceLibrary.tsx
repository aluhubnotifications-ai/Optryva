import { useEffect, useState } from 'react'
import { Sparkles, FileText, Link2, CheckCircle2, ExternalLink, Eye, Download } from 'lucide-react'
import { evidenceApi, fetchProtectedDocument } from '@/lib/api'
import type { EvidenceItem, EvidenceStatus } from '@/types'
import { Card, CardBody, Badge } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { EvidenceAddForm } from '@/components/EvidenceAddForm'

const STATUS: Record<EvidenceStatus, { label: string; tone: 'default' | 'accent' | 'success' }> = {
  self_reported: { label: 'Self-reported', tone: 'default' },
  ai_analyzed: { label: 'AI analyzed', tone: 'accent' },
  student_approved: { label: 'Confirmed', tone: 'success' },
}

const isImage = (name: string) => /\.(png|jpe?g|gif|webp|svg)$/i.test(name)

function StatusBadge({ status }: { status: EvidenceStatus }) {
  const s = STATUS[status] ?? { label: status, tone: 'default' as const }
  return <Badge tone={s.tone}>{s.label}</Badge>
}

async function openEvidenceFile(path: string, name: string, asDownload: boolean) {
  const blobUrl = await fetchProtectedDocument(path)
  if (asDownload) {
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = name || 'evidence'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } else {
    window.open(blobUrl, '_blank', 'noopener')
  }
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
}

function FileCard({ file }: { file: { path: string; name: string } }) {
  const { toast } = useToast()
  const [thumb, setThumb] = useState<string | null>(null)

  useEffect(() => {
    if (!isImage(file.name)) return
    let url: string | null = null
    fetchProtectedDocument(file.path)
      .then((u) => { url = u; setThumb(u) })
      .catch(() => { /* thumbnail unavailable */ })
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [file.path])

  function run(asDownload: boolean) {
    openEvidenceFile(file.path, file.name, asDownload).catch(() => toast({ title: 'Could not open file', tone: 'error' }))
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border p-2">
      {thumb ? (
        <button type="button" onClick={() => run(false)} className="block h-24 w-full overflow-hidden rounded" title="View">
          <img src={thumb} alt={file.name} className="h-full w-full object-cover" />
        </button>
      ) : (
        <button type="button" onClick={() => run(false)} className="flex h-24 items-center justify-center rounded bg-muted/50 text-muted-foreground" title="View">
          <FileText className="h-6 w-6" />
        </button>
      )}
      <div className="flex items-center justify-between gap-1">
        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <FileText className="h-3 w-3 shrink-0" />
          <span className="truncate">{file.name}</span>
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" onClick={() => run(false)} title="View" aria-label="View" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <Eye className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => run(true)} title="Download" aria-label="Download" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <Download className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

export function EvidenceLibrary({ studentId, mode }: { studentId: string; mode: 'owner' | 'viewer' }) {
  const { toast } = useToast()
  const [items, setItems] = useState<EvidenceItem[] | null>(null)
  const [draft, setDraft] = useState<Record<string, { extracted: string[]; selected: string[] }>>({})
  const [busy, setBusy] = useState<string | null>(null)

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
  if (items === null) return <p className="text-sm text-muted-foreground">Loading evidence…</p>

  return (
    <div className="space-y-4">
      {mode === 'owner' && <EvidenceAddForm onAdded={load} />}

      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {mode === 'owner'
            ? 'No evidence yet. Add a link or upload a picture/file above — AI can suggest the skills you demonstrated.'
            : 'This candidate has not added evidence yet.'}
        </p>
      )}

      {items.map((ev) => {
        return (
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
                    <FileCard key={i} file={f} />
                  ))}
                </div>
              )}

              {/* Confirmed skills */}
              {ev.confirmed_skills.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {ev.confirmed_skills.map((s) => (
                    <Badge key={s} tone="accent">{s}</Badge>
                  ))}
                </div>
              )}

              {/* Owner: extract + confirm flow */}
              {mode === 'owner' && (
                <div className="pt-1">
                  {!draft[ev.id] ? (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" type="button" onClick={() => doExtract(ev.id)} loading={busy === ev.id + ':extract'}>
                        <Sparkles className="h-4 w-4" /> Extract skills (AI)
                      </Button>
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
            </CardBody>
          </Card>
        )
      })}
    </div>
  )
}
