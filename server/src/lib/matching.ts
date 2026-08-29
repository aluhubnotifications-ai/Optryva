// ----------------------------------------------------------------------------
// Shared types for the free-first, cache-first matching engine.
//
// This module holds the shapes that the deterministic layer (matchPoints.ts),
// the engine (matchEngine.ts), the queue producer (matchQueue.ts), the Groq
// batch reviewer, and the queue consumer (matchConsumer.ts) all pass around.
// No scoring logic lives here — only type definitions.
// ----------------------------------------------------------------------------

import type { ResumeProfile } from '@/lib/resume'
export type { ResumeProfile } from '@/lib/resume'

// ---------------------------------------------------------------------------
// Core input shapes
// ---------------------------------------------------------------------------

export interface MatchStudent {
  id: string
  cv_text?: string | null
  skills?: string[]
  desired_roles?: string[]
  preferred_industries?: string[]
  work_type?: string | null
  location_pref?: string | null
  location?: string | null
  major?: string | null
  resume_profile?: ResumeProfile | null
  school?: string | null
  year?: number | null
  country?: string | null
}

export interface MatchJob {
  id: string
  title: string
  description: string
  type: string
  listing_type: string
  tags: string[]
  country: string
  remote: boolean
  pay?: string | null
  location?: string | null
  duration?: string | null
  responsibilities?: string[]
  qualifications?: string[]
  benefits?: string[]
  status?: string
  deadline?: string | null
  allowed_years?: number[]
  allowed_schools?: string[]
  students_only?: boolean
  company_id?: string
  created_at?: string
  version?: string
}

// Evidence items (portfolio links, projects, certificates, etc.) — normalized.
export interface PortfolioEvidence {
  id: string
  title: string
  description: string
  url: string | null
  links: string[]
  extracted_skills: string[]
  confirmed_skills: string[]
  status: 'self_reported' | 'student_approved' | 'verified' | 'supervisor_verified'
  ai_summary: string | null
}

// ---------------------------------------------------------------------------
// Deterministic filter types (matchPoints.ts output)
// ---------------------------------------------------------------------------

export interface EligibilityResult {
  passed: boolean
  reasons: string[]
}

export interface FilterBreakdown {
  required_skill_points: number
  preferred_skill_points: number
  semantic_similarity_points: number
  role_and_domain_points: number
  experience_points: number
  location_work_type_points: number
  preference_points: number
}

export interface FilterResult {
  total: number
  breakdown: FilterBreakdown
  matchedSkills: string[]
  missingSkills: string[]
  semanticSimilarity: number
  evidenceCompleteness: number
  versions: {
    job_version: string
    resume_version: string
    preference_version: string | null
    filter_version: string
  }
}

// ---------------------------------------------------------------------------
// Pair record — the persisted match_candidate row shape
// ---------------------------------------------------------------------------

export type EligibilityStatus = 'passed' | 'excluded'

export type AiStatus =
  | 'not_requested'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'stale'

export type ScoreState =
  | 'provisional'
  | 'queued'
  | 'processing'
  | 'ai_reviewed'
  | 'stale'
  | 'failed'
  | 'excluded'

export interface MatchCandidate {
  id: string
  student_id: string
  job_id: string
  resume_id: string

  job_version: string
  resume_version: string
  preference_version: string | null
  filter_version: string

  eligibility_status: EligibilityStatus
  exclusion_reasons: string[]

  filter_points: number
  point_breakdown: FilterBreakdown
  semantic_similarity: number | null
  matched_skills: string[]
  missing_skills: string[]
  evidence_completeness: number
  rank_position: number | null

  ai_status: AiStatus
  ai_score: number | null
  ai_quality: number | null
  ai_confidence: 'low' | 'medium' | 'high' | null
  ai_payload: unknown | null
  ai_model: string | null
  ai_prompt_version: string | null
  ai_scored_at: string | null
  ai_error: string | null

  created_at: string
  updated_at: string
  stale_at: string | null
}

// ---------------------------------------------------------------------------
// Final result returned to the client
// ---------------------------------------------------------------------------

export interface MatchResult {
  student_id: string
  job_id: string
  resume_id: string
  filter_points: number
  score: number
  score_state: ScoreState
  ai_status: AiStatus
  rank_position: number | null
  matched_skills: string[]
  missing_skills: string[]
  evidence_completeness: number
  ai_confidence: string | null
  ai_quality: number | null
  ai_model: string | null
  reasons: string[]
  updated_at: string
}

// ---------------------------------------------------------------------------
// Legacy AiMatch type — kept for backwards compatibility with existing
// Claude rubric scorer output shape.
// ---------------------------------------------------------------------------

export interface MatchBreakdown {
  skills: number
  experience: number
  location: number
  compensation: number
}

export interface AiMatch {
  student_id: string
  job_id: string
  score: number
  breakdown: MatchBreakdown
  matched_skills: string[]
  reasons: string[]
  mismatch_flags: string[]
  tip: string
  created_at: string
  resume_id?: string | null
}

// ---------------------------------------------------------------------------
// Queue message shape — passed through Cloudflare Queues
// ---------------------------------------------------------------------------

export interface QueueMessage {
  trigger: 'new_job' | 'job_updated' | 'resume_updated' | 'manual' | 'refresh' | 'rebuild'
  job_id: string | null
  student_id: string | null
  resume_id: string | null
  candidate_ids: string[]
  input_hash: string
  job_version: string
  filter_version: string
  prompt_version: string
  priority: number
}

// ---------------------------------------------------------------------------
// AI review input / output shapes
// ---------------------------------------------------------------------------

export type ConfidenceLevel = 'low' | 'medium' | 'high'
export type EvidenceStatus = 'proven' | 'partial' | 'unknown' | 'contradicted'

export interface AiEvidence {
  requirement: string
  status: EvidenceStatus
  proof: string
}

export interface AiReviewResult {
  pair_id: string
  ai_quality: number
  confidence: ConfidenceLevel
  evidence: AiEvidence[]
  skill_gaps: string[]
  reasons: string[]
  needs_human_review: boolean
}

export interface AiReviewBatch {
  results: AiReviewResult[]
}

// ---------------------------------------------------------------------------
// Matching config
// ---------------------------------------------------------------------------

export interface MatchingConfig {
  auto_score_threshold: number
  auto_score_top_k: number
  max_groq_batch_size: number
  max_auto_pairs_per_job: number
  filter_version: string
  prompt_version: string
  enabled: boolean
}

// ---------------------------------------------------------------------------
// Input to the deterministic filter
// ---------------------------------------------------------------------------

export interface MatchInput {
  student: MatchStudent
  job: MatchJob
  resumeProfile: ResumeProfile | null
  portfolioEvidence: PortfolioEvidence[]
  resumeSkills: string[]
  semanticSimilarity: number | null
  candidateJobs: { job_id: string; similarity: number | null }[]
}

// ---------------------------------------------------------------------------
// Groq batch match review input shape
// ---------------------------------------------------------------------------

export interface GroqMatchInput {
  pair_id: string
  student_id: string
  job_title: string
  job_description: string
  job_qualifications: string[]
  job_tags: string[]
  resume_skills: { name: string; level?: string; years?: number }[]
  resume_domains: string[]
  resume_roles: string[]
  resume_projects: { name: string; impact?: string; stack?: string[] }[]
  resume_summary: string
  total_years: number
  portfolio_evidence: { title: string; description: string; confirmed_skills: string[]; extracted_skills: string[]; status: string }[]
  matched_skills: string[]
  missing_skills: string[]
  filter_points: number
  rank_position: number | null
  semantic_similarity: number | null
  evidence_completeness: number
}
