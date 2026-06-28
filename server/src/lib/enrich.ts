// ----------------------------------------------------------------------------
// Enrichment helpers shared by the AI, profiles, and jobs routes.
//
// They keep a student's structured résumé profile and the profile/job embeddings
// up to date, and expose the semantic-similarity RPC. Every function is guarded
// two ways so the app keeps working before the user has run migrations 0008/0009
// or set VOYAGE_API_KEY:
//   • column-existence is probed once and cached (like the cv_url / content-col
//     guards already in the routes),
//   • embeddings simply no-op when Voyage isn't configured.
// ----------------------------------------------------------------------------

import { sb, j } from '@/db'
import { now } from '@/lib/util'
import { parseResume, heuristicResume, type ResumeProfile } from '@/lib/resume'
import { embedOne, toVector, hasEmbeddings, studentEmbedText, jobEmbedText } from '@/lib/embeddings'
import { extractDocumentText, hasClaude } from '@/lib/claude'

// --- one-shot column probes (cached) -------------------------------------------------
const colCache = new Map<string, boolean>()
async function colExists(table: 'profiles' | 'job_listings', col: string): Promise<boolean> {
  const key = `${table}.${col}`
  if (colCache.get(key)) return true
  const { error } = await sb.from(table).select(col).limit(1)
  const ok = !error
  if (ok) colCache.set(key, true)
  return ok
}
export const hasResumeCols = () => colExists('profiles', 'resume_profile')
export const hasProfileEmbedding = () => colExists('profiles', 'embedding')
export const hasJobEmbedding = () => colExists('job_listings', 'embedding')

/** jsonb comes back as an object via PostgREST, but tolerate a stringified value too. */
export function asResumeProfile(v: any): ResumeProfile | null {
  if (!v) return null
  if (typeof v === 'string') { try { return JSON.parse(v) } catch { return null } }
  return v as ResumeProfile
}

/**
 * Make sure the student's résumé TEXT is available. Uploads only store the file
 * (cv_url) — this pulls the plain text out of it (once) so the whole AI layer
 * (chat, matches, insights, snapshot) can actually read the candidate's résumé.
 * Returns the text (possibly ''), and back-fills `row.cv_text` in place.
 */
export async function ensureCvText(row: any): Promise<string> {
  const existing = (row?.cv_text ?? '').trim()
  if (existing) return existing
  const url = row?.cv_url
  if (!url || !hasClaude()) return ''
  const text = await extractDocumentText(url)
  if (text) {
    await sb.from('profiles').update({ cv_text: text }).eq('id', row.id)
    row.cv_text = text
    return text
  }
  return ''
}

/**
 * Return the student's structured résumé profile, parsing + persisting it on the
 * first scoring or whenever the CV changed (resume_parsed_at unset). Falls back
 * to a heuristic profile if Claude is unavailable. No-ops without the columns.
 */
export async function ensureResumeProfile(row: any): Promise<ResumeProfile | null> {
  const cv = await ensureCvText(row)
  if (!cv) return null
  if (!(await hasResumeCols())) return asResumeProfile(row?.resume_profile)

  const existing = asResumeProfile(row.resume_profile)
  if (existing && row.resume_parsed_at) return existing

  const parsed = (await parseResume(cv)) ?? heuristicResume(cv, j.parse(row.skills, []))
  await sb.from('profiles').update({ resume_profile: parsed, resume_parsed_at: now() }).eq('id', row.id)
  return parsed
}

/** Recompute + persist a student's embedding from their current profile + résumé. */
export async function embedStudent(row: any, rp: ResumeProfile | null): Promise<void> {
  if (!hasEmbeddings() || !(await hasProfileEmbedding())) return
  const text = studentEmbedText({
    major: row.major,
    skills: j.parse(row.skills, []),
    desired_roles: j.parse(row.desired_roles, []),
    preferred_industries: j.parse(row.preferred_industries, []),
    cv_text: row.cv_text,
    resume_summary: rp?.summary ?? null,
  })
  const vec = await embedOne(text, 'document')
  if (vec) await sb.from('profiles').update({ embedding: toVector(vec) }).eq('id', row.id)
}

/** Recompute + persist a job's embedding. Safe to call from create/update. */
export async function embedJob(row: any): Promise<void> {
  if (!hasEmbeddings() || !(await hasJobEmbedding())) return
  const text = jobEmbedText({
    title: row.title,
    type: row.type,
    listing_type: row.listing_type,
    tags: j.parse(row.tags, []),
    description: row.description,
  })
  const vec = await embedOne(text, 'document')
  if (vec) await sb.from('job_listings').update({ embedding: toVector(vec) }).eq('id', row.id)
}

/** Full refresh after a match-affecting profile change: reparse résumé + re-embed. */
export async function refreshStudentEnrichment(studentId: string): Promise<void> {
  const { data: row } = await sb.from('profiles').select('*').eq('id', studentId).maybeSingle()
  if (!row) return
  if (await hasResumeCols()) {
    // force reparse: clear the stamp, then ensure
    await sb.from('profiles').update({ resume_parsed_at: null }).eq('id', studentId)
    row.resume_parsed_at = null
  }
  const rp = await ensureResumeProfile(row)
  await embedStudent(row, rp)
}

/** jobId -> cosine similarity (0..1) for this student. Empty map when off. */
export async function semanticSimilarities(studentId: string): Promise<Map<string, number>> {
  if (!hasEmbeddings() || !(await hasProfileEmbedding())) return new Map()
  const { data, error } = await sb.rpc('semantic_job_matches', { p_student_id: studentId, p_limit: 300 })
  if (error || !Array.isArray(data)) return new Map()
  return new Map(data.map((d: any) => [d.job_id as string, Number(d.similarity) || 0]))
}

/**
 * Stage 0+1 of the match funnel: hard-filter active jobs by the student's
 * opportunity-type and country preferences AND rank them by embedding similarity,
 * all in one indexed Postgres query (the `match_candidate_jobs` RPC). Returns up
 * to `limit` candidates best-first, or null when the RPC isn't available yet
 * (migration 0013 not run / older schema) so the caller can fall back to a scan.
 * Empty preference arrays mean "no restriction" on that axis.
 */
export async function retrieveCandidateJobs(
  studentId: string,
  listingTypes: string[],
  countries: string[],
  limit = 600,
): Promise<{ job_id: string; similarity: number | null }[] | null> {
  const { data, error } = await sb.rpc('match_candidate_jobs', {
    p_student_id: studentId,
    p_listing_types: listingTypes.length ? listingTypes : null,
    p_countries: countries.length ? countries : null,
    p_limit: limit,
  })
  if (error || !Array.isArray(data)) return null
  return data.map((d: any) => ({
    job_id: d.job_id as string,
    similarity: d.similarity == null ? null : Number(d.similarity),
  }))
}

/**
 * Query-driven retrieval for AI Sourcing / search: ANN-rank active jobs by an
 * arbitrary QUERY embedding (+ hard filters) via match_jobs_by_vector (migration
 * 0018). Returns top candidates best-first, or null when the RPC isn't available
 * so the caller can fall back to a scan.
 */
export async function retrieveJobsByVector(
  vec: number[],
  listingTypes: string[],
  countries: string[],
  remote: boolean,
  limit = 200,
): Promise<{ job_id: string; similarity: number }[] | null> {
  const { data, error } = await sb.rpc('match_jobs_by_vector', {
    p_embedding: toVector(vec),
    p_listing_types: listingTypes.length ? listingTypes : null,
    p_countries: countries.length ? countries : null,
    p_remote: remote,
    p_limit: limit,
  })
  if (error || !Array.isArray(data)) return null
  return data.map((d: any) => ({ job_id: d.job_id as string, similarity: Number(d.similarity) || 0 }))
}
