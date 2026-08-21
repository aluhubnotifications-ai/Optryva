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
])

export function validateDocumentUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return 'document_url_invalid'
  const match = DATA_URL_RE.exec(value)
  if (!match || !ALLOWED_MIME.has(match[1].toLowerCase())) return 'document_format_invalid'
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
    const error = validateDocumentUrl((document as { url?: unknown }).url)
    if (error) return error
    const url = (document as { url: string }).url
    const payload = url.slice(url.indexOf(',') + 1).replace(/\s/g, '')
    totalBytes += Math.floor(payload.length * 3 / 4) - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0)
  }
  return totalBytes > 20 * 1024 * 1024 ? 'documents_too_large' : null
}
