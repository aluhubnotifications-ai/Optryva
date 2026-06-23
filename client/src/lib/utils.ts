import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Global, locale-aware currency formatting — replaces the old usdToRwf helper. */
export function formatMoney(
  amount: number,
  currency = 'USD',
  opts: Intl.NumberFormatOptions = {},
) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    ...opts,
  }).format(amount)
}

export function formatDate(input: string | number | Date, opts?: Intl.DateTimeFormatOptions) {
  const d = new Date(input)
  return new Intl.DateTimeFormat(undefined, opts ?? { month: 'short', day: 'numeric', year: 'numeric' }).format(d)
}

export function timeAgo(input: string | number | Date) {
  const d = new Date(input).getTime()
  const diff = Date.now() - d
  const sec = Math.round(diff / 1000)
  const min = Math.round(sec / 60)
  const hr = Math.round(min / 60)
  const day = Math.round(hr / 24)
  if (sec < 60) return 'just now'
  if (min < 60) return `${min}m ago`
  if (hr < 24) return `${hr}h ago`
  if (day < 7) return `${day}d ago`
  return formatDate(input)
}

export function initials(name?: string) {
  if (!name) return '?'
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

export function daysUntil(date?: string | null) {
  if (!date) return null
  const diff = new Date(date).getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

/** Deterministic thread id for student-to-student DMs (sorted, joined). */
export function dmThreadId(a: string, b: string) {
  return [a, b].sort().join('__')
}

/** Simple deterministic hash → used for stable mock AI scores. */
export function seededScore(seed: string, min = 30, max = 99) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const n = Math.abs(h % 1000) / 1000
  return Math.round(min + n * (max - min))
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

/**
 * Read an image File, downscale it (square cover crop) to `size` px, and return
 * a compressed JPEG data URL — small enough (~tens of KB) to store directly in
 * the profile's avatar_url text column. Throws on non-images / read errors.
 */
export async function imageFileToDataUrl(file: File, size = 256): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Could not read the file.'))
    reader.readAsDataURL(file)
  })
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('Could not load the image.'))
    i.src = dataUrl
  })
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl // fallback: original
  // center-crop to a square, then scale to `size`
  const side = Math.min(img.width, img.height)
  const sx = (img.width - side) / 2
  const sy = (img.height - side) / 2
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
  return canvas.toDataURL('image/jpeg', 0.85)
}

/**
 * Like {@link imageFileToDataUrl}, but center-crops to a wide banner aspect ratio
 * (default 4:1) for use as a cover photo — so landscape uploads aren't squished
 * into a square. Returns a compressed JPEG data URL.
 */
export async function imageFileToCoverUrl(file: File, width = 1200, height = 300): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Could not read the file.'))
    reader.readAsDataURL(file)
  })
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('Could not load the image.'))
    i.src = dataUrl
  })
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl // fallback: original
  // center-crop the source to the target aspect ratio, then scale to fit
  const targetRatio = width / height
  let sw = img.width
  let sh = img.width / targetRatio
  if (sh > img.height) { sh = img.height; sw = img.height * targetRatio }
  const sx = (img.width - sw) / 2
  const sy = (img.height - sh) / 2
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height)
  return canvas.toDataURL('image/jpeg', 0.85)
}

/**
 * Read any file (PDF, image, doc…) into a data URL so it can be stored inline
 * and viewed/downloaded later. `maxBytes` is a per-file guard; the combined
 * payload is also checked at submit time against the server's body limit.
 */
export async function fileToDataUrl(file: File, maxBytes = 8 * 1024 * 1024): Promise<string> {
  if (file.size > maxBytes) {
    throw new Error(`File is too large (${formatBytes(file.size)}). Max ${formatBytes(maxBytes)}.`)
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Could not read the file.'))
    reader.readAsDataURL(file)
  })
}

/** Human-readable byte size, e.g. 234000 → "229 KB". */
export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const n = bytes / 1024 ** i
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`
}
