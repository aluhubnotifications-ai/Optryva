// ----------------------------------------------------------------------------
// Match types only.
//
// The deterministic scoring engine was removed — Claude (the honest rubric in
// routes/ai.ts) is now the SOLE scorer. This module just holds the shared shapes
// the routes and scripts pass around. No scoring logic lives here anymore.
// ----------------------------------------------------------------------------

import type { ResumeProfile } from '@/lib/resume'
export type { ResumeProfile } from '@/lib/resume'

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
}

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
}
