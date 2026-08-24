// Shared domain types — mirror the Phase B database schema.

export type UserType = 'student' | 'company' | 'school'

export type Plan = 'free' | 'pro' | 'basic' | 'standard' | 'premium' | 'pending_payment'

export type WorkType = 'remote' | 'onsite' | 'hybrid' | 'any'

export interface Profile {
  id: string
  user_type: UserType
  full_name: string
  email: string
  avatar_url?: string
  cover_url?: string
  bio?: string
  // student
  school?: string
  major?: string
  year?: number // 1..4 (study year), optional/global
  location?: string
  country?: string
  gpa?: string // free-text, any format the student likes (e.g. "3.8/4.0", "Second Class Upper")
  linkedin?: string
  github?: string
  twitter?: string
  website?: string
  cv_filename?: string
  cv_uploaded_at?: string
  cv_last_matched_at?: string
  cv_text?: string
  cv_url?: string // résumé file as a data URL
  desired_roles?: string[]
  preferred_industries?: string[]
  work_type?: WorkType
  location_pref?: string
  open_to_internship?: boolean
  open_to_fulltime?: boolean
  pref_listing_types?: ListingType[] // opportunity types the student wants (empty = all)
  pref_countries?: string[] // countries the student will work in (empty = all; remote always allowed)
  monitoring_consent?: boolean // opt-in: let Optryva track outcomes after an external apply
  skills?: string[]
  // company / school
  company_name?: string
  industry?: string
  company_size?: string
  // school: student email domains + privacy gate
  student_domains?: string[]
  is_private?: boolean
  posted_by_role?: 'company' | 'school'
  // plan
  plan: Plan
  plan_activated_at?: string
  /** True when the account's email is in the server's ADMIN_EMAILS allowlist. */
  is_admin?: boolean
  created_at: string
}

export interface ResumeProfile {
  id: string
  student_id: string
  name: string
  target_roles: string[]
  preferred_industries: string[]
  pref_countries: string[]
  pref_listing_types: ListingType[]
  skills: string[]
  work_type: WorkType
  cv_filename?: string
  cv_url?: string
  active: boolean
  created_at: string
  updated_at: string
}

export type ListingType = 'Internship' | 'Full-time' | 'Part-time' | 'Fellowship'
export type ListingStatus = 'active' | 'closed' | 'draft'

export interface JobListing {
  id: string
  company_id: string
  title: string
  description: string
  type: string // category: Software Engineering, Data, Operations...
  listing_type: ListingType
  location: string
  country: string
  remote: boolean
  pay?: string
  currency?: string
  duration?: string
  deadline?: string
  tags: string[]
  responsibilities?: string[] // company-specified; empty/undefined => auto-generated
  benefits?: string[] // company-specified; empty/undefined => auto-generated
  qualifications?: string[] // company-specified; empty/undefined => auto-generated
  status: ListingStatus
  apply_url?: string | null // set => external apply mode
  allowed_years: number[] // empty = all years
  allowed_schools?: string[] // empty/undefined = all schools; else only these universities
  students_only?: boolean // school posts: restrict to the school's student email domains
  posted_by_role: 'company' | 'school'
  original_company_name?: string
  original_company_logo_url?: string
  company_name?: string // display name of the posting entity (company or school)
  company_avatar_url?: string // avatar/logo of the posting entity
  assignment?: AiAssignment | null
  created_at: string
}

export interface AiRubricCriterion {
  id: string
  label: string
  points: number
}

export interface AiAssignment {
  title: string
  prompt: string
  due_before_interview: boolean
  max_attempts?: number
  // When the proctored test is required relative to the application:
  //  - 'after_application' (default): take it right after applying
  //  - 'after_shortlist': only once the employer shortlists the candidate
  required_when?: 'after_application' | 'after_shortlist'
  // How many days the candidate has to complete the test once eligible (window).
  window_days?: number | null
  // Time limit for a single test session, in minutes (default 30).
  duration_minutes?: number | null
  rubric: AiRubricCriterion[]
  questions?: AiAssignmentQuestion[]
}

export type AiQuestionType = 'single_choice' | 'multiple_choice' | 'true_false' | 'essay'

export interface AiAssignmentQuestion {
  id: string
  type: AiQuestionType
  prompt: string
  required: boolean
  options?: string[]
  minWords?: number | null
  maxWords?: number | null
}

export type ApplicationStatus = 'draft' | 'pending' | 'reviewed' | 'shortlisted' | 'hired' | 'rejected' | 'cancelled'

export interface AppDocument {
  kind: 'cv' | 'cover' | 'transcript' | 'recommendation' | 'portfolio' | 'certificate' | 'id'
  name: string
  url: string
  mime: string
  size: number
}

export interface Application {
  id: string
  student_id: string
  job_id: string
  status: ApplicationStatus
  cover_note?: string
  documents: AppDocument[]
  full_name: string
  email: string
  phone?: string
  school?: string
  year?: number
  linkedin?: string
  assignment_answers?: { criterion_id?: string; question_id?: string; answer: string | string[]; file_name?: string }[]
  assignment_status?: 'not_required' | 'pending' | 'submitted'
  test_eligible_at?: string | null
  assignment_submitted_at?: string | null
  assignment_late?: boolean
  match_score?: number
  match_rationale?: string
  resume_id?: string | null
  resume_snapshot?: { id: string; name: string; summary?: string | null; skills?: string[]; projects?: any[] } | null
  resume_changed?: boolean
  student_avatar_url?: string
  student_skills?: string[]
  student_bio?: string
  assignment_score?: number
  assignment_ai_feedback?: { overall: string; perQuestion: { id: string; feedback: string }[] }
  ai_recommendation?: 'advance' | 'consider' | 'hold'
  decision_by?: string
  decision_reason?: string
  decided_at?: string
  archived_at?: string | null
  attempts?: number
  assignment_attempts?: any[]
  tags?: string[]
  created_at: string
  timeline: { status: ApplicationStatus | 'applied' | 'test_return' | 'test_submitted' | 'test_unlocked'; at: string; reason?: string; late?: boolean; note?: string; by?: string }[]
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
  score: number // 0..99
  breakdown: MatchBreakdown
  matched_skills: string[]
  reasons: string[]
  mismatch_flags: string[]
  tip: string
  stale?: boolean
  created_at: string
}

export type MessageKind = 'text' | 'image' | 'file'

export interface Attachment {
  url: string
  name: string
  type: string
  size: number
}

export interface Message {
  id: string
  thread_id: string // application_id OR dmThreadId
  scope: 'application' | 'dm'
  sender_id: string
  kind: MessageKind
  body?: string
  attachment?: Attachment
  reactions: Record<string, string[]> // emoji -> userIds
  read: boolean
  deleted?: boolean
  created_at: string
}

export type SkillLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert'

export interface StudentSkill {
  id: string
  owner_id: string
  skill: string
  level: SkillLevel
  years: number
  portfolio_url?: string
  verified: boolean
  sessions: number
  rating: number
  rating_count: number
  blurb?: string
}

export interface SkillBooking {
  id: string
  skill_id: string
  booker_id: string
  preferred_at: string
  message?: string
  created_at: string
}

export interface Resource {
  id: string
  owner_id: string
  title: string
  author: string
  type: 'Notes' | 'Template' | 'Report' | 'Slides' | 'Case Study'
  price: number
  currency: string
  icon: string
  file_name: string
  file_type: string
  file_size: number
  sales: number
  created_at: string
}

export type HousingStatus = 'active' | 'filled' | 'deleted'

export interface HousingRequest {
  id: string
  poster_id: string
  title: string
  description: string
  area: string
  city: string
  people: number
  dates: string
  urgent: boolean
  status: HousingStatus
  created_at: string
}

export interface RelocationGuide {
  id: string
  city: string
  country: string
  icon: string
  title: string
  items: { label: string; detail: string }[]
}

export interface CompanyFollow {
  student_id: string
  company_id: string
  email_notifications: boolean
}

export interface Rating {
  id: string
  rater_id: string
  ref_type: 'skill' | 'company'
  ref_id: string
  stars: number
  comment?: string
  created_at: string
}

export type NotificationType =
  | 'dm'
  | 'message'
  | 'new_job'
  | 'new_listing'
  | 'followed_company_listing'
  | 'status_change'
  | 'housing'
  | 'payment'
  | 'new_application'
  | 'booking'

export interface AppNotification {
  id: string
  user_id: string
  type: NotificationType
  title: string
  body: string
  read: boolean
  ref_id?: string
  created_at: string
}

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'timeout'

export interface Payment {
  id: string
  user_id: string
  amount: number
  currency: string
  status: PaymentStatus
  label: string
  ref_type?: string
  target_id?: string
  created_at: string
}
