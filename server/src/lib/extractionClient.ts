// ============================================================================
// Extraction client — how the API Worker talks to the Extraction Worker
// ============================================================================
// The heavy AI/parsing work (Mistral vision + text, unpdf, link crawling, the
// Python extraction service) lives in a SEPARATE Worker, `optryva-extract`, so
// this API Worker (`optryva`) stays lean. This module is the only place that
// reaches the extraction Worker.
//
// HOW IT CONNECTS (important — read before changing):
//   Cloudflare Workers CANNOT `fetch()` another `*.workers.dev` hostname. Those
//   names resolve to Cloudflare's own IPs, which are rejected for subrequests
//   with error 1042 ("DNS points to prohibited IP"). So a plain HTTPS call from
//   `optryva` to `optryva-extract…workers.dev` ALWAYS fails silently → the
//   evidence summary / chat fall back to "No evidence submitted yet." / "I could
//   not analyse".
//
//   The fix is a SERVICE BINDING: `optryva` binds to `optryva-extract` and calls
//   it INTERNALLY (no public DNS). See wrangler.jsonc → "services" and
//   worker.ts (setExtractionBinding). When the binding is present we use it; the
//   HTTP path below is only a fallback for local dev / non-CF runtimes.
// ============================================================================

import { hasMistral } from '@/lib/mistral'
import type { CandidateEvidenceItem } from '@/lib/extraction'

const EXTRACTION_URL = (process.env.EXTRACTION_WORKER_URL ?? '').trim().replace(/\/+$/, '')
const EXTRACTION_TOKEN = (process.env.EXTRACTION_WORKER_TOKEN ?? '').trim()

// Optional service binding to the extraction Worker (set in worker.ts when the
// env provides one). A binding calls optryva-extract internally, sidestepping
// Cloudflare's block on Worker→Worker fetch() over *.workers.dev (error 1042).
let EXTRACTION_BINDING: any = null
export function setExtractionBinding(b: unknown) {
  EXTRACTION_BINDING = b
}

async function call<T>(path: string, body: unknown): Promise<T | null> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${EXTRACTION_TOKEN}` },
    body: JSON.stringify(body),
  }

  let r: Response
  if (EXTRACTION_BINDING) {
    const req = new Request(`https://extraction.internal${path}`, init)
    r = await EXTRACTION_BINDING.fetch(req)
  } else {
    if (!EXTRACTION_URL) {
      console.warn('[extractionClient] no extraction binding or EXTRACTION_WORKER_URL configured')
      return null
    }
    r = await fetch(`${EXTRACTION_URL}${path}`, { ...init, signal: AbortSignal.timeout(90_000) })
  }

  if (!r.ok) {
    console.error(`[extractionClient] ${path} -> ${r.status}`)
    return null
  }
  const respBody = await r.json() as T
  console.log(`[extractionClient] ${path} -> ok, keys: ${Object.keys(respBody as Record<string, unknown>).join(',')}`)
  return respBody
}

export const extractionClient = {
  url(u: string) {
    return call<{ text: string | null }>('/url', { url: u }).then((x) => x?.text ?? null)
  },
  image(dataUrl: string) {
    return call<{ description: string | null }>('/image', { dataUrl }).then((x) => x?.description ?? null)
  },
  pdf(dataBase64: string) {
    return call<{ text: string | null }>('/pdf', { data_base64: dataBase64 }).then((x) => x?.text ?? null)
  },
  file(opts: { filename?: string; data_base64: string; mime?: string }) {
    return call<{ text: string | null }>('/file', opts).then((x) => (x?.text ? { text: x.text } : null))
  },
  analyze(text: string) {
    return call<{ skills: string[]; summary: string | null }>('/analyze', { text })
  },
  candidateSummary(items: CandidateEvidenceItem[], jobDescription?: string) {
    return call<{ summary: string | null }>('/candidate-summary', { items, jobDescription: jobDescription ?? '' }).then((x) => x?.summary ?? null)
  },
  ask(question: string, items: CandidateEvidenceItem[]) {
    return call<{ answer: string | null }>('/ask', { question, items }).then((x) => x?.answer ?? null)
  },
}

// True when the extraction worker is wired up (used to decide fallback behaviour).
export function hasExtractionWorker(): boolean {
  return Boolean(EXTRACTION_URL && EXTRACTION_TOKEN)
}

// Re-export so callers that need a local capability check don't import mistral.
export { hasMistral }
