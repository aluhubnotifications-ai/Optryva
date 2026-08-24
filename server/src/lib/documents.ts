import { sb, j, must } from '@/db'
import { uid, now } from '@/lib/util'
import { isAdminEmail } from '@/lib/admin'

export const DOCUMENT_BUCKET = 'private-documents'
const SIGNED_URL_TTL = 300

const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024
const MAX_DOCUMENTS = 8
const DATA_URL_RE = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/jpeg',
  'image/png',
  'application/rtf',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain', rtf: 'application/rtf', odt: 'application/vnd.oasis.opendocument.text',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
}

export function validateDocumentUrl(value: unknown, filename?: unknown): string | null {
  if (typeof value !== 'string' || !value) return 'document_url_invalid'
  // Already-stored URLs (served via /api/documents/…) are accepted as-is; they
  // were validated when first uploaded and don't need re-decoding.
  if (/^https?:\/\//.test(value) || value.startsWith('/')) return null
  const match = DATA_URL_RE.exec(value)
  if (!match) return 'document_format_invalid'
  const extension = typeof filename === 'string' ? filename.toLowerCase().split('.').pop() : ''
  const mime = match[1].toLowerCase()
  if (!ALLOWED_MIME.has(mime) && !(mime === 'application/octet-stream' && extension && MIME_BY_EXTENSION[extension])) return 'document_format_invalid'
  const payload = match[2].replace(/\s/g, '')
  if (payload.length % 4 === 1) return 'document_format_invalid'
  const bytes = Math.floor(payload.length * 3 / 4) - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0)
  if (bytes > MAX_DOCUMENT_BYTES) return 'document_too_large'
  return null
}

export function validateDocuments(value: unknown): string | null {
  if (!Array.isArray(value)) return 'documents_invalid'
  if (value.length > MAX_DOCUMENTS) return 'too_many_documents'
  let totalBytes = 0
  for (const document of value) {
    if (!document || typeof document !== 'object') return 'document_invalid'
    const error = validateDocumentUrl((document as { url?: unknown }).url, (document as { name?: unknown }).name)
    if (error) return error
    const url = (document as { url: string }).url
    // Already-stored URLs aren't base64 payloads, so skip byte accounting for them.
    if (url.includes(',')) {
      const payload = url.slice(url.indexOf(',') + 1).replace(/\s/g, '')
      totalBytes += Math.floor(payload.length * 3 / 4) - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0)
    }
  }
  return totalBytes > 20 * 1024 * 1024 ? 'documents_too_large' : null
}

function decodeDataUrl(value: string): { mime: string; bytes: Uint8Array } {
  const match = DATA_URL_RE.exec(value)
  if (!match) throw new Error('document_format_invalid')
  const encoded = match[2].replace(/\s/g, '')
  const binary = atob(encoded)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return { mime: match[1].toLowerCase(), bytes }
}

function tokenFor(path: string): string {
  return btoa(path).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function pathFromToken(token: string): string | null {
  try {
    const padded = token.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - token.length % 4) % 4)
    return atob(padded)
  } catch {
    return null
  }
}

export function documentUrl(path: string): string {
  return `/api/documents/${tokenFor(path)}`
}

export async function storeDocument(ownerId: string, kind: string, name: string, dataUrl: string) {
  // Already-stored URLs are passed through untouched (path stays null so callers
  // know the bytes live in Supabase Storage already, not re-uploaded).
  if (/^https?:\/\//.test(dataUrl) || dataUrl.startsWith('/')) {
    return { path: null, url: dataUrl, mime: '', size: 0 }
  }
  const { mime, bytes } = decodeDataUrl(dataUrl)
  const path = `${ownerId}/${uid('document')}-${kind}-${name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const { error } = await sb.storage.from(DOCUMENT_BUCKET).upload(path, bytes, { contentType: mime, upsert: false })
  if (error) throw new Error(`document_upload_failed: ${error.message}`)
  return { path, url: documentUrl(path), mime, size: bytes.byteLength }
}

export async function signedDocumentUrl(path: string): Promise<string> {
  const { data, error } = await sb.storage.from(DOCUMENT_BUCKET).createSignedUrl(path, SIGNED_URL_TTL)
  if (error || !data?.signedUrl) throw new Error(`document_sign_failed: ${error?.message ?? 'missing_url'}`)
  return data.signedUrl
}

async function audit(path: string, viewerId: string) {
  await sb.from('document_access_audit').insert({ id: uid('audit'), document_path: path, viewer_id: viewerId, action: 'download', created_at: now() })
}

export async function canReadDocument(path: string, viewer: { id: string; email: string }): Promise<boolean> {
  if (isAdminEmail(viewer.email)) return true
  // Evidence files (`<ownerId>/evidence/…`) are shareable proof-of-work that a
  // candidate surfaces to reviewers, so any authenticated user may read them.
  const segments = path.split('/')
  if (segments[1] === 'evidence') return true
  // A student can read any document stored under their own upload prefix
  // (résumés, evidence files, etc.).
  if (path.startsWith(`${viewer.id}/`)) return true
  const profile = must(await sb.from('profiles').select('id').eq('id', viewer.id).eq('cv_storage_path', path).maybeSingle())
  if (profile) return true
  const resume = must(await sb.from('resume_profiles').select('id').eq('student_id', viewer.id).eq('cv_storage_path', path).maybeSingle())
  if (resume) return true
  const ownApps = must(await sb.from('applications').select('id,job_id,documents').eq('student_id', viewer.id)) as any[]
  const ownedJobs = must(await sb.from('job_listings').select('id').eq('company_id', viewer.id)) as any[]
  const jobIds = new Set(ownedJobs.map((job) => job.id))
  const employerApps = jobIds.size
    ? must(await sb.from('applications').select('id,job_id,documents').in('job_id', [...jobIds])) as any[]
    : []
  return [...ownApps, ...employerApps].some((application) => j.parse<any[]>(application.documents, []).some((document) => document.storage_path === path))
}

export async function authorizeAndSign(path: string, viewer: { id: string; email: string }): Promise<string | null> {
  if (!await canReadDocument(path, viewer)) return null
  await audit(path, viewer.id)
  return signedDocumentUrl(path)
}
