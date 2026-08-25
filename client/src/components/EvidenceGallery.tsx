import { useEffect, useMemo, useState } from 'react'
import {
  Plus, Eye, ArrowRight, Sparkles, Brain, User, CheckCircle2, Circle,
  FileText, ExternalLink, BarChart3, Users, Rocket, Palette, Search, FolderOpen, Presentation,
} from 'lucide-react'
import { evidenceApi, fetchProtectedDocument } from '@/lib/api'
import type { EvidenceItem, EvidenceStatus } from '@/types'
import { Card, CardBody, Badge } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/toast'
import { EvidenceAddForm } from '@/components/EvidenceAddForm'

const isImage = (name: string) => /\.(png|jpe?g|gif|webp|svg)$/i.test(name)

type StatusMeta = { label: string; tone: 'default' | 'accent' | 'success'; Icon: typeof Circle }
const STATUS_META: Record<EvidenceStatus, StatusMeta> = {
  self_reported: { label: 'Self-reported', tone: 'default', Icon: Circle },
  ai_analyzed: { label: 'AI analyzed', tone: 'accent', Icon: Sparkles },
  student_approved: { label: 'Confirmed', tone: 'success', Icon: CheckCircle2 },
}

const GRADIENTS = [
  'linear-gradient(135deg,#6366f1,#8b5cf6)',
  'linear-gradient(135deg,#0ea5e9,#22d3ee)',
  'linear-gradient(135deg,#f59e0b,#ef4444)',
  'linear-gradient(135deg,#10b981,#34d399)',
  'linear-gradient(135deg,#ec4899,#f43f5e)',
  'linear-gradient(135deg,#8b5cf6,#6366f1)',
]
function gradientFor(id: string) {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return GRADIENTS[h % GRADIENTS.length]
}
function iconForTags(tags: string[]) {
  const t = (tags.join(' ') + '').toLowerCase()
  if (/research|writing|analy|report|brief|paper/.test(t)) return Search
  if (/data|python|stat|sql|dashboard/.test(t)) return BarChart3
  if (/market|creativ|brand|design/.test(t)) return Palette
  if (/leader|stakeholder|manage|communic/.test(t)) return Users
  if (/entrepreneur|pitch|product|business|startup/.test(t)) return Rocket
  if (/present|speaker|talk/.test(t)) return Presentation
  return FolderOpen
}

function StatusPill({ status }: { status: EvidenceStatus }) {
  const m = STATUS_META[status]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
      m.tone === 'success' ? 'bg-success/12 text-success' : m.tone === 'accent' ? 'bg-accent/12 text-accent' : 'bg-muted text-muted-foreground'
    }`}>
      <m.Icon className="h-3 w-3" /> {m.label}
    </span>
  )
}

function PreviewThumb({ item }: { item: EvidenceItem }) {
  const img = item.files?.find((f) => isImage(f.name))
  const [thumb, setThumb] = useState<string | null>(null)
  useEffect(() => {
    if (!img) return
    let u: string | null = null
    fetchProtectedDocument(img.path).then((x) => { u = x; setThumb(x) }).catch(() => {})
    return () => { if (u) URL.revokeObjectURL(u) }
  }, [img?.path])
  if (img && thumb) return <img src={thumb} alt={item.title} className="h-36 w-full object-cover" />
  const Icon = iconForTags(item.confirmed_skills)
  return (
    <div className="flex h-36 w-full items-center justify-center" style={{ background: gradientFor(item.id) }}>
      <Icon className="h-10 w-10 text-white/90" />
    </div>
  )
}

const EVIDENCE_TYPES = [
  'Portfolio links', 'Uploaded documents', 'Research papers', 'Presentations', 'Certificates',
  'Leadership activities', 'Volunteer work', 'Internships', 'Creative work', 'Case studies',
  'Business projects', 'Videos', 'Audio', 'Technical repositories',
]

export function EvidenceGallery({ studentId, mode }: { studentId: string; mode: 'owner' | 'viewer' }) {
  const { toast } = useToast()
  const [items, setItems] = useState<EvidenceItem[] | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [view, setView] = useState<EvidenceItem | null>(null)

  const owner = mode === 'owner'

  async function reload() {
    try {
      const list = owner ? await evidenceApi.list() : await evidenceApi.listForStudent(studentId)
      setItems(list)
    } catch {
      setItems([])
    }
  }
  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, mode])

  const stats = useMemo(() => {
    const list = items ?? []
    const skills = new Set<string>()
    for (const it of list) it.confirmed_skills.forEach((s) => skills.add(s))
    return { skills: skills.size, count: list.length }
  }, [items])

  if (items === null) return <p className="text-sm text-muted-foreground">Loading evidence…</p>

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Portfolio</h2>
          <p className="text-sm text-muted-foreground">Your portfolio of real work — with the skills you demonstrated. Add evidence so employers can see the proof.</p>
        </div>
        {owner && (
          <Button onClick={() => setShowAdd(true)} className="gap-1.5"><Plus className="h-4 w-4" /> Add evidence</Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Card grid */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((ev) => (
            <Card key={ev.id} className="overflow-hidden">
              <PreviewThumb item={ev} />
              <CardBody className="space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold leading-tight">{ev.title}</p>
                  <StatusPill status={ev.status} />
                </div>
                {ev.confirmed_skills.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {ev.confirmed_skills.slice(0, 4).map((s) => (
                      <Badge key={s} tone="accent" className="text-[11px]">{s}</Badge>
                    ))}
                  </div>
                )}
                <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={() => setView(ev)}>
                  <Eye className="h-4 w-4" /> View evidence
                </Button>
              </CardBody>
            </Card>
          ))}

          {owner && (
            <button
              onClick={() => setShowAdd(true)}
              className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-input p-4 text-center text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5"
            >
              <Plus className="h-6 w-6" />
              <span className="text-sm font-medium">Add evidence</span>
              <span className="text-xs">Link or upload your work</span>
            </button>
          )}

          {items.length === 0 && !owner && (
            <p className="text-sm text-muted-foreground">This candidate has not added evidence yet.</p>
          )}
        </div>

        {/* Summary sidebar */}
        <aside className="space-y-4 lg:sticky lg:top-6 self-start">
          <Card>
            <CardBody className="space-y-3">
              <h3 className="font-semibold">AI evidence summary</h3>
              <SummaryRow Icon={Sparkles} value={stats.skills} label="skills demonstrated" />
              <SummaryRow Icon={CheckCircle2} value={stats.count} label="evidence items" />
            </CardBody>
          </Card>

          {owner && (
            <button
              onClick={() => setShowAdd(true)}
              className="flex w-full items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-left transition-colors hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10"
            >
              <div className="flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">Recommendation</p>
                <p className="text-sm font-medium text-amber-900 dark:text-amber-200">Add your strongest project to build out your evidence.</p>
              </div>
              <ArrowRight className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300" />
            </button>
          )}
        </aside>
      </div>

      {/* How it works */}
      <Card>
        <CardBody className="space-y-4">
          <h3 className="font-semibold">How it works</h3>
          <div className="grid gap-4 md:grid-cols-3">
            <Step Icon={Brain} title="AI finds possible skills" />
            <Step Icon={User} title="You confirm your contribution" />
            <Step Icon={Eye} title="Employers see it in your gallery" last />
          </div>
          <p className="text-sm text-muted-foreground">
            We use AI to identify skills in your evidence. You review and confirm what you actually did. Your gallery is shared with employers when you apply, so they can see the proof behind your skills.
          </p>
        </CardBody>
      </Card>

      {/* What you can add */}
      <Card>
        <CardBody className="space-y-3">
          <h3 className="font-semibold">What can you add as evidence?</h3>
          <p className="text-sm text-muted-foreground">You can attach many types of proof — not just photos.</p>
          <div className="flex flex-wrap gap-1.5">
            {EVIDENCE_TYPES.map((t) => (
              <span key={t} className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">{t}</span>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* Add modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add evidence" size="lg">
        <EvidenceAddForm onAdded={() => { setShowAdd(false); reload() }} onCancel={() => setShowAdd(false)} />
      </Modal>

      {/* View modal */}
      {view && (
        <EvidenceDetail
          item={view}
          owner={owner}
          onClose={() => setView(null)}
        />
      )}
    </div>
  )
}

function SummaryRow({ Icon, value, label }: { Icon: typeof Sparkles; value: number; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-lg font-bold leading-none">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}

function Step({ Icon, title, last }: { Icon: typeof Brain; title: string; last?: boolean }) {
  return (
    <div className="relative flex flex-col items-start gap-2">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {!last && <div className="absolute left-5 top-10 hidden h-px w-[calc(100%-2.5rem)] bg-border md:block" />}
    </div>
  )
}

function EvidenceDetail({
  item, owner, onClose,
}: {
  item: EvidenceItem
  owner: boolean
  onClose: () => void
}) {
  return (
    <Modal open onClose={onClose} title={item.title} size="lg">
      <div className="space-y-4">
        <PreviewThumb item={item} />
        <div className="flex items-center justify-between gap-2">
          <StatusPill status={item.status} />
        </div>
        {item.description && <p className="text-sm text-muted-foreground">{item.description}</p>}

        {item.ai_summary && (
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="mb-1 text-xs font-semibold text-muted-foreground">WHAT THIS SHOWS</p>
            <p className="text-sm">{item.ai_summary}</p>
          </div>
        )}

        {item.links?.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">LINKS</p>
            <div className="flex flex-wrap gap-1.5">
              {item.links!.map((l) => (
                <a key={l} href={l} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs text-primary hover:bg-primary/10">
                  <ExternalLink className="h-3 w-3" /> <span className="max-w-[16rem] truncate">{l}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {item.files?.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">FILES</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {item.files!.map((f, i) => (
                <FileRow key={i} file={f} />
              ))}
            </div>
          </div>
        )}

        {item.confirmed_skills.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">SKILLS DEMONSTRATED</p>
            <div className="flex flex-wrap gap-1.5">
              {item.confirmed_skills.map((s) => <Badge key={s} tone="accent">{s}</Badge>)}
            </div>
          </div>
        )}

        {owner && (
          <p className="text-xs text-muted-foreground">This evidence is part of your public gallery and is shared with employers you apply to.</p>
        )}
      </div>
    </Modal>
  )
}

function FileRow({ file }: { file: { path: string; name: string } }) {
  const { toast } = useToast()
  function open(download: boolean) {
    fetchProtectedDocument(file.path).then((u) => {
      if (download) {
        const a = document.createElement('a'); a.href = u; a.download = file.name; a.click()
      } else window.open(u, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(u), 60_000)
    }).catch(() => toast({ title: 'Could not open file', tone: 'error' }))
  }
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border p-2">
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <FileText className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{file.name}</span>
      </span>
      <div className="flex shrink-0 gap-0.5">
        <button onClick={() => open(false)} className="rounded p-1 hover:bg-muted" aria-label="View"><Eye className="h-4 w-4" /></button>
        <button onClick={() => open(true)} className="rounded p-1 hover:bg-muted" aria-label="Download"><ExternalLink className="h-4 w-4" /></button>
      </div>
    </div>
  )
}
