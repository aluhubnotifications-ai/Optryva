import { describe, it, expect } from 'vitest'
import { checkHardEligibility, calculateFilterPoints, shouldAutoScore, finalScore, canonicalizeSkill } from '../matchPoints'
import type { MatchJob, MatchStudent, MatchingConfig, MatchCandidate } from '../matching'
import type { ResumeProfile } from '../resume'

// ---------------------------------------------------------------------------
// Helpers to build test fixtures
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<MatchJob> = {}): MatchJob {
  return {
    id: 'job-1',
    title: 'Frontend Engineer',
    description: 'Build user interfaces with React and TypeScript.',
    type: 'full-time',
    listing_type: 'Internship',
    tags: [],
    country: 'United States',
    remote: true,
    pay: null,
    location: null,
    duration: '3 months',
    responsibilities: ['Build features'],
    qualifications: ['React', 'TypeScript', 'SQL'],
    benefits: [],
    status: 'active',
    deadline: '2026-12-31',
    allowed_years: [],
    allowed_schools: [],
    students_only: false,
    company_id: 'company-1',
    created_at: '2026-01-01',
    version: 'v1',
    ...overrides,
  }
}

function makeStudent(overrides: Partial<MatchStudent> = {}): MatchStudent {
  return {
    id: 'student-1',
    cv_text: 'Experienced in React and SQL projects.',
    skills: ['React', 'SQL', 'Docker'],
    desired_roles: ['Frontend Engineer'],
    preferred_industries: ['Tech'],
    work_type: 'remote',
    location_pref: null,
    location: 'San Francisco',
    major: 'Computer Science',
    school: 'Test University',
    year: 3,
    country: 'United States',
    resume_profile: null,
  }
}

function makeResumeProfile(overrides: Partial<ResumeProfile> = {}): ResumeProfile {
  return {
    summary: 'Experienced frontend developer.',
    seniority: 'junior',
    total_years: 2,
    skills: [
      { name: 'React', level: 'proficient', years: 2, evidence: 'Project work' },
      { name: 'SQL', level: 'proficient', years: 1, evidence: 'Internship' },
      { name: 'TypeScript', level: 'proficient', years: 2, evidence: 'Project work' },
    ],
    domains: ['Tech'],
    roles: ['Frontend Developer'],
    projects: [{ name: 'Portfolio Site', stack: ['React', 'TypeScript'] }],
    strengths: ['Frontend'],
    gaps: ['Python'],
    ...overrides,
  }
}

function makeConfig(overrides: Partial<MatchingConfig> = {}): MatchingConfig {
  return {
    auto_score_threshold: 70,
    auto_score_top_k: 10,
    max_groq_batch_size: 8,
    max_auto_pairs_per_job: 20,
    filter_version: 'filter-v1',
    prompt_version: 'match-prompt-v1',
    enabled: true,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Skill alias normalization
// ---------------------------------------------------------------------------

describe('canonicalizeSkill', () => {
  it('normalizes React variants', () => {
    expect(canonicalizeSkill('React')).toBe(canonicalizeSkill('React.js'))
    expect(canonicalizeSkill('ReactJS')).toBe(canonicalizeSkill('react js'))
  })
  it('normalizes Node.js variants', () => {
    expect(canonicalizeSkill('Node.js')).toBe(canonicalizeSkill('nodejs'))
    expect(canonicalizeSkill('node js')).toBe(canonicalizeSkill('Node'))
  })
  it('normalizes SQL variants', () => {
    expect(canonicalizeSkill('PostgreSQL')).toBe(canonicalizeSkill('SQL'))
    expect(canonicalizeSkill('psql')).toBe(canonicalizeSkill('postgreSQL'))
  })
  it('lowercases unknown skills', () => {
    expect(canonicalizeSkill('Docker')).toBe('docker')
  })
  it('preserves unknown skills verbatim', () => {
    expect(canonicalizeSkill('Kubernetes')).toBe('kubernetes')
  })
})

// ---------------------------------------------------------------------------
// Hard eligibility
// ---------------------------------------------------------------------------

describe('checkHardEligibility', () => {
  const job = makeJob()
  const student = makeStudent()
  const rp = makeResumeProfile()

  it('passes active, non-restricted job', () => {
    const result = checkHardEligibility({
      job,
      student,
      rp,
      viewerSchoolDomains: [],
      viewerEmail: 'test@example.com',
      viewerUserType: 'student',
    })
    expect(result.passed).toBe(true)
    expect(result.reasons).toEqual([])
  })

  it('excludes closed jobs', () => {
    const closedJob = makeJob({ status: 'closed' })
    const result = checkHardEligibility({
      job: closedJob,
      student,
      rp,
      viewerSchoolDomains: [],
      viewerEmail: 'test@example.com',
      viewerUserType: 'student',
    })
    expect(result.passed).toBe(false)
    expect(result.reasons).toContain('job_closed')
  })

  it('excludes expired jobs', () => {
    const expiredJob = makeJob({ deadline: '2020-01-01' })
    const result = checkHardEligibility({
      job: expiredJob,
      student,
      rp,
      viewerSchoolDomains: [],
      viewerEmail: 'test@example.com',
      viewerUserType: 'student',
    })
    expect(result.passed).toBe(false)
    expect(result.reasons).toContain('job_expired')
  })

  it('excludes students_only jobs without domain match', () => {
    const restrictedJob = makeJob({ students_only: true })
    const result = checkHardEligibility({
      job: restrictedJob,
      student,
      rp,
      viewerSchoolDomains: [],
      viewerEmail: 'external@example.com',
      viewerUserType: 'student',
    })
    expect(result.passed).toBe(false)
    expect(result.reasons).toContain('school_not_allowed')
  })

  it('passes students_only job with domain match', () => {
    const restrictedJob = makeJob({ students_only: true })
    const result = checkHardEligibility({
      job: restrictedJob,
      student,
      rp,
      viewerSchoolDomains: ['test.edu'],
      viewerEmail: 'student@test.edu',
      viewerUserType: 'student',
    })
    expect(result.passed).toBe(true)
  })

  it('preserves other reasons when job is also expired', () => {
    const expiredJob = makeJob({ status: 'closed', deadline: '2020-01-01' })
    const result = checkHardEligibility({
      job: expiredJob,
      student,
      rp,
      viewerSchoolDomains: [],
      viewerEmail: 'test@example.com',
      viewerUserType: 'student',
    })
    expect(result.passed).toBe(false)
    expect(result.reasons).toContain('job_closed')
    expect(result.reasons).toContain('job_expired')
  })
})

// ---------------------------------------------------------------------------
// Filter points calculation
// ---------------------------------------------------------------------------

describe('calculateFilterPoints', () => {
  const job = makeJob({ qualifications: ['React', 'SQL', 'TypeScript'], tags: ['Docker', 'CI/CD'] })
  const student = makeStudent({ skills: ['React', 'SQL', 'Docker'] })
  const rp = makeResumeProfile()

  it('returns 0-100 total', () => {
    const result = calculateFilterPoints({
      job,
      student,
      resumeProfile: rp,
      portfolioEvidence: [],
      resumeSkills: ['React', 'SQL', 'Docker'],
      semanticSimilarity: 0.85,
    })
    expect(result.total).toBeGreaterThanOrEqual(0)
    expect(result.total).toBeLessThanOrEqual(100)
  })

  it('gives full required skill points when all required skills match', () => {
    const result = calculateFilterPoints({
      job,
      student,
      resumeProfile: rp,
      portfolioEvidence: [],
      resumeSkills: ['React', 'SQL', 'TypeScript'],
      semanticSimilarity: 0.85,
    })
    expect(result.breakdown.required_skill_points).toBe(35)
    expect(result.matchedSkills).toContain('react')
    expect(result.matchedSkills).toContain('sql')
  })

  it('reduces required skill points for missing skills', () => {
    const result = calculateFilterPoints({
      job,
      student,
      resumeProfile: null,
      portfolioEvidence: [],
      resumeSkills: ['React'], // missing SQL and TypeScript
      semanticSimilarity: 0.5,
    })
    expect(result.missingSkills).toContain('sql')
    expect(result.missingSkills).toContain('typescript')
    expect(result.breakdown.required_skill_points).toBeLessThan(35)
  })

  it('includes portfolio evidence skills', () => {
    const result = calculateFilterPoints({
      job,
      student,
      resumeProfile: null,
      portfolioEvidence: [
        {
          id: 'e1',
          title: 'SQL Project',
          description: 'Built a database analyzer',
          url: 'https://github.com/test/sql-proj',
          links: [],
          extracted_skills: ['SQL'],
          confirmed_skills: ['SQL'],
          status: 'verified',
          ai_summary: null,
        },
      ],
      resumeSkills: ['React'],
      semanticSimilarity: 0.5,
    })
    expect(result.matchedSkills).toContain('sql')
  })

  it('marks missing skills accurately', () => {
    const rpWithoutTs = makeResumeProfile({
      skills: [{ name: 'React', level: 'proficient', years: 2 }, { name: 'SQL', level: 'proficient', years: 1 }],
    })
    const result = calculateFilterPoints({
      job,
      student,
      resumeProfile: rpWithoutTs,
      portfolioEvidence: [],
      resumeSkills: ['React', 'SQL'],
      semanticSimilarity: 0.5,
    })
    // TypeScript is required but not in resumeSkills or resumeProfile skills
    expect(result.missingSkills).toContain('typescript')
  })

  it('weights breakdown matches formula', () => {
    const result = calculateFilterPoints({
      job,
      student,
      resumeProfile: rp,
      portfolioEvidence: [],
      resumeSkills: ['React', 'SQL', 'TypeScript', 'Docker'],
      semanticSimilarity: 1.0,
    })
    // With perfect match, all components should be near max
    expect(result.breakdown.required_skill_points).toBe(35)
    expect(result.breakdown.preferred_skill_points).toBeGreaterThan(0)
    expect(result.breakdown.semantic_similarity_points).toBe(20)
  })

  it('uses semantic similarity from embeddings', () => {
    const result = calculateFilterPoints({
      job,
      student,
      resumeProfile: rp,
      portfolioEvidence: [],
      resumeSkills: ['React', 'SQL', 'TypeScript'],
      semanticSimilarity: 0.9,
    })
    expect(result.semanticSimilarity).toBe(0.9)
    expect(result.breakdown.semantic_similarity_points).toBe(18) // 20 * 0.9
  })

  it('falls back gracefully when no skills match', () => {
    const result = calculateFilterPoints({
      job: makeJob({ qualifications: ['Python', 'Go'], tags: ['Rust'] }),
      student,
      resumeProfile: rp,
      portfolioEvidence: [],
      resumeSkills: ['React', 'SQL'],
      semanticSimilarity: 0.1,
    })
    expect(result.total).toBeLessThan(50)
    expect(result.missingSkills).toContain('python')
    expect(result.missingSkills).toContain('go')
  })

  it('handles empty job qualifications gracefully', () => {
    const result = calculateFilterPoints({
      job: makeJob({ qualifications: [], tags: [] }),
      student,
      resumeProfile: rp,
      portfolioEvidence: [],
      resumeSkills: ['React'],
      semanticSimilarity: null,
    })
    expect(result.total).toBeGreaterThanOrEqual(0)
    expect(result.total).toBeLessThanOrEqual(100)
  })
})

// ---------------------------------------------------------------------------
// shouldAutoScore
// ---------------------------------------------------------------------------

describe('shouldAutoScore', () => {
  const config = makeConfig()

  function makeCandidate(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
    return {
      id: 'c1',
      student_id: 's1',
      job_id: 'j1',
      resume_id: 'r1',
      job_version: 'v1',
      resume_version: 'v1',
      preference_version: null,
      filter_version: 'filter-v1',
      eligibility_status: 'passed',
      exclusion_reasons: [],
      filter_points: 80,
      point_breakdown: { required_skill_points: 35, preferred_skill_points: 15, semantic_similarity_points: 20, role_and_domain_points: 10, experience_points: 10, location_work_type_points: 5, preference_points: 5 },
      semantic_similarity: 0.85,
      matched_skills: ['react'],
      missing_skills: [],
      evidence_completeness: 0.8,
      rank_position: 5,
      ai_status: 'not_requested',
      ai_score: null,
      ai_quality: null,
      ai_confidence: null,
      ai_payload: null,
      ai_model: null,
      ai_prompt_version: null,
      ai_scored_at: null,
      ai_error: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
      stale_at: null,
      ...overrides,
    }
  }

  it('queues when points >= threshold', () => {
    expect(shouldAutoScore({
      candidate: makeCandidate({ filter_points: 70 }),
      jobStatus: 'active',
      config,
    })).toBe(true)
  })

  it('queues when rank <= top_k', () => {
    expect(shouldAutoScore({
      candidate: makeCandidate({ filter_points: 50, rank_position: 3 }),
      jobStatus: 'active',
      config,
    })).toBe(true)
  })

  it('does not queue when below threshold and rank', () => {
    expect(shouldAutoScore({
      candidate: makeCandidate({ filter_points: 60, rank_position: 15 }),
      jobStatus: 'active',
      config,
    })).toBe(false)
  })

  it('does not queue when excluded', () => {
    expect(shouldAutoScore({
      candidate: makeCandidate({ eligibility_status: 'excluded' }),
      jobStatus: 'active',
      config,
    })).toBe(false)
  })

  it('does not queue when job is closed', () => {
    expect(shouldAutoScore({
      candidate: makeCandidate({ eligibility_status: 'passed' }),
      jobStatus: 'closed',
      config,
    })).toBe(false)
  })

  it('queues when points >= threshold even if rank is low', () => {
    expect(shouldAutoScore({
      candidate: makeCandidate({ filter_points: 75, rank_position: 999 }),
      jobStatus: 'active',
      config,
    })).toBe(true)
  })

  it('queues when rank <= top_k even if points are low', () => {
    expect(shouldAutoScore({
      candidate: makeCandidate({ filter_points: 30, rank_position: 1 }),
      jobStatus: 'active',
      config,
    })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// finalScore
// ---------------------------------------------------------------------------

describe('finalScore', () => {
  it('returns filter_points as provisional when AI is pending', () => {
    const { score, labeled } = finalScore({
      filterPoints: 82,
      aiQuality: null,
      evidenceCompleteness: 0.8,
      aiConfidence: null,
      aiStatus: 'queued',
    })
    expect(score).toBe(82)
    expect(labeled).toBe(true)
  })

  it('computes weighted final score when AI is completed', () => {
    const { score, labeled } = finalScore({
      filterPoints: 82,
      aiQuality: 90,
      evidenceCompleteness: 0.8,
      aiConfidence: 'high',
      aiStatus: 'completed',
    })
    // 0.70 * 82 + 0.20 * 90 + 0.10 * 80 = 57.4 + 18 + 8 = 83.4 → 83
    expect(score).toBe(83)
    expect(labeled).toBe(false)
  })

  it('caps at 50 when no evidence', () => {
    const { score } = finalScore({
      filterPoints: 82,
      aiQuality: 90,
      evidenceCompleteness: 0,
      aiConfidence: 'high',
      aiStatus: 'completed',
    })
    expect(score).toBeLessThanOrEqual(50)
  })

  it('caps at 60 for low confidence', () => {
    const { score } = finalScore({
      filterPoints: 90,
      aiQuality: 95,
      evidenceCompleteness: 0.8,
      aiConfidence: 'low',
      aiStatus: 'completed',
    })
    expect(score).toBeLessThanOrEqual(60)
  })

  it('caps at 88 for medium confidence', () => {
    const { score } = finalScore({
      filterPoints: 90,
      aiQuality: 95,
      evidenceCompleteness: 0.8,
      aiConfidence: 'medium',
      aiStatus: 'completed',
    })
    expect(score).toBeLessThanOrEqual(88)
  })

  it('caps at 99 for high confidence', () => {
    const { score } = finalScore({
      filterPoints: 90,
      aiQuality: 100,
      evidenceCompleteness: 1.0,
      aiConfidence: 'high',
      aiStatus: 'completed',
    })
    expect(score).toBeLessThanOrEqual(99)
  })

  it('preserves provisional score on AI failure', () => {
    const { score, labeled } = finalScore({
      filterPoints: 75,
      aiQuality: null,
      evidenceCompleteness: 0.5,
      aiConfidence: null,
      aiStatus: 'failed',
    })
    expect(score).toBe(75)
    expect(labeled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Portfolio evidence integration
// ---------------------------------------------------------------------------

describe('Portfolio evidence in matching', () => {
  it('counts verified portfolio skills toward matched_skills', () => {
    const result = calculateFilterPoints({
      job: makeJob({ qualifications: ['SQL'] }),
      student: makeStudent(),
      resumeProfile: null,
      portfolioEvidence: [
        {
          id: 'e1',
          title: 'Data Analysis Project',
          description: 'Built a SQL-based analytics dashboard.',
          url: null,
          links: [],
          extracted_skills: ['SQL'],
          confirmed_skills: ['SQL'],
          status: 'verified',
          ai_summary: null,
        },
      ],
      resumeSkills: [],
      semanticSimilarity: 0.5,
    })
    expect(result.matchedSkills).toContain('sql')
  })

  it('does NOT count inaccessible (empty URL, no content) evidence as proven', () => {
    const result = calculateFilterPoints({
      job: makeJob({ qualifications: ['Python'] }),
      student: makeStudent(),
      resumeProfile: null,
      portfolioEvidence: [
        {
          id: 'e1',
          title: 'Project',
          description: '',
          url: null,
          links: [],
          extracted_skills: [],
          confirmed_skills: [],
          status: 'self_reported',
          ai_summary: null,
        },
      ],
      resumeSkills: [],
      semanticSimilarity: 0.5,
    })
    // Python should be missing because the evidence item has no skills
    expect(result.missingSkills).toContain('python')
  })

  it('unrelated projects do not add skills', () => {
    const result = calculateFilterPoints({
      job: makeJob({ qualifications: ['SQL'] }),
      student: makeStudent(),
      resumeProfile: null,
      portfolioEvidence: [
        {
          id: 'e1',
          title: 'Art Project',
          description: 'Painted a landscape.',
          url: null,
          links: [],
          extracted_skills: ['painting'],
          confirmed_skills: [],
          status: 'verified',
          ai_summary: null,
        },
      ],
      resumeSkills: [],
      semanticSimilarity: 0.5,
    })
    // Painting doesn't help with SQL
    expect(result.matchedSkills).not.toContain('painting')
    expect(result.missingSkills).toContain('sql')
  })
})
