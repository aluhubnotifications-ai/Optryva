import { useRef, useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { Input, Label } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { CoverImage } from '@/components/CoverImage'
import { useToast } from '@/components/ui/toast'
import { imageFileToCoverUrl } from '@/lib/utils'

/**
 * Editable cover banner: shows the current cover image (or a gradient fallback)
 * with a button to upload a file or paste an image link. `onChange` receives the
 * new cover_url (data URL for uploads, or the pasted URL); passing '' clears it.
 */
export function CoverEditor({
  src,
  isSchool,
  onChange,
}: {
  src?: string
  isSchool?: boolean
  onChange: (coverUrl: string) => Promise<void> | void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')

  async function apply(coverUrl: string) {
    setBusy(true)
    try {
      await onChange(coverUrl)
      setOpen(false)
      setUrl('')
    } finally {
      setBusy(false)
    }
  }

  async function onFile(file?: File) {
    if (!file) return
    try {
      const dataUrl = await imageFileToCoverUrl(file)
      await apply(dataUrl)
    } catch (e) {
      toast({ title: 'Could not use that image', description: e instanceof Error ? e.message : undefined, tone: 'error' })
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function applyLink() {
    const u = url.trim()
    if (!/^https?:\/\/.+/i.test(u)) {
      toast({ title: 'Enter a valid image URL (https://…)', tone: 'error' })
      return
    }
    await apply(u)
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      <div className="group relative h-44">
        <CoverImage src={src} isSchool={isSchool} />
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={busy}
          className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-lg bg-card/90 px-3 py-1.5 text-xs font-medium text-foreground shadow-soft backdrop-blur transition hover:bg-card"
          title="Change cover"
        >
          <ImagePlus className="h-3.5 w-3.5" /> {busy ? 'Saving…' : src ? 'Change cover' : 'Add cover'}
        </button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Cover image">
        <div className="space-y-4">
          <Button type="button" variant="outline" className="w-full gap-2" onClick={() => fileRef.current?.click()} disabled={busy}>
            <ImagePlus className="h-4 w-4" /> Upload from device
          </Button>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> or paste a link <div className="h-px flex-1 bg-border" />
          </div>

          <div>
            <Label>Image URL</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            {/^https?:\/\/.+/i.test(url.trim()) && (
              <div className="mt-2 overflow-hidden rounded-lg border border-border">
                <img src={url.trim()} alt="Preview" className="h-24 w-full object-cover" />
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2">
            {src ? (
              <Button variant="ghost" className="gap-1.5 text-danger" onClick={() => apply('')} disabled={busy}>
                <Trash2 className="h-4 w-4" /> Remove
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={applyLink} loading={busy}>Use image</Button>
            </div>
          </div>
        </div>
      </Modal>
    </>
  )
}
