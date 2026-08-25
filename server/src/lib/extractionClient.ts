// Thin client the main API Worker uses to delegate heavy extraction compute to
// the dedicated Extraction Worker. The API Worker never runs Mistral/unpdf/
// crawler code itself — it just makes small authenticated HTTP calls. This keeps
// the main Worker bundle small.

import { hasMistral } from '@/lib/mistral'
import type { CandidateEvidenceItem } from '@/lib/extraction'

const EXTRACTION_URL = (process.env.EXTRACTION_WORKER_URL ?? '').trim().replace(/\/+$/, '')
const EXTRACTION_TOKEN = (process.env.EXTRACTION_WORKER_TOKEN ?? '').trim()

async function call<T>(path: string, body: unknown): Promise<T | null> {
  if (!EXTRACTION_URL || !EXTRACTION_TOKEN) {
    console.warn('[extractionClient] EXTRACTION_WORKER_URL/TOKEN not configured')
    return null
  }
  const target = `${EXTRACTION_URL}${path}`
  const r = await fetch(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${EXTRACTION_TOKEN}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  })
  if (!r.ok) {
    console.error(`[extractionClient] ${target} -> ${r.status}`)
    return null
  }
  return (await r.json()) as T
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
