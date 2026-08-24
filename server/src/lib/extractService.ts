// Optional Python extraction microservice client.
//
// Stack the product recommends for heavy content (Crawl4AI + Playwright for
// JavaScript-heavy pages, Unstructured/Docling for DOCX/PPTX/XLS, Whisper for
// audio/video, and a vision LLM for images). The Node backend can't run those
// natively on Cloudflare Workers, so when EXTRACTION_SERVICE_URL is set we
// delegate the content types Node can't process to this service.
//
// When the env var is unset, callers fall back to what Node does natively
// (URLs via fetch, PDFs via unpdf, images via Mistral vision) and simply skip
// DOCX/PPTX/audio/video.
//
// Service contract:
//   POST {EXTRACTION_SERVICE_URL}/extract
//   body: { kind: "url" | "file", url?, filename?, data_base64?, mime? }
//   response: { text: string }   (cleaned, AI-ready text of the content)

const SERVICE_URL = process.env.EXTRACTION_SERVICE_URL

export function hasExtractionService(): boolean {
  return !!SERVICE_URL
}

export async function extractViaService(payload: {
  kind: 'url' | 'file'
  url?: string
  filename?: string
  data_base64?: string
  mime?: string
}): Promise<{ text: string } | null> {
  if (!SERVICE_URL) return null
  try {
    const res = await fetch(`${SERVICE_URL.replace(/\/$/, '')}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000),
    })
    if (!res.ok) return null
    const data: any = await res.json()
    const text = typeof data?.text === 'string' ? data.text : ''
    return text ? { text } : null
  } catch {
    return null
  }
}
