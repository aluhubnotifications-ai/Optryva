// ----------------------------------------------------------------------------
// Queue consumer — processes match evaluation queue messages asynchronously.
//
// For each queue message:
//   1. Claim the match_queue_jobs row idempotently
//   2. Load pair IDs and verify job/résumé/profile versions
//   3. Re-check hard visibility and eligibility before AI use
//   4. Group compatible pairs into a bounded Groq request
//   5. Mark pairs processing
//   6. Call groqBatchMatchReview
//   7. Validate every returned pair_id belongs to the request
//   8. Calculate final scores in matchPoints.ts (NOT in Groq)
//   9. Upsert AI fields and mark pairs completed
//  10. Mark queue job complete only when all pairs are handled
//
// Safe if the same message is delivered more than once — version checks and
// idempotent upserts prevent duplicate work.
// ----------------------------------------------------------------------------

import { sb, must, j } from '@/db'
import { groqBatchMatchReview, groqMatchModel, groqMatchPromptVersion, groqRateLimited } from '@/lib/groq'
import { calculateFilterPoints, checkHardEligibility, buildMatchInput } from '@/lib/matchPoints'
import { jobVersion, resumeVersion, finalizeAiResult, markAiFailed } from '@/lib/matchEngine'
import { getConfig } from '@/lib/matchQueue'
import type { QueueMessage, AiReviewResult, MatchingConfig, GroqMatchInput } from '@/lib/matching'
import { loadStudentSync, loadJobSync, loadResumeSync, loadEvidenceSync } from './sync'

/** Maximum retry attempts before marking a queue job as failed. */
const MAX_ATTEMPTS = 5

/** Backoff in seconds for retryable failures. */
function backoff(attempts: number): number {
  return Math.min(Math.pow(2, attempts) * 5, 600)
}

/**
 * Cloudflare Queue consumer entry point.
 * `batch` is the array of messages, `env` provides the Worker environment
 * (for secrets, queue bindings, etc.), `ctx` provides waitUntil.
 */
export async function consumeMatchBatch(
  batch: { message: any; ack: () => void; retry: (opts?: { visibilityDelay?: number }) => void }[],
  env: any,
  ctx?: any,
): Promise<void> {
  const config = await getConfig()
  if (!config.enabled) {
    // If disabled, ack all messages and return
    for (const msg of batch) msg.ack()
    return
  }

  for (const msg of batch) {
    const payload: QueueMessage = msg.message

    try {
      await processMessage(payload, config, env, ctx)
      msg.ack()
    } catch (e: any) {
      console.error('[matchConsumer] error processing message:', {
        error: e?.message,
        trigger: payload.trigger,
        job_id: payload.job_id,
        student_id: payload.student_id,
      })

      // Update attempt count and error
      const { data: qj } = await sb
        .from('match_queue_jobs')
        .select('attempts')
        .eq('input_hash', payload.input_hash)
        .maybeSingle()

      const attempts = (qj?.attempts ?? 0) + 1
      await sb
        .from('match_queue_jobs')
        .update({
          status: 'queued',
          attempts,
          last_error: e?.message?.slice(0, 500),
          available_at: new Date(Date.now() + backoff(attempts) * 1000).toISOString(),
          locked_at: null,
        })
        .eq('input_hash', payload.input_hash)

      if (attempts >= MAX_ATTEMPTS) {
        await sb
          .from('match_queue_jobs')
          .update({ status: 'failed' })
          .eq('input_hash', payload.input_hash)
        msg.retry({ visibilityDelay: backoff(attempts) })
      } else {
        msg.retry({ visibilityDelay: backoff(attempts) })
      }
    }
  }
}

/**
 * Process a single queue message end-to-end.
 */
async function processMessage(
  payload: QueueMessage,
  config: MatchingConfig,
  env: any,
  ctx?: any,
): Promise<void> {
  // 1. Claim the queue row idempotently
  const { data: qj } = await sb
    .from('match_queue_jobs')
    .select('id, status, attempts, candidate_ids')
    .eq('input_hash', payload.input_hash)
    .is('locked_at', null) // not already being processed
    .maybeSingle()

  if (qj) {
    // Claim it
    await sb
      .from('match_queue_jobs')
      .update({
        status: 'processing',
        locked_at: new Date().toISOString(),
      })
      .eq('input_hash', payload.input_hash)
  } else {
    // Already claimed by another consumer — or row doesn't exist yet.
    // Check if already completed
    const { data: existing } = await sb
      .from('match_queue_jobs')
      .select('status')
      .eq('input_hash', payload.input_hash)
      .maybeSingle()
    if (existing?.status === 'completed' || existing?.status === 'failed') {
      return // Already done — idempotent no-op
    }
    // If still queued/processing by another, skip (will be retried)
    return
  }

  const candidateIds: string[] = j.parse(qj.candidate_ids, [])

  // Special trigger: resume_updated means we need to rebuild all pairs for this resume
  let actualCandidateIds = candidateIds
  if (payload.trigger === 'resume_updated' && candidateIds.length === 1 && candidateIds[0].includes(':resume:')) {
    // Expand to all actual pair IDs for this resume
    const resumeId = candidateIds[0].split(':')[2]
    const { data: pairs } = await sb
      .from('match_candidates')
      .select('id')
      .eq('resume_id', resumeId)
    actualCandidateIds = (pairs ?? []).map((p: any) => p.id)
  }

  // 2. Load each candidate and verify versions
  const groqInputs: GroqMatchInput[] = []
  const validPairIds: string[] = []

  for (const candidateId of actualCandidateIds) {
    const parts = candidateId.split(':')
    if (parts.length !== 3) continue
    const [studentId, jobId, resumeId] = parts

    // Load the candidate row
    const { data: candidate } = await sb
      .from('match_candidates')
      .select('*')
      .eq('id', candidateId)
      .maybeSingle()

    if (!candidate) continue

    // Version check — if the job/resume/profile has changed since the pair
    // was evaluated, discard this result as stale
    const job = await loadJobSync(jobId)
    const resume = await loadResumeSync(resumeId)
    if (!job || !resume) continue

    const currentJobV = jobVersion(job)
    const currentResumeV = resumeVersion(resume)

    if (candidate.job_version !== currentJobV || candidate.resume_version !== currentResumeV) {
      // Versions changed — mark as stale and skip (will be re-queued)
      await sb
        .from('match_candidates')
        .update({ stale_at: new Date().toISOString(), ai_status: 'stale' })
        .eq('id', candidateId)

      // Re-enqueue the updated version
      const student = await loadStudentSync(studentId)
      if (student) {
        const eligibilityInput = buildEligibilityInput(job, student, resume)
        await evaluateAndRequeue(studentId, jobId, resumeId, eligibilityInput, config, env, ctx)
      }
      continue
    }

    // 3. Re-check hard eligibility
    if (candidate.eligibility_status !== 'passed') continue

    // 4. Build the Groq input — only authorized, normalized evidence
    const student = await loadStudentSync(studentId)
    if (!student) continue

    const evidenceIds = j.parse(resume.selected_evidence_ids, [])
    const evidenceItems = await loadEvidenceSync(studentId, evidenceIds)
    const resumeProfile = resume.resume_profile
      ? (typeof resume.resume_profile === 'string' ? JSON.parse(resume.resume_profile) : resume.resume_profile)
      : null

    // Get semantic similarity
    const { semanticSimilarities } = await import('@/lib/enrich')
    const simMap = await semanticSimilarities(studentId)
    const semSim = simMap.get(jobId) ?? null

    // Recalculate filter points to ensure we have fresh data
    const input = buildMatchInput(job, student, resume, evidenceItems, semSim)
    const eligibilityInput = buildEligibilityInput(input.job, input.student, resume)

    // Only skip if eligibility failed (shouldn't happen since we checked candidate)
    const eligibility = checkHardEligibility(eligibilityInput)
    if (!eligibility.passed) {
      await sb
        .from('match_candidates')
        .update({
          eligibility_status: 'excluded',
          exclusion_reasons: JSON.stringify(eligibility.reasons),
          ai_status: 'not_requested',
        })
        .eq('id', candidateId)
      continue
    }

    const points = calculateFilterPoints({
      job: input.job,
      student: input.student,
      resumeProfile: input.resumeProfile,
      portfolioEvidence: input.portfolioEvidence,
      resumeSkills: input.resumeSkills,
      semanticSimilarity: semSim,
    })

    // Build the Groq input
    groqInputs.push({
      pair_id: candidateId,
      student_id: studentId,
      job_title: input.job.title,
      job_description: input.job.description,
      job_qualifications: input.job.qualifications ?? [],
      job_tags: input.job.tags,
      resume_skills: (input.resumeProfile?.skills ?? []).map((s: any) =>
        typeof s === 'object' ? { name: s.name, level: s.level, years: s.years } : { name: s }
      ),
      resume_domains: input.resumeProfile?.domains ?? [],
      resume_roles: input.resumeProfile?.roles ?? [],
      resume_projects: input.resumeProfile?.projects ?? [],
      resume_summary: input.resumeProfile?.summary ?? '',
      total_years: input.resumeProfile?.total_years ?? 0,
      portfolio_evidence: input.portfolioEvidence.map((e) => ({
        title: e.title,
        description: e.description,
        confirmed_skills: e.confirmed_skills,
        extracted_skills: e.extracted_skills,
        status: e.status,
      })),
      matched_skills: points.matchedSkills,
      missing_skills: points.missingSkills,
      filter_points: points.total,
      rank_position: candidate.rank_position ?? null,
      semantic_similarity: semSim,
      evidence_completeness: points.evidenceCompleteness,
    })
    validPairIds.push(candidateId)
  }

  if (validPairIds.length === 0) {
    // Nothing to do — mark queue job complete
    await markQueueComplete(payload.input_hash)
    return
  }

  // Check rate limits
  if (groqRateLimited()) {
    // Delay and retry
    const retryAt = new Date(Date.now() + 30000).toISOString()
    await sb
      .from('match_queue_jobs')
      .update({
        status: 'queued',
        available_at: retryAt,
        locked_at: null,
      })
      .eq('input_hash', payload.input_hash)
    return
  }

  // 5. Mark pairs as processing
  await sb
    .from('match_candidates')
    .update({ ai_status: 'processing' })
    .in('id', validPairIds)

  // 6. Split into batches and call Groq
  const batchSize = Math.min(config.max_groq_batch_size, 8) // also bound by token limits
  const allResults: AiReviewResult[] = []

  for (let i = 0; i < groqInputs.length; i += batchSize) {
    const batch = groqInputs.slice(i, i + batchSize)
    const result = await groqBatchMatchReview(batch)

    if ('error' in result) {
      await handleGroqError(result.error, validPairIds, payload.input_hash)
      return
    }

    // 7. Validate — every returned pair_id must be in the request
    const requestedIds = new Set(batch.map((b) => b.pair_id))
    const returnedIds = new Set(result.results.map((r) => r.pair_id))
    if (![...returnedIds].every((id) => requestedIds.has(id))) {
      // Invalid output — some pair IDs don't match
      await handleGroqError({ type: 'invalid_output' }, validPairIds, payload.input_hash)
      return
    }

    allResults.push(...result.results)
  }

  // 8. Calculate final scores and persist
  for (const res of allResults) {
    const parts = res.pair_id.split(':')
    if (parts.length !== 3) continue
    const [studentId, jobId, resumeId] = parts

    // Re-load the candidate to get fresh filter_points and evidence_completeness
    const { data: candidate } = await sb
      .from('match_candidates')
      .select('filter_points, evidence_completeness')
      .eq('id', res.pair_id)
      .maybeSingle()

    if (!candidate) continue

    const evidenceCompleteness = candidate.evidence_completeness ?? 0

    // Verify versions haven't changed while we were processing
    const job = await loadJobSync(jobId)
    const resume = await loadResumeSync(resumeId)
    const currentJobV = jobVersion(job)
    const currentResumeV = resumeVersion(resume)

    const { data: pairCheck } = await sb
      .from('match_candidates')
      .select('job_version, resume_version')
      .eq('id', res.pair_id)
      .maybeSingle()

    if (pairCheck?.job_version !== currentJobV || pairCheck?.resume_version !== currentResumeV) {
      // Version changed during processing — discard as stale
      await sb
        .from('match_candidates')
        .update({ stale_at: new Date().toISOString(), ai_status: 'stale' })
        .eq('id', res.pair_id)
      continue
    }

    // 9. Save AI result and final score
    await finalizeAiResult(
      res.pair_id,
      {
        ai_quality: res.ai_quality,
        confidence: res.confidence,
        evidence: res.evidence,
        skill_gaps: res.skill_gaps,
        reasons: res.reasons,
        needs_human_review: res.needs_human_review,
      },
      groqMatchModel(),
      groqMatchPromptVersion(),
      evidenceCompleteness,
    )
  }

  // 10. Mark queue job complete
  await markQueueComplete(payload.input_hash)
}

function buildEligibilityInput(job: any, student: any, resume: any): any {
  return {
    job: {
      id: job.id,
      title: job.title,
      description: job.description ?? '',
      type: job.type,
      listing_type: job.listing_type,
      tags: j.parse(job.tags, []),
      country: job.country,
      remote: Boolean(job.remote),
      location: job.location,
      status: job.status,
      deadline: job.deadline,
      allowed_years: j.parse(job.allowed_years, []),
      allowed_schools: j.parse(job.allowed_schools, []),
      students_only: Boolean(job.students_only),
      qualifications: j.parse(job.qualifications, []),
    },
    student: {
      id: student.id,
      skills: j.parse(student.skills, []),
      desired_roles: j.parse(student.desired_roles ?? student.desired_roles, []),
      preferred_industries: j.parse(student.preferred_industries ?? student.preferred_industries, []),
      work_type: student.work_type,
      location_pref: student.location_pref,
      location: student.location,
      school: student.school,
      year: student.year,
    },
    rp: resume.resume_profile
      ? (typeof resume.resume_profile === 'string' ? JSON.parse(resume.resume_profile) : resume.resume_profile)
      : null,
    viewerSchoolDomains: [],
    viewerEmail: student.email ?? '',
    viewerUserType: 'student',
  }
}

async function handleGroqError(
  error: { type: string; retryAfter?: number },
  pairIds: string[],
  inputHash: string,
): Promise<void> {
  if (error.type === 'rate_limited') {
    // Delay the queue job
    const delay = Math.min(error.retryAfter ?? 30, 300)
    await sb
      .from('match_queue_jobs')
      .update({
        status: 'queued',
        available_at: new Date(Date.now() + delay * 1000).toISOString(),
        locked_at: null,
      })
      .eq('input_hash', inputHash)
    return
  }

  if (error.type === 'invalid_output') {
    // Mark pairs as failed but preserve provisional points
    await sb
      .from('match_candidates')
      .update({ ai_status: 'failed', ai_error: 'invalid_output' })
      .in('id', pairIds)
    await markQueueComplete(inputHash, 'failed')
    return
  }

  // Transient errors — retry with backoff
  await sb
    .from('match_queue_jobs')
    .update({
      status: 'queued',
      attempts: sb.rpc('increment_attempts', { hash: inputHash }),
      last_error: error.type,
      available_at: new Date(Date.now() + backoff(1) * 1000).toISOString(),
      locked_at: null,
    })
    .eq('input_hash', inputHash)
}

async function markQueueComplete(inputHash: string, status: 'completed' | 'failed' = 'completed'): Promise<void> {
  await sb
    .from('match_queue_jobs')
    .update({
      status,
      completed_at: new Date().toISOString(),
      locked_at: null,
    })
    .eq('input_hash', inputHash)
}

async function evaluateAndRequeue(
  studentId: string,
  jobId: string,
  resumeId: string,
  _eligibilityInput: any,
  config: MatchingConfig,
  env: any,
  ctx?: any,
): Promise<void> {
  // Re-evaluate the pair and re-queue if eligible
  const { evaluatePair } = await import('@/lib/matchEngine')
  const candidate = await evaluatePair(studentId, jobId, resumeId, 'job_updated')
  if (candidate && candidate.eligibility_status === 'passed') {
    await enqueueUnique([candidate.id], {
      trigger: 'job_updated',
      priority: 50,
    }, { studentId, jobId, resumeId }, env)
  }
}

// Import at bottom to avoid circular dependency
import { enqueueUnique } from '@/lib/matchQueue'
