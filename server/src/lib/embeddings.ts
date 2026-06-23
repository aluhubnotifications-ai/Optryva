// ----------------------------------------------------------------------------
// Voyage AI embeddings — semantic layer of the matcher.
//
// Anthropic has no embeddings endpoint, so vectors come from Voyage (Anthropic's
// recommended partner). Everything here is null-safe: with no VOYAGE_API_KEY the
// functions return null and the engine falls back to the ontology + Claude
// layers — nothing breaks, semantic ranking just stays dormant until the key is
// set. Model voyage-3 → 1024 dims, matching the vector(1024) columns.
// ----------------------------------------------------------------------------

const VOYAGE_KEY = process.env.VOYAGE_API_KEY
const MODEL = process.env.VOYAGE_MODEL ?? 'voyage-3'
const ENDPOINT = 'https://api.voyageai.com/v1/embeddings'

export function hasEmbeddings(): boolean {
  return !!VOYAGE_KEY
}

/**
 * Embed a batch of texts. `input_type` should be 'document' for stored records
 * (jobs, profiles) and 'query' for a live search. Returns one vector per input,
 * or null on any failure (no key, network, rate limit).
 */
export async function embed(
  texts: string[],
  inputType: 'document' | 'query' = 'document',
): Promise<number[][] | null> {
  if (!VOYAGE_KEY || texts.length === 0) return null
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${VOYAGE_KEY}` },
      body: JSON.stringify({ input: texts.map((t) => t.slice(0, 8000)), model: MODEL, input_type: inputType }),
    })
    if (!res.ok) return null
    const data: any = await res.json()
    const out = (data?.data ?? []).map((d: any) => d.embedding as number[])
    return out.length === texts.length ? out : null
  } catch {
    return null
  }
}

export async function embedOne(text: string, inputType: 'document' | 'query' = 'document'): Promise<number[] | null> {
  const r = await embed([text], inputType)
  return r?.[0] ?? null
}

/** pgvector accepts a bracketed string literal: '[0.1,0.2,...]'. */
export function toVector(v: number[]): string {
  return `[${v.join(',')}]`
}

/** Build the document we embed for a job listing. */
export function jobEmbedText(job: { title: string; type?: string; listing_type?: string; tags?: string[]; description?: string }): string {
  return [
    job.title,
    job.type,
    job.listing_type,
    (job.tags ?? []).join(', '),
    (job.description ?? '').slice(0, 4000),
  ]
    .filter(Boolean)
    .join('\n')
}

/** Build the document we embed for a student profile. */
export function studentEmbedText(s: {
  major?: string | null
  skills?: string[]
  desired_roles?: string[]
  preferred_industries?: string[]
  cv_text?: string | null
  resume_summary?: string | null
}): string {
  return [
    s.major ? `Field: ${s.major}` : '',
    (s.desired_roles ?? []).length ? `Target roles: ${(s.desired_roles ?? []).join(', ')}` : '',
    (s.skills ?? []).length ? `Skills: ${(s.skills ?? []).join(', ')}` : '',
    (s.preferred_industries ?? []).length ? `Industries: ${(s.preferred_industries ?? []).join(', ')}` : '',
    s.resume_summary ?? '',
    (s.cv_text ?? '').slice(0, 4000),
  ]
    .filter(Boolean)
    .join('\n')
}
