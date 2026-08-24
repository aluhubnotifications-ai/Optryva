import { useRef, useState } from 'react'
import { Upload, Link2, X, Image as ImageIcon, Plus, FileText } from 'lucide-react'
import { evidenceApi } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/toast'
import { Input, Textarea, Label } from '@/components/ui/primitives'
import { fileToDataUrl } from '@/lib/utils'

const isImage = (name: string) => /\.(png|jpe?g|gif|webp|svg)$/i.test(name)

export function EvidenceAddForm({ onAdded, onCancel }: { onAdded: () => void; onCancel?: () => void }) {
  const { toast } = useToast()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [linkInput, setLinkInput] = useState('')
  const [links, setLinks] = useState<string[]>([])
  const [pendingFiles, setPendingFiles] = useState<{ data: string; name: string }[]>([])
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

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
    setBusy(true)
    try {
      await evidenceApi.create({ title: title.trim(), description, links, files: pendingFiles })
      setTitle(''); setDescription(''); setLinks([]); setPendingFiles([]); setLinkInput('')
      toast({ title: 'Evidence added', tone: 'success' })
      onAdded()
    } catch {
      toast({ title: 'Could not add evidence', tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <p className="text-sm font-semibold">Add proof of your work</p>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        Paste any link — website, GitHub, Instagram, YouTube, an article — or upload a picture/file. Optryva's AI can suggest the skills you demonstrated.
      </p>

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
        <Button size="sm" type="button" onClick={addEvidence} loading={busy}>
          Add evidence
        </Button>
        {onCancel && (
          <Button variant="ghost" size="sm" type="button" onClick={onCancel}>Cancel</Button>
        )}
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
    </div>
  )
}
