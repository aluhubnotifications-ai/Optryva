// ----------------------------------------------------------------------------
// Match queue producer — durable control plane for AI review.
//
// Cloudflare Queues messages can be lost or redelivered, so this module writes
// the durable `match_queue_jobs` row FIRST (Supabase = source of truth) and uses
// the Queue only as a trigger. The consumer claims by updating the row
// idempotently, making double-processing safe.
// ----------------------------------------------------------------------------

import { sb, must, j } from '@/db'
import type { MatchingConfig } from '@/lib/matching'
import type { MatchCandidate } from '@/lib/matching'

// Stable hash for deduplication — derived from IDs, versions, trigger, and
// filter/prompt versions so a re-issue with the same inputs reuses the row.
function hashInput(parts: (string | number | null)[]): string {
  return require('crypto').createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16)
}

export interface EnqueueOptions {
  trigger: 'new_job' | 'job_updated' | 'resume_updated' | 'manual' | 'refresh' | 'rebuild'
  priority?: number
  promptVersion?: string
  filterVersion?: string
}

/** Default config — read from DB or use fallback. */
export async function getConfig(): Promise<MatchingConfig> {
  try {
    const { data, error } = await sb.from('matching_config')
      .select('auto_score_threshold, auto_score_top_k, max_groq_batch_size, max_auto_pairs_per_job, filter_version, prompt_version, enabled')
      .eq('id', 'default')
      .maybeSingle()
    if (error || !data) throw error
    return {
      auto_score_threshold: data.auto_score_threshold ?? 70,
      auto_score_top_k: data.auto_score_top_k ?? 10,
      max_groq_batch_size: data.max_groq_batch_size ?? 8,
      max_auto_pairs_per_job: data.max_auto_pairs_per_job ?? 20,
      filter_version: data.filter_version ?? 'filter-v1',
      prompt_version: data.prompt_version ?? 'match-prompt-v1',
      enabled: data.enabled ?? true,
    }
  } catch {
    return {
      auto_score_threshold: 70,
      auto_score_top_k: 10,
      max_groq_batch_size: 8,
      max_auto_pairs_per_job: 20,
      filter_version: 'filter-v1',
      prompt_version: 'match-prompt-v1',
      enabled: true,
    }
  }
}

/**
 * Enqueue a set of candidate pairs for AI review. Idempotent: if a queue row
 * with the same input_hash exists and is not terminal (completed/failed),
 * it is reused. The Cloudflare Queue message is sent only if no existing
 * row is in-flight.
 */
export async function enqueueUnique(
  candidateIds: string[],
  options: EnqueueOptions,
  context?: { jobId?: string; studentId?: string; resumeId?: string },
  env?: any,
): Promise<string> {
  const config = await getConfig()
  const inputHash = hashInput([
    ...candidateIds.sort(),
    options.trigger,
    options.promptVersion ?? config.prompt_version,
    options.filterVersion ?? config.filter_version,
    context?.jobId ?? null,
    context?.studentId ?? null,
    context?.resumeId ?? null,
  ])

  // Try to reuse an existing row (dedup)
  const existing = (await sb.from('match_queue_jobs')
    .select('id, status')
    .eq('input_hash', inputHash)
    .maybeSingle()).data as any

  if (existing) {
    if (existing.status === 'completed' || existing.status === 'failed') {
      // Terminal — create a new row for the new request
      const row = await createQueueRow(inputHash, candidateIds, options, config, context)
      await sendQueueMessage(row, env)
      return row.id
    }
    // Still in-flight or queued — reuse, bump priority if manual
    if (options.trigger === 'manual' || options.trigger === 'refresh') {
      await sb.from('match_queue_jobs')
        .update({ priority: Math.max(options.priority ?? 100, 50), available_at: new Date().toISOString() })
        .eq('id', existing.id)
    }
    return existing.id
  }

  const row = await createQueueRow(inputHash, candidateIds, options, config, context)
  await sendQueueMessage(row, env)
  return row.id
}

interface QueueRow {
  id: string
  trigger: string
  student_id: string | null
  job_id: string | null
  resume_id: string | null
  candidate_ids: string[]
  input_hash: string
  priority: number
  status: string
}

async function createQueueRow(
  inputHash: string,
  candidateIds: string[],
  options: EnqueueOptions,
  config: MatchingConfig,
  context?: { jobId?: string; studentId?: string; resumeId?: string },
): Promise<QueueRow> {
  const id = hashInput([inputHash, options.trigger, Date.now().toString()]).slice(0, 32)
  const row: QueueRow = {
    id,
    trigger: options.trigger,
    student_id: context?.studentId ?? null,
    job_id: context?.jobId ?? null,
    resume_id: context?.resumeId ?? null,
    candidate_ids: candidateIds,
    input_hash: inputHash,
    priority: options.priority ?? (options.trigger === 'manual' ? 100 : 50),
    status: 'queued',
  }
  await sb.from('match_queue_jobs').insert({
    id: row.id,
    trigger: row.trigger,
    student_id: row.student_id,
    job_id: row.job_id,
    resume_id: row.resume_id,
    candidate_ids: JSON.stringify(row.candidate_ids),
    input_hash: row.input_hash,
    priority: row.priority,
    status: row.status,
    prompt_version: options.promptVersion ?? config.prompt_version,
    filter_version: options.filterVersion ?? config.filter_version,
  })
  return row
}

/** Send a message to the Cloudflare Queue (if env.MATCH_QUEUE is bound). */
async function sendQueueMessage(row: QueueRow, env?: any): Promise<void> {
  if (!env?.MATCH_QUEUE) return
  const message = {
    trigger: row.trigger,
    job_id: row.job_id,
    student_id: row.student_id,
    resume_id: row.resume_id,
    candidate_ids: row.candidate_ids,
    input_hash: row.input_hash,
    priority: row.priority,
  }
  try {
    await env.MATCH_QUEUE.send(message)
  } catch (e) {
    console.warn('[matchQueue] queue send failed, durable row preserved:', (e as Error).message)
    // The durable row remains in match_queue_jobs — a later repair process
    // or cron sweep can re-dispatch it.
  }
}

/** Enqueue when a new job is published — creates pairs for all affected résumés. */
export async function enqueueNewJob(jobId: string, env?: any): Promise<void> {
  const config = await getConfig()
  if (!config.enabled) return

  // Find all active résumés for students who can see this job.
  // We don't compute full scores here — just queue the candidates so the
  // consumer does deterministic eval + AI review.
  const { data: candidates, error } = await sb
    .from('resume_profiles')
    .select('id, student_id')
    .eq('active', 1)
    .limit(config.max_auto_pairs_per_job * 5) // bounded over-fetch

  if (error) {
    console.warn('[matchQueue] enqueueNewJob query failed:', error.message)
    return
  }

  // Create placeholder candidate IDs — the consumer will do the actual
  // evaluation. For now, we just need the resume IDs to process.
  const candidateIds: string[] = []
  for (const c of candidates ?? []) {
    candidateIds.push(`${c.student_id}:${jobId}:${c.id}`)
  }

  if (candidateIds.length === 0) return

  // Batch into groups of max_groq_batch_size for queue efficiency
  for (let i = 0; i < candidateIds.length; i += (config.max_groq_batch_size * 2)) {
    const slice = candidateIds.slice(i, i + config.max_groq_batch_size * 2)
    await enqueueUnique(slice, { trigger: 'new_job' }, { jobId }, env)
  }
}

/** Enqueue when a job is updated — marks existing pairs stale + re-queues. */
export async function enqueueJobUpdate(jobId: string, jobVersion: string, env?: any): Promise<void> {
  const config = await getConfig()
  if (!config.enabled) return

  // Mark all pair records for this job as stale
  await sb
    .from('match_candidates')
    .update({ stale_at: new Date().toISOString() })
    .eq('job_id', jobId)

  await enqueueNewJob(jobId, env)
}

/** Enqueue manual match — high priority, always for eligible pairs. */
export async function enqueueManualMatch(studentId: string, jobId: string, resumeId: string, env?: any): Promise<string> {
  const candidateId = `${studentId}:${jobId}:${resumeId}`
  return enqueueUnique([candidateId], {
    trigger: 'manual',
    priority: 100,
  }, { studentId, jobId, resumeId }, env)
}

/** Enqueue resume rebuild — re-evaluates all pairs for this resume. */
export async function enqueueResumeRebuild(studentId: string, resumeId: string, env?: any): Promise<void> {
  const config = await getConfig()
  if (!config.enabled) return

  // Mark all pair records for this resume as stale
  await sb
    .from('match_candidates')
    .update({ stale_at: new Date().toISOString() })
    .eq('resume_id', resumeId)

  await enqueueUnique(
    [`${studentId}:resume:${resumeId}`],
    { trigger: 'resume_updated', priority: 60 },
    { studentId, resumeId },
    env,
  )
}

/** Get queue status for a student — for the frontend status endpoint. */
export async function getQueueStatus(studentId: string): Promise<{
  queued: number
  processing: number
  completed: number
  failed: number
}> {
  const { data, error } = await sb
    .from('match_queue_jobs')
    .select('status')
    .eq('student_id', studentId)
    .neq('status', 'completed')
  if (error || !data) return { queued: 0, processing: 0, completed: 0, failed: 0 }
  const stats = { queued: 0, processing: 0, completed: 0, failed: 0 }
  for (const row of data as any[]) {
    if (row.status === 'queued') stats.queued++
    else if (row.status === 'processing') stats.processing++
    else if (row.status === 'completed') stats.completed++
    else if (row.status === 'failed') stats.failed++
  }
  return stats
}
