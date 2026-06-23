import { useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { Avatar, Input, Label } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/toast'
import { imageFileToDataUrl } from '@/lib/utils'

/**
 * Editable avatar: a small camera badge at the bottom-right corner opens a dialog
 * to upload a file or paste an image link. `onChange` receives the new avatar_url
 * (data URL for uploads, or the pasted URL) and persists it.
 */
export function AvatarEditor({
  name,
  src,
  size = 72,
  rounded = 'rounded-full',
  onChange,
}: {
  name?: string
  src?: string
  size?: number
  rounded?: string
  onChange: (avatarUrl: string) => Promise<void> | void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')

  async function apply(avatarUrl: string) {
    setBusy(true)
    try {
      await onChange(avatarUrl)
      setOpen(false)
      setUrl('')
    } finally {
      setBusy(false)
    }
  }

  async function onFile(file?: File) {
    if (!file) return
    try {
      const dataUrl = await imageFileToDataUrl(file)
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
      <div className={`group relative inline-block ${rounded}`}>
        <Avatar name={name} src={src} size={size} className={rounded} />
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={busy}
          className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground shadow-soft transition hover:brightness-110"
          title="Change picture"
          aria-label="Change picture"
        >
          {busy ? <span className="text-[10px]">…</span> : <Camera className="h-3.5 w-3.5" />}
        </button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Change picture">
        <div className="space-y-4">
          <Button type="button" variant="outline" className="w-full gap-2" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Camera className="h-4 w-4" /> Upload from device
          </Button>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> or paste a link <div className="h-px flex-1 bg-border" />
          </div>

          <div>
            <Label>Image URL</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            {/^https?:\/\/.+/i.test(url.trim()) && (
              <div className="mt-2 flex items-center gap-3">
                <span className="text-xs text-muted-foreground">Preview:</span>
                <Avatar name={name} src={url.trim()} size={48} className={rounded} />
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={applyLink} loading={busy}>Use image</Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
