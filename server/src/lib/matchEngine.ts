// ----------------------------------------------------------------------------
// Match engine — orchestration layer that ties together deterministic filtering,
// ranking, queue production, and AI result finalization.
//
// This module is the SINGLE engine for both student-to-job discovery and
// employer-to-student shortlisting. It uses:
//   - matchPoints.ts for deterministic eligibility + points (no AI)
//   - matchQueue.ts for durable queue production
//   - supabase for DB reads/writes
//
// It NEVER calls Groq directly from a normal request — only the queue
// consumer does that asynchronously.
// ----------------------------------------------------------------------------

import { sb, must, j } from '@/db'
import * as matchPoints from '@/lib/matchPoints'
import { calculateFilterPoints, shouldAutoScore, finalScore, buildMatchInput, checkHardEligibility } from '@/lib/matchPoints'
import {
  enqueueNewJob,
  enqueueJobUpdate,
  enqueueManualMatch,
  enqueueResumeRebuild,
  enqueueUnique,
  getConfig,
} from '@/lib/matchQueue'
import { semanticSimilarities, retrieveCandidateJobs, retrieveJobsByVector } from '@/lib/enrich'
import { jobVisibleTo, schoolGates, SchoolGate } from '@/lib/visibility'
import type {
  MatchCandidate,
  MatchJob,
  MatchStudent,
  MatchingConfig,
  PortfolioEvidence,
  QueueMessage,
  AiReviewResult,
  AiStatus,
  EligibilityStatus,
  FilterBreakdown,
} from '@/lib/matching'

// ---------------------------------------------------------------------------
// Version helpers
// ---------------------------------------------------------------------------

/**
 * Content version for a résumé profile — based on the CV text hash and
 * selected evidence IDs. Changes when the résumé or evidence changes.
 */
export function resumeVersion(rp: any): string {
  const cvHash = require('crypto').createHash('sha256').update(rp?.cv_text ?? '').digest('hex').slice(0, 8)
  const evidenceHash = require('crypto').createHash('sha256').update(JSON.stringify(rp?.selected_evidence_ids ?? [])).digest('hex').slice(0, 8)
  return `rp-${cvHash}-${evidenceHash}`
}

/**
 * Content version for a job — based on the job's mutable matching fields.
 */
export function jobVersion(job: any): string {
  const hashable = [
    job.title,
    job.description,
    job.type,
    job.listing_type,
    job.tags,
    job.country,
    job.remote,
    job.location,
    job.duration,
    job.deadline,
    job.qualifications,
    job.responsibilities,
    job.allowed_years,
    job.allowed_schools,
    job.students_only,
    job.status,
  ]
  return 'jv-' + require('crypto').createHash('sha256').update(JSON.stringify(hashable)).digest('hex').slice(0, 12)
}

/**
 * Content version for a student's preference profile — based on desired roles,
 * industries, work type, and skills.
 */
export function preferenceVersion(student: any): string {
  const hashable = [
    student.desired_roles,
    student.preferred_industries,
    student.work_type,
    student.location_pref,
    student.skills,
    student.school,
    student.year,
  ]
  return 'pv-' + require('crypto').createHash('sha256').update(JSON.stringify(hashable)).digest('hex').slice(0, 8)
}

// ---------------------------------------------------------------------------
// Student/job/resume loading
// ---------------------------------------------------------------------------

async function loadStudent(studentId: string): Promise<any> {
  return (await sb.from('profiles').select('*').eq('id', studentId).maybeSingle()).data as any
}

async function loadJob(jobId: string): Promise<any> {
  return (await sb.from('job_listings').select('*').eq('id', jobId).maybeSingle()).data as any
}

async function loadResume(resumeId: string): Promise<any> {
  return (await sb.from('resume_profiles').select('*').eq('id', resumeId).maybeSingle()).data as any
}

async function loadEvidence(studentId: string, selectedIds: string[]): Promise<any[]> {
  if (!selectedIds?.length) return []
  const { data } = await sb
    .from('evidence_items')
    .select('*')
    .eq('student_id', studentId)
    .in('id', selectedIds)
  return (data ?? []) as any[]
}

// ---------------------------------------------------------------------------
// Core evaluation functions
// ---------------------------------------------------------------------------

/**
 * Evaluate a single student-job-resume pair deterministically.
 * Computes eligibility, filter points, and persists the candidate row.
 * Does NOT call Groq.
 */
export async function evaluatePair(
  studentId: string,
  jobId: string,
  resumeId: string,
  trigger: string,
): Promise<MatchCandidate | null> {
  const config = await getConfig()
  if (!config.enabled) return null

  const [student, job, resume] = await Promise.all([
    loadStudent(studentId),
    loadJob(jobId),
    loadResume(resumeId),
  ])

  if (!student || !job || !resume) return null

  // Load evidence items selected for this resume
  const evidenceIds = j.parse(resume.selected_evidence_ids, [])
  const evidenceItems = await loadEvidence(studentId, evidenceIds)

  // Get semantic similarity (from embeddings or null)
  const simMap = await semanticSimilarities(studentId)
  const semSim = simMap.get(jobId) ?? null

  // Build the normalized input
  const input = buildMatchInput(job, student, resume, evidenceItems, semSim)

  // Check hard eligibility — reuse visibility module
  const viewerSchoolDomains: string[] = []
  // Get school domains for the viewer
  const gates = await schoolGates([job.company_id ?? student.id])
  // viewerSchoolDomains would come from the viewer's school context
  // For students evaluating jobs, the "viewer" is the student themselves
  const eligibility = checkHardEligibility({
    job: input.job,
    student: input.student,
    rp: input.resumeProfile,
    viewerSchoolDomains,
    viewerEmail: student.email ?? '',
    viewerUserType: 'student',
  })

  const jv = jobVersion(job)
  const rv = resumeVersion(resume)
  const pv = preferenceVersion(student)

  // Calculate deterministic filter points (only if eligible)
  let points: matchPoints.PointsResult | null = null
  if (eligibility.passed) {
    points = calculateFilterPoints({
      job: input.job,
      student: input.student,
      resumeProfile: input.resumeProfile,
      portfolioEvidence: input.portfolioEvidence,
      resumeSkills: input.resumeSkills,
      semanticSimilarity: semSim,
    })
  }

  // Determine rank position — we need to know how this job ranks for this resume
  // We fetch existing ranked candidates to compute the rank
  const rankPosition = await computeRank(jobId, resumeId, points?.total ?? 0, config)

  // Build the candidate row — use plain object for Supabase upsert
  // (DB stores JSONB; the MatchCandidate type has typed arrays that we
  //  stringify before persisting).
  const candidateRow: any = {
    id: `${studentId}:${jobId}:${resumeId}`,
    student_id: studentId,
    job_id: jobId,
    resume_id: resumeId,
    job_version: jv,
    resume_version: rv,
    preference_version: pv,
    filter_version: config.filter_version,
    eligibility_status: eligibility.passed ? 'passed' : 'excluded',
    exclusion_reasons: JSON.stringify(eligibility.reasons),
    filter_points: points?.total ?? 0,
    point_breakdown: JSON.stringify(points?.breakdown ?? {}),
    semantic_similarity: points?.semanticSimilarity ?? null,
    matched_skills: JSON.stringify(points?.matchedSkills ?? []),
    missing_skills: JSON.stringify(points?.missingSkills ?? []),
    evidence_completeness: points?.evidenceCompleteness ?? 0,
    rank_position: rankPosition,
    ai_status: 'not_requested',
    stale_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  // Upsert the candidate row
  const candidateId = `${studentId}:${jobId}:${resumeId}`
  await sb.from('match_candidates').upsert(candidateRow).select()

  // Decide if this pair should get AI scoring
  const shouldQueue = eligibility.passed && shouldAutoScore({
    candidate: candidateRow as MatchCandidate,
    jobStatus: job.status ?? 'active',
    config,
  })

  if (shouldQueue) {
    await _enqueueForAi([candidateId], {
      trigger: trigger as any,
      priority: trigger === 'manual' ? 100 : 50,
    }, { studentId, jobId, resumeId })
  }

  return candidateRow as MatchCandidate
}

/** Compute the rank position of a job within a résumé's ranking. */
async function computeRank(jobId: string, resumeId: string, points: number, config: MatchingConfig): Promise<number | null> {
  const { data } = await sb
    .from('match_candidates')
    .select('job_id')
    .eq('resume_id', resumeId)
    .eq('eligibility_status', 'passed')
    .gt('filter_points', points)
    .order('filter_points', { ascending: false })
    .limit(1)

  // rank = number of jobs with higher points + 1
  const higherCount = (data?.length ?? 0)
  return higherCount + 1
}

/** Internal: enqueue candidate IDs for AI review. */
async function _enqueueForAi(
  candidateIds: string[],
  options: { trigger: string; priority?: number },
  context: { studentId?: string; jobId?: string; resumeId?: string },
): Promise<string | null> {
  return enqueueUnique(candidateIds, {
    trigger: options.trigger as any,
    priority: options.priority ?? 50,
  }, context, undefined as any)
}

// ---------------------------------------------------------------------------
// Job-level evaluation (new job published or updated)
// ---------------------------------------------------------------------------

/**
 * Evaluate a job against all plausible active résumés.
 * Called after a job is published or updated.
 * Returns the list of created/updated candidate IDs.
 */
export async function evaluateJobForResumes(
  jobId: string,
  trigger: 'new_job' | 'job_updated',
): Promise<string[]> {
  const config = await getConfig()
  if (!config.enabled) return []

  const job = await loadJob(jobId)
  if (!job) return []

  // Don't trigger matching for drafts, closed, or expired jobs
  if (job.status !== 'active') return []
  if (isPast(job.deadline)) return []

  // Find plausible candidate résumés using the existing retrieval pipeline.
  // We use retrieveJobsByVector in reverse — actually we need to find students
  // whose embeddings are similar to the job. But the existing API is
  // job-centric (retrieve candidate jobs for a student). For the job side,
  // we scan active résumés with embeddings.
  const candidateIds: string[] = []
  let evaluated = 0

  // Get all active résumés (bounded by config)
  const { data: resumes, error } = await sb
    .from('resume_profiles')
    .select('id, student_id, target_roles, skills')
    .eq('active', 1)
    .limit(config.max_auto_pairs_per_job * 10) // over-fetch, filter in eval

  if (error || !resumes) {
    console.warn('[matchEngine] evaluateJobForResumes query failed:', error?.message)
    return []
  }

  for (const resume of resumes) {
    if (evaluated >= config.max_auto_pairs_per_job * 2) break

    const student = await loadStudent(resume.student_id)
    if (!student) continue

    // Visibility check: can this student see this job?
    const gates = await schoolGates([job.company_id ?? student.id])
    // For job-side evaluation, we check if the student is a member of any
    // school that the job is restricted to
    const viewer: any = { ...student, email: student.email }
    if (!jobVisibleTo(job, viewer, gates)) continue

    // Evaluate the pair
    const candidate = await evaluatePair(resume.student_id, jobId, resume.id, trigger)
    if (candidate) {
      candidateIds.push(candidate.id)
      evaluated++
    }
  }

  // Re-rank after all pairs are evaluated
  await rerankForResumeBatch(resumes.map(r => r.id))

  return candidateIds
}

// ---------------------------------------------------------------------------
// Resume-level evaluation (student updated their résumé)
// ---------------------------------------------------------------------------

/**
 * Re-evaluate a résumé against all active visible jobs.
 * Called after a résumé update.
 */
export async function evaluateResumeForJobs(
  studentId: string,
  resumeId: string,
  trigger: 'resume_updated',
): Promise<string[]> {
  const config = await getConfig()
  if (!config.enabled) return []

  const student = await loadStudent(studentId)
  if (!student) return []

  const { data: jobs, error } = await sb
    .from('job_listings')
    .select('*')
    .eq('status', 'active')
    .limit(300)

  if (error || !jobs) return []

  const candidateIds: string[] = []
  const gates = await schoolGates(jobs.map(j => j.company_id).filter(Boolean))

  for (const job of jobs) {
    const viewer = { ...student, email: student.email } as any
    if (!jobVisibleTo(job, viewer, gates)) {
      // Still save the excluded pair for traceability
      const candidateId = `${studentId}:${job.id}:${resumeId}`
      await saveExcludedPair(studentId, job.id, resumeId, ['school_not_allowed'])
      continue
    }

    const candidate = await evaluatePair(studentId, job.id, resumeId, trigger)
    if (candidate) candidateIds.push(candidate.id)
  }

  await rerankForResume(resumeId)

  return candidateIds
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/** Re-rank all pairs for a résumé by filter_points descending. */
export async function rerankForResume(resumeId: string): Promise<void> {
  const { data: rows } = await sb
    .from('match_candidates')
    .select('id, job_id, filter_points, eligibility_status')
    .eq('resume_id', resumeId)
    .eq('eligibility_status', 'passed')
    .order('filter_points', { ascending: false })

  if (!rows) return

  // Update rank_position in a batch
  const updates = rows.map((row, i) => ({
    id: row.id,
    rank_position: i + 1,
  }))

  for (const u of updates) {
    await sb.from('match_candidates').update({ rank_position: u.rank_position }).eq('id', u.id)
  }
}

async function rerankForResumeBatch(resumeIds: string[]): Promise<void> {
  for (const rid of resumeIds) {
    await rerankForResume(rid)
  }
}

/** Re-rank all pairs for a job by filter_points descending. */
export async function rerankForJob(jobId: string): Promise<void> {
  const { data: rows } = await sb
    .from('match_candidates')
    .select('id, student_id, resume_id, filter_points, eligibility_status')
    .eq('job_id', jobId)
    .eq('eligibility_status', 'passed')
    .order('filter_points', { ascending: false })

  if (!rows) return

  const byResume = new Map<string, typeof rows>()
  for (const row of rows) {
    const arr = byResume.get(row.resume_id) ?? []
    arr.push(row)
    byResume.set(row.resume_id, arr)
  }

  for (const [resumeId, resumeRows] of byResume) {
    for (let i = 0; i < resumeRows.length; i++) {
      await sb.from('match_candidates').update({ rank_position: i + 1 }).eq('id', resumeRows[i].id)
    }
  }
}

// ---------------------------------------------------------------------------
// Excluded pair persistence
// ---------------------------------------------------------------------------

async function saveExcludedPair(
  studentId: string,
  jobId: string,
  resumeId: string,
  reasons: string[],
  jobVersion?: string,
  resumeVersion?: string,
): Promise<void> {
  const config = await getConfig()
  const candidateId = `${studentId}:${jobId}:${resumeId}`
  await sb.from('match_candidates').upsert({
    id: candidateId,
    student_id: studentId,
    job_id: jobId,
    resume_id: resumeId,
    job_version: jobVersion ?? '',
    resume_version: resumeVersion ?? '',
    preference_version: null,
    filter_version: config.filter_version,
    eligibility_status: 'excluded',
    exclusion_reasons: JSON.stringify(reasons),
    filter_points: 0,
    point_breakdown: JSON.stringify({}),
    matched_skills: JSON.stringify([]),
    missing_skills: JSON.stringify([]),
    evidence_completeness: 0,
    rank_position: null,
    ai_status: 'not_requested',
  })
}

// ---------------------------------------------------------------------------
// Manual match — bypasses auto threshold but respects hard eligibility
// ---------------------------------------------------------------------------

/**
 * Handle a manual "Match this job" request.
 * Always uses saved filter points as context.
 * Triggers AI review if no current result exists.
 */
export async function requestManualMatch(
  studentId: string,
  jobId: string,
  resumeId: string,
  options: { refresh?: boolean } = {},
): Promise<{ state: string; pair?: any; reason?: string }> {
  const config = await getConfig()
  if (!config.enabled) return { state: 'disabled' }

  // Load or recalculate the pair
  const pair = await loadOrRecalculatePair(studentId, jobId, resumeId)

  if (!pair) {
    return { state: 'error', reason: 'pair_not_found' }
  }

  // Hard eligibility check — never bypass this
  if (pair.eligibility_status !== 'passed') {
    return {
      state: 'excluded',
      reason: 'eligibility_failed',
    }
  }

  // If a current AI result exists and not refreshing, return it
  if (!options.refresh && isCurrentAiResult(pair)) {
    return { state: 'ai_reviewed', pair }
  }

  // Otherwise enqueue a high-priority manual review
  await enqueueManualMatch(studentId, jobId, resumeId, undefined as any)

  return { state: 'queued', pair }
}

/**
 * Load an existing pair or recalculate it if stale/missing.
 */
export async function loadOrRecalculatePair(
  studentId: string,
  jobId: string,
  resumeId: string,
): Promise<MatchCandidate | null> {
  const candidateId = `${studentId}:${jobId}:${resumeId}`

  // Try to load existing
  const { data: existing } = await sb
    .from('match_candidates')
    .select('*')
    .eq('id', candidateId)
    .maybeSingle()

  // Check if stale (versions changed)
  const job = await loadJob(jobId)
  const resume = await loadResume(resumeId)
  const student = await loadStudent(studentId)

  if (!job || !resume || !student) return null

  const currentJobV = jobVersion(job)
  const currentResumeV = resumeVersion(resume)

  if (existing && existing.job_version === currentJobV && existing.resume_version === currentResumeV) {
    // Versions match — return the saved pair
    return parseCandidate(existing)
  }

  // Recalculate
  const candidate = await evaluatePair(studentId, jobId, resumeId, 'manual')
  return candidate
}

function parseCandidate(row: any): MatchCandidate {
  return {
    id: row.id,
    student_id: row.student_id,
    job_id: row.job_id,
    resume_id: row.resume_id,
    job_version: row.job_version,
    resume_version: row.resume_version,
    preference_version: row.preference_version,
    filter_version: row.filter_version,
    eligibility_status: row.eligibility_status as EligibilityStatus,
    exclusion_reasons: j.parse(row.exclusion_reasons, []),
    filter_points: row.filter_points,
    point_breakdown: j.parse<FilterBreakdown>(row.point_breakdown, {
      required_skill_points: 0,
      preferred_skill_points: 0,
      semantic_similarity_points: 0,
      role_and_domain_points: 0,
      experience_points: 0,
      location_work_type_points: 0,
      preference_points: 0,
    }),
    semantic_similarity: row.semantic_similarity,
    matched_skills: j.parse(row.matched_skills, []),
    missing_skills: j.parse(row.missing_skills, []),
    evidence_completeness: row.evidence_completeness,
    rank_position: row.rank_position,
    ai_status: row.ai_status as AiStatus,
    ai_score: row.ai_score,
    ai_quality: row.ai_quality,
    ai_confidence: row.ai_confidence,
    ai_payload: row.ai_payload,
    ai_model: row.ai_model,
    ai_prompt_version: row.ai_prompt_version,
    ai_scored_at: row.ai_scored_at,
    ai_error: row.ai_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
    stale_at: row.stale_at,
  }
}

// ---------------------------------------------------------------------------
// AI result finalization (called by queue consumer)
// ---------------------------------------------------------------------------

/**
 * Persist AI review results and compute the final score.
 */
export async function finalizeAiResult(
  pairId: string,
  aiResult: {
    ai_quality: number
    confidence: 'low' | 'medium' | 'high'
    evidence: unknown
    skill_gaps: string[]
    reasons: string[]
    needs_human_review: boolean
  },
  model: string,
  promptVersion: string,
  evidenceCompleteness: number,
): Promise<void> {
  const { data: pair } = await sb.from('match_candidates').select('*').eq('id', pairId).maybeSingle()
  if (!pair) return

  const filterPoints = pair.filter_points
  const { score } = finalScore({
    filterPoints,
    aiQuality: aiResult.ai_quality,
    evidenceCompleteness: evidenceCompleteness ?? 0.5,
    aiConfidence: aiResult.confidence,
    aiStatus: 'completed',
  })

  await sb.from('match_candidates').update({
    ai_status: 'completed',
    ai_score: score,
    ai_quality: aiResult.ai_quality,
    ai_confidence: aiResult.confidence,
    ai_payload: JSON.stringify(aiResult),
    ai_model: model,
    ai_prompt_version: promptVersion,
    ai_scored_at: new Date().toISOString(),
    stale_at: null,
  }).eq('id', pairId)
}

/**
 * Mark a pair as failed (AI review failed, but provisional points remain).
 */
export async function markAiFailed(pairId: string, error: string): Promise<void> {
  await sb.from('match_candidates').update({
    ai_status: 'failed',
    ai_error: error,
    ai_scored_at: new Date().toISOString(),
  }).eq('id', pairId)
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function isPast(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr)
  return d < new Date()
}

function isCurrentAiResult(pair: MatchCandidate): boolean {
  if (pair.ai_status !== 'completed') return false
  // Check version freshness
  if (pair.stale_at) return false
  // If the pair was scored before the job/resume versions were set, it's stale
  if (!pair.ai_scored_at) return false
  return true
}

// Re-export for consumers
export { enqueueNewJob, enqueueJobUpdate, enqueueManualMatch, enqueueResumeRebuild, getConfig }
