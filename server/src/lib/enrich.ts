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
 * Return the student's structured résumé profile, parsing + persisting it on the
 * first scoring or whenever the CV changed (resume_parsed_at unset). Falls back
 * to a heuristic profile if Claude is unavailable. No-ops without the columns.
 */
export async function ensureResumeProfile(row: any): Promise<ResumeProfile | null> {
  const cv = (row?.cv_text ?? '').trim()
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
