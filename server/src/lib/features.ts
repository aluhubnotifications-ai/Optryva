// Feature extraction for the learning-to-rank stage (roadmap Phase 2).
//
// The SAME function produces features offline (training set, scripts/build-features)
// and will produce them online (live ranking) — one source of truth, so there's no
// train/serve skew. Every feature is a plain number and null-safe, so a thin profile
// or a job without an embedding still yields a complete, finite row.
//
// This does NOT score anything; it just turns a (student, job) pair + the signals we
// already have (the LLM's score, the embedding cosine) into a numeric vector. The
// ranker that consumes it is trained separately once we have enough labels.

import type { Seniority } from '@/lib/resume'

// Stable, ordered feature names — the column order for any model we train/serve.
export const FEATURE_NAMES = [
  'pred_score', 'bd_skills', 'bd_experience', 'bd_location', 'bd_compensation',
  'cosine', 'skill_overlap', 'skill_overlap_count', 'n_job_tags',
  'seniority_gap', 'location_match', 'remote', 'is_internship', 'is_fulltime',
  'job_age_days', 'cv_present', 'total_years', 'desired_role_match',
] as const
export type FeatureName = (typeof FEATURE_NAMES)[number]

// The subset available BEFORE the LLM scores a job — so the learned ranker can
// decide which candidates are worth an LLM call. Deliberately excludes pred_score
// and the breakdown (those are LLM OUTPUTS; using them to pre-rank would be
// circular). A post-LLM blender could use the full set; the serving ranker uses
// only these.
export const PRELLM_FEATURES: FeatureName[] = [
  'cosine', 'skill_overlap', 'skill_overlap_count', 'n_job_tags',
  'seniority_gap', 'location_match', 'remote', 'is_internship', 'is_fulltime',
  'job_age_days', 'cv_present', 'total_years', 'desired_role_match',
]

export interface FeatureInput {
  predScore: number | null // the honest LLM score (0-99), our strongest single feature
  breakdown?: { skills?: number; experience?: number; location?: number; compensation?: number } | null
  cosine: number | null // student↔job embedding similarity (0-1)
  student: {
    skills: string[]
    seniority: Seniority | null
    totalYears: number
    country?: string | null
    cvLen: number
    desiredRoles: string[]
  }
  job: {
    tags: string[]
    listing_type: string
    country?: string | null
    remote: boolean
    createdAt?: string | null
    title: string
    type?: string | null
  }
}

const SENIORITY_RANK: Record<string, number> = { student: 0, entry: 1, junior: 2, mid: 3, senior: 4 }
const SENIOR_TITLE = /\b(senior|sr|staff|principal|director|chief|vp|head\s+of|architect)\b/i

const norm = (s: string) => s.toLowerCase().trim()

/** Rough seniority level a job implies (0 entry … 4 senior), from listing type +
 *  title markers. Internships/fellowships read as entry regardless of title. */
function jobImpliedLevel(job: FeatureInput['job']): number {
  if (job.listing_type === 'Internship' || job.listing_type === 'Fellowship') return 0
  if (SENIOR_TITLE.test(job.title ?? '')) return 4
  return 2 // a generic full/part-time role ≈ junior/mid
}

function ageDays(createdAt?: string | null): number {
  if (!createdAt) return 0
  const t = Date.parse(createdAt)
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.min(365, Math.round((Date.now() - t) / 86_400_000)))
}

/** Turn a (student, job) pair + known signals into the ranker's numeric feature
 *  vector. Pure and deterministic — same inputs, same row, offline or online. */
export function extractFeatures(i: FeatureInput): Record<FeatureName, number> {
  const tags = (i.job.tags ?? []).map(norm).filter(Boolean)
  const skills = new Set((i.student.skills ?? []).map(norm).filter(Boolean))
  const overlap = tags.filter((t) => skills.has(t)).length

  const sRank = i.student.seniority ? SENIORITY_RANK[i.student.seniority] ?? 1 : 1
  const jLevel = jobImpliedLevel(i.job)

  // Lenient: "Kigali, Rwanda" should match a job country of "Rwanda".
  const sc = i.student.country ? norm(i.student.country) : ''
  const jc = i.job.country ? norm(i.job.country) : ''
  const sameCountry = !!(sc && jc && (sc.includes(jc) || jc.includes(sc)))
  const locationMatch = i.job.remote || sameCountry ? 1 : 0

  // Does the role line up with a role the student said they want?
  const wants = (i.student.desiredRoles ?? []).map(norm)
  const jobType = norm(`${i.job.type ?? ''} ${i.job.title ?? ''}`)
  const desiredRoleMatch = wants.some((w) => w && jobType.includes(w)) ? 1 : 0

  return {
    pred_score: i.predScore ?? 0,
    bd_skills: i.breakdown?.skills ?? 0,
    bd_experience: i.breakdown?.experience ?? 0,
    bd_location: i.breakdown?.location ?? 0,
    bd_compensation: i.breakdown?.compensation ?? 0,
    cosine: i.cosine ?? 0,
    skill_overlap: tags.length ? overlap / tags.length : 0,
    skill_overlap_count: overlap,
    n_job_tags: tags.length,
    seniority_gap: jLevel - sRank, // >0 = role more senior than candidate (a stretch)
    location_match: locationMatch,
    remote: i.job.remote ? 1 : 0,
    is_internship: i.job.listing_type === 'Internship' ? 1 : 0,
    is_fulltime: i.job.listing_type === 'Full-time' ? 1 : 0,
    job_age_days: ageDays(i.job.createdAt),
    cv_present: i.student.cvLen > 0 ? 1 : 0,
    total_years: i.student.totalYears,
    desired_role_match: desiredRoleMatch,
  }
}

/** Feature vector as an ordered number[] (model input), aligned to FEATURE_NAMES. */
export function featureVector(f: Record<FeatureName, number>): number[] {
  return FEATURE_NAMES.map((n) => f[n])
}
