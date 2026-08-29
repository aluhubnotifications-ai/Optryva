// ----------------------------------------------------------------------------
// Deterministic filter + points — the honest, reproducible backbone of the
// matching engine. This module contains NO external AI calls (no Groq, no
// Claude, no Mistral). It computes hard eligibility, filter points, and the
// final score from deterministic inputs only.
//
// Groq is used for evidence interpretation / ambiguity resolution / confidence,
// but it cannot control the final score formula or bypass hard filters.
// ----------------------------------------------------------------------------

import type {
  MatchJob,
  MatchStudent,
  FilterResult,
  EligibilityResult,
  MatchCandidate,
  MatchingConfig,
  PortfolioEvidence,
} from '@/lib/matching'
import type { ResumeProfile, ResumeSkill } from '@/lib/resume'

// Skill alias normalization: different spellings of the same skill collapse
// to a canonical name so "React", "React.js", and "ReactJS" all match.
const SKILL_ALIASES: Record<string, string[]> = {
  react: ['react', 'react.js', 'reactjs', 'react js', 'react.js'],
  'node.js': ['node.js', 'nodejs', 'node js', 'node'],
  typescript: ['typescript', 'ts'],
  javascript: ['javascript', 'js', 'javascript/js'],
  python: ['python', 'python3', 'python 3'],
  sql: ['sql', 'postgres', 'postgresql', 'psql'],
  'c++': ['c++', 'cpp', 'c plus plus'],
  'c#': ['c#', 'csharp', 'c sharp'],
  'aws': ['aws', 'amazon web services'],
  'gcp': ['gcp', 'google cloud', 'google cloud platform'],
  docker: ['docker', 'docker compose'],
  'ci/cd': ['ci/cd', 'cicd', 'continuous integration', 'continuous deployment'],
  'ml': ['ml', 'machine learning', 'machine-learning'],
  figma: ['figma', 'ui design', 'design'],
  git: ['git', 'github', 'gitlab', 'version control'],
}

export function canonicalizeSkill(skill: string): string {
  const lower = skill.trim().toLowerCase()
  for (const [canonical, aliases] of Object.entries(SKILL_ALIASES)) {
    if (aliases.includes(lower)) return canonical
  }
  return lower
}

// Extract skills from a résumé profile (ResumeSkill[] with names).
function skillsFromResume(rp: ResumeProfile | null): string[] {
  if (!rp) return []
  return (rp.skills ?? []).map((s) => (typeof s === 'object' ? s.name : s))
}

// Extract skills from portfolio evidence (confirmed + extracted).
function skillsFromEvidence(evidence: PortfolioEvidence[]): string[] {
  const set = new Set<string>()
  for (const item of evidence) {
    if (item.status === 'verified' || item.status === 'student_approved') {
      for (const s of item.confirmed_skills) set.add(s)
      for (const s of item.extracted_skills) set.add(s)
    } else {
      // self_reported still counts as evidence (but lower weight later)
      for (const s of item.extracted_skills) set.add(s)
    }
  }
  return [...set]
}

// --- Eligibility keywords that map to exclusion reason codes ---

const EXCLUSION_SCHOOL = 'school_not_allowed'
const EXCLUSION_COUNTRY = 'country_not_supported'
const EXCLUSION_AUTHORIZATION = 'missing_authorization'
const EXCLUSION_LISTING_TYPE = 'strict_listing_type_mismatch'
const EXCLUSION_JOB_CLOSED = 'job_closed'
const EXCLUSION_EXPIRED = 'job_expired'

// Check if a date string is in the past
function isPast(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr)
  return d < new Date()
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface EligibilityInput {
  job: MatchJob
  student: MatchStudent
  rp: ResumeProfile | null
  viewerSchoolDomains: string[]      // domains the viewer belongs to (from schoolGates)
  viewerEmail: string                // viewer email domain for school checks
  viewerUserType: 'student' | 'company' | 'school'
}

export function checkHardEligibility(input: EligibilityInput): EligibilityResult {
  const { job, student, viewerSchoolDomains, viewerUserType } = input
  const reasons: string[] = []

  // 1. Job must be active
  if (job.status && job.status !== 'active') {
    reasons.push(EXCLUSION_JOB_CLOSED)
  }

  // 2. Job must not be expired
  if (isPast(job.deadline)) {
    reasons.push(EXCLUSION_EXPIRED)
  }

  // 3. School access — reuse visibility concept.
  //    For students-only jobs, the viewer's school domain must match.
  if (job.students_only && viewerSchoolDomains.length === 0) {
    reasons.push(EXCLUSION_SCHOOL)
  }
  // If the job restricts to specific schools and we have allowed_schools:
  if (job.allowed_schools && job.allowed_schools.length > 0) {
    const studentSchool = student.school
    if (!studentSchool || !job.allowed_schools.some(
      (s) => s.toLowerCase().trim() === studentSchool.toLowerCase().trim()
    )) {
      if (viewerSchoolDomains.length === 0) {
        reasons.push(EXCLUSION_SCHOOL)
      }
    }
  }

  // 4. Country / work authorization (strict policy only — here we check
  //    allowed_years for school and country for work authorization)
  if (job.allowed_years && job.allowed_years.length > 0) {
    if (student.year !== null && student.year !== undefined) {
      if (!job.allowed_years.includes(student.year)) {
        // Year mismatch — this is a soft exclusion under default policy;
        // mark missing but don't hard-exclude unless configured strict.
        // For now: do NOT exclude — just note it's a gap.
      }
    }
  }

  // 5. Listing type strict check — only exclude when student has a strict
  //    preference. (Non-strict preference → penalize via points instead.)
  if (student.major && job.listing_type) {
    // Listing type mismatch is a soft filter (handled in points).
  }

  // 6. Required skills — check if employer marked requirements as strict
  //    and the student evidence is definitively missing (not unknown).
  //    This is handled by the points module: a missing *required* skill
  //    reduces points but only causes exclusion if the employer marked
  //    it strict AND policy allows strict skill exclusion.
  //    Default: do not hard-exclude on skills.

  const passed = reasons.length === 0
  return { passed, reasons }
}

export interface PointsInput {
  job: MatchJob
  student: MatchStudent
  resumeProfile: ResumeProfile | null
  portfolioEvidence: PortfolioEvidence[]
  resumeSkills: string[]           // skills declared on the résumé / profile
  semanticSimilarity: number | null  // 0–1 from embeddings, or null
}

export interface PointsResult {
  total: number
  breakdown: {
    required_skill_points: number
    preferred_skill_points: number
    semantic_similarity_points: number
    role_and_domain_points: number
    experience_points: number
    location_work_type_points: number
    preference_points: number
  }
  matchedSkills: string[]
  missingSkills: string[]
  semanticSimilarity: number
  evidenceCompleteness: number
}

function normalizeArr(s: string | null | undefined): string[] {
  if (!s) return []
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v.map(String) : [String(v)]
  } catch {
    return [s]
  }
}

function skillSet(skills: string[]): Set<string> {
  return new Set(skills.map(canonicalizeSkill))
}

function to01(n: number): number {
  return Math.max(0, Math.min(100, n))
}

export function calculateFilterPoints(input: PointsInput): PointsResult {
  const { job, student, resumeProfile, portfolioEvidence, resumeSkills, semanticSimilarity } = input

  // --- Extract relevant skills from the job ---
  // Required skills: from qualifications (if strict) + tags that look like skills
  const jobQuals = job.qualifications ?? []
  const jobTags = job.tags ?? []
  // Required skills = qualifications (employer marked) + core tags
  // Preferred skills = tags minus required
  const requiredSkillNames = new Set(jobQuals.map(canonicalizeSkill))
  // Also treat certain tags as required: if a tag is explicitly called out
  // in qualifications, it's required. Otherwise tags are preferred.
  const preferredSkillNames = new Set(jobTags.map(canonicalizeSkill))

  // --- Collect all student skills ---
  const resumeSkillSet = skillSet(skillsFromResume(resumeProfile))
  const profileSkillSet = skillSet(resumeSkills)
  const evidenceSkillSet = skillSet(skillsFromEvidence(portfolioEvidence))

  const allStudentSkills = new Set<string>([
    ...resumeSkillSet,
    ...profileSkillSet,
    ...evidenceSkillSet,
  ])

  // --- Required skill coverage ---
  const requiredSkills = [...requiredSkillNames]
  const matchedRequired = requiredSkills.filter((s) => allStudentSkills.has(s))
  const missingRequired = requiredSkills.filter((s) => !allStudentSkills.has(s))
  const requiredCoverage = requiredSkills.length > 0
    ? to01((matchedRequired.length / requiredSkills.length) * 100)
    : 50 // if no required skills specified, neutral
  const required_skill_points = 35 * (requiredCoverage / 100)

  // --- Preferred skill coverage ---
  const preferredSkills = [...preferredSkillNames]
  const matchedPreferred = preferredSkills.filter((s) => allStudentSkills.has(s))
  const missingPreferred = preferredSkills.filter((s) => !allStudentSkills.has(s))
  const preferredCoverage = preferredSkills.length > 0
    ? to01((matchedPreferred.length / preferredSkills.length) * 100)
    : 50
  const preferred_skill_points = 15 * (preferredCoverage / 100)

  // --- Semantic similarity ---
  // sim is 0–1 (cosine similarity). Scale to 0–20 points.
  const sim = semanticSimilarity ?? 0
  const semantic_similarity_points = 20 * sim

  // --- Role and domain fit ---
  // Compare job tags/description against resume domains and desired roles
  let roleMatch = 0
  if (resumeProfile) {
    const jobDomain = (job.tags ?? []).map((t) => canonicalizeSkill(t))
    const resumeDomains = (resumeProfile.domains ?? []).map(canonicalizeSkill)
    const resumeRoles = [...(resumeProfile.roles ?? []), ...(resumeProfile.skills ?? []).map((s) => canonicalizeSkill(typeof s === 'object' ? s.name : s))]
    const overlap = [...jobDomain].filter((t) => resumeRoles.includes(t) || resumeDomains.includes(t))
    roleMatch = resumeRoles.length > 0 ? to01((overlap.length / resumeRoles.length) * 100) : 50
  } else {
    // Fall back to desired roles vs job tags
    const jobTagSet = (job.tags ?? []).map(canonicalizeSkill)
    const desiredRoles = (student.desired_roles ?? []).map(canonicalizeSkill)
    const overlap = jobTagSet.filter((t) => desiredRoles.includes(t))
    roleMatch = desiredRoles.length > 0 ? to01((overlap.length / desiredRoles.length) * 100) : 50
  }
  const role_and_domain_points = 10 * (roleMatch / 100)

  // --- Experience fit ---
  // Based on years of experience and seniority alignment
  let experienceFit = 50
  if (resumeProfile) {
    const years = resumeProfile.total_years
    const seniority = resumeProfile.seniority
    const jobType = job.listing_type.toLowerCase()
    // Internships favor less experience
    if (jobType.includes('intern') || jobType.includes('fellowship')) {
      if (seniority === 'student' || seniority === 'entry') experienceFit = 100
      else if (seniority === 'junior') experienceFit = 70
      else experienceFit = 30
    } else {
      // Full-time: moderate experience is ideal
      if (years >= 2 && years <= 8) experienceFit = 100
      else if (years >= 1) experienceFit = 70
      else if (years > 8) experienceFit = 60
      else experienceFit = 30
    }
  }
  const experience_points = 10 * (experienceFit / 100)

  // --- Location & work type fit ---
  let locWorkFit = 50
  // Remote preference
  if (job.remote && student.work_type === 'remote') locWorkFit = 100
  else if (job.remote && student.work_type === 'hybrid') locWorkFit = 80
  else if (job.remote && student.work_type === 'any') locWorkFit = 90
  else if (job.remote && student.work_type === 'onsite') locWorkFit = 40
  else if (!job.remote && student.work_type === 'onsite') locWorkFit = 100
  else if (!job.remote && student.work_type === 'any') locWorkFit = 70
  else if (!job.remote && student.work_type === 'hybrid') locWorkFit = 50

  // Location match (rough)
  const studentLoc = student.location_pref ?? student.location ?? ''
  const jobLoc = job.location ?? ''
  if (studentLoc && jobLoc) {
    if (job.remote) {
      // Remote jobs don't penalize location
    } else {
      const studentLocNorm = canonicalizeSkill(studentLoc)
      const jobLocNorm = canonicalizeSkill(jobLoc)
      if (studentLocNorm === jobLocNorm) locWorkFit = Math.min(locWorkFit, 100)
      else locWorkFit = Math.floor(locWorkFit * 0.7)
    }
  }
  const location_work_type_points = 5 * (locWorkFit / 100)

  // --- Preference fit ---
  // How well the job matches the student's desired roles and industries
  let prefFit = 50
  if (student.desired_roles?.length) {
    const jt = new Set((job.tags ?? []).map(canonicalizeSkill))
    const desiredRoles = student.desired_roles.map(canonicalizeSkill)
    const matches = desiredRoles.filter((r) => jt.has(r))
    prefFit = to01((matches.length / desiredRoles.length) * 100)
  }
  if (student.preferred_industries?.length) {
    const jt = new Set((job.tags ?? []).map(canonicalizeSkill))
    const desiredIndustries = student.preferred_industries.map(canonicalizeSkill)
    const matches = desiredIndustries.filter((i) => jt.has(i))
    const indFit = desiredIndustries.length > 0 ? to01((matches.length / desiredIndustries.length) * 100) : 50
    prefFit = (prefFit + indFit) / 2
  }
  const preference_points = 5 * (prefFit / 100)

  // --- Compute total ---
  const breakdown = {
    required_skill_points: Math.round(required_skill_points),
    preferred_skill_points: Math.round(preferred_skill_points),
    semantic_similarity_points: Math.round(semantic_similarity_points),
    role_and_domain_points: Math.round(role_and_domain_points),
    experience_points: Math.round(experience_points),
    location_work_type_points: Math.round(location_work_type_points),
    preference_points: Math.round(preference_points),
  }

  // Weighted total (must be 0–100)
  let raw =
    0.35 * (requiredCoverage) +
    0.15 * (preferredCoverage) +
    0.20 * (sim * 100) +
    0.10 * (roleMatch) +
    0.10 * (experienceFit) +
    0.05 * (locWorkFit) +
    0.05 * (prefFit)

  // The breakdown sums should be roughly proportional to the weights.
  // We use the raw weighted score as the total.
  const total = Math.round(to01(raw))

  // --- Evidence completeness ---
  // Proportion of job requirements that have actual résumé/portfolio evidence.
  // Missing evidence ≠ false; it's just unknown.
  const allRequired = [...requiredSkillNames]
  const evidenceSkills = evidenceSkillSet
  let evidenceCount = 0
  let totalRequired = 0
  for (const skill of requiredSkills) {
    totalRequired++
    if (evidenceSkills.has(skill)) evidenceCount++
  }
  // Also count evidence from résumé skills that match job tags
  for (const skill of [...preferredSkills]) {
    if (allStudentSkills.has(skill)) evidenceCount++
    totalRequired++
  }
  const evidenceCompleteness = totalRequired > 0
    ? to01((evidenceCount / totalRequired) * 100) / 100 // 0–1
    : 0.5 // neutral when no requirements

  return {
    total,
    breakdown,
    matchedSkills: [...new Set([...matchedRequired, ...matchedPreferred])],
    missingSkills: missingRequired,
    semanticSimilarity: sim,
    evidenceCompleteness,
  }
}

// ---------------------------------------------------------------------------
// Automatic scoring decision
// ---------------------------------------------------------------------------

export interface AutoScoreInput {
  candidate: MatchCandidate
  jobStatus: string
  config: MatchingConfig
}

export function shouldAutoScore(input: AutoScoreInput): boolean {
  const { candidate, jobStatus, config } = input
  if (candidate.eligibility_status !== 'passed') return false
  if (jobStatus !== 'active') return false
  const byThreshold = candidate.filter_points >= config.auto_score_threshold
  const byRank = (candidate.rank_position ?? 999) <= config.auto_score_top_k
  return byThreshold || byRank
}

// ---------------------------------------------------------------------------
// Final score — deterministic points + AI quality + evidence completeness
// ---------------------------------------------------------------------------

export interface FinalScoreInput {
  filterPoints: number
  aiQuality: number | null
  evidenceCompleteness: number  // 0–1
  aiConfidence: 'low' | 'medium' | 'high' | null
  aiStatus: string
}

export function finalScore(input: FinalScoreInput): { score: number; labeled: boolean } {
  const { filterPoints, aiQuality, evidenceCompleteness, aiConfidence, aiStatus } = input

  if (aiStatus !== 'completed' || aiQuality === null) {
    // AI-pending → show filter_points as provisional
    return { score: filterPoints, labeled: true }
  }

  // final = 0.70 * filter_points + 0.20 * ai_quality + 0.10 * evidence_completeness
  const raw = 0.70 * filterPoints + 0.20 * aiQuality + 0.10 * evidenceCompleteness * 100
  let score = Math.round(raw)

  // Apply evidence caps
  const ec = evidenceCompleteness // 0–1
  if (aiConfidence === 'low') {
    score = Math.min(score, 60)
  } else if (aiConfidence === 'medium') {
    score = Math.min(score, 88)
  } else {
    score = Math.min(score, 99)
  }

  // If no résumé evidence at all (ec=0), cap at 50
  if (ec === 0) score = Math.min(score, 50)

  return { score: Math.max(0, Math.min(99, score)), labeled: false }
}

// ---------------------------------------------------------------------------
// Helper: build a normalized match input from raw DB rows
// ---------------------------------------------------------------------------

export function buildMatchInput(
  jobRow: any,
  studentRow: any,
  resumeRow: any,
  evidenceItems: any[],
  semanticSim: number | null,
): {
  job: MatchJob
  student: MatchStudent
  resumeProfile: ResumeProfile | null
  portfolioEvidence: PortfolioEvidence[]
  resumeSkills: string[]
  semanticSimilarity: number | null
} {
  const job: MatchJob = {
    id: jobRow.id,
    title: jobRow.title,
    description: jobRow.description ?? '',
    type: jobRow.type,
    listing_type: jobRow.listing_type,
    tags: normalizeArr(jobRow.tags),
    country: jobRow.country,
    remote: Boolean(jobRow.remote),
    pay: jobRow.pay ?? null,
    location: jobRow.location ?? null,
    duration: jobRow.duration ?? null,
    qualifications: normalizeArr(jobRow.qualifications),
    responsibilities: normalizeArr(jobRow.responsibilities),
    benefits: normalizeArr(jobRow.benefits),
    status: jobRow.status,
    allowed_years: normalizeArr(jobRow.allowed_years).map(Number),
    allowed_schools: normalizeArr(jobRow.allowed_schools),
    students_only: Boolean(jobRow.students_only),
    company_id: jobRow.company_id,
  }

  const student: MatchStudent = {
    id: studentRow.id,
    cv_text: studentRow.cv_text ?? null,
    skills: normalizeArr(studentRow.skills),
    desired_roles: normalizeArr(studentRow.desired_roles),
    preferred_industries: normalizeArr(studentRow.preferred_industries),
    work_type: studentRow.work_type ?? null,
    location_pref: studentRow.location_pref ?? null,
    location: studentRow.location ?? null,
    major: studentRow.major ?? null,
    school: studentRow.school ?? null,
    year: studentRow.year ?? null,
    country: studentRow.country ?? null,
  }

  const resumeProfile: ResumeProfile | null = resumeRow?.resume_profile
    ? (typeof resumeRow.resume_profile === 'string'
        ? JSON.parse(resumeRow.resume_profile)
        : resumeRow.resume_profile)
    : null

  const portfolioEvidence: PortfolioEvidence[] = (evidenceItems ?? []).map((e) => ({
    id: e.id,
    title: e.title ?? '',
    description: e.description ?? '',
    url: e.url ?? null,
    links: normalizeArr(e.links),
    extracted_skills: normalizeArr(e.extracted_skills),
    confirmed_skills: normalizeArr(e.confirmed_skills),
    status: e.status ?? 'self_reported',
    ai_summary: e.ai_summary ?? null,
  }))

  const resumeSkills = normalizeArr(resumeRow?.skills ?? studentRow.skills)

  return { job, student, resumeProfile, portfolioEvidence, resumeSkills, semanticSimilarity: semanticSim }
}
