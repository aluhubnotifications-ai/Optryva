import { j } from '@/db'
import { isAdminEmail } from '@/lib/admin'

const bool = (v: any) => v === 1 || v === true
const arr = <T>(s: any): T[] => j.parse<T[]>(s, [])

export function rowToProfile(r: any, includePrivate = false) {
  if (!r) return null
  return {
    id: r.id,
    user_type: r.user_type,
    full_name: r.full_name,
    email: r.email,
    avatar_url: r.avatar_url ?? undefined,
    cover_url: r.cover_url ?? undefined,
    bio: r.bio ?? undefined,
    school: r.school ?? undefined,
    major: r.major ?? undefined,
    year: r.year ?? undefined,
    location: r.location ?? undefined,
    country: r.country ?? undefined,
    gpa: r.gpa ?? undefined,
    linkedin: r.linkedin ?? undefined,
    github: r.github ?? undefined,
    twitter: r.twitter ?? undefined,
    website: r.website ?? undefined,
    ...(includePrivate ? {
      cv_filename: r.cv_filename ?? undefined,
      cv_uploaded_at: r.cv_uploaded_at ?? undefined,
      cv_text: r.cv_text ?? undefined,
      cv_url: r.cv_url ?? undefined,
    } : {}),
    desired_roles: arr<string>(r.desired_roles),
    preferred_industries: arr<string>(r.preferred_industries),
    work_type: r.work_type ?? undefined,
    location_pref: r.location_pref ?? undefined,
    open_to_internship: r.open_to_internship == null ? undefined : bool(r.open_to_internship),
    open_to_fulltime: r.open_to_fulltime == null ? undefined : bool(r.open_to_fulltime),
    pref_listing_types: arr<string>(r.pref_listing_types),
    pref_countries: arr<string>(r.pref_countries),
    monitoring_consent: bool(r.monitoring_consent),
    skills: arr<string>(r.skills),
    company_name: r.company_name ?? undefined,
    industry: r.industry ?? undefined,
    company_size: r.company_size ?? undefined,
    student_domains: arr<string>(r.student_domains),
    is_private: bool(r.is_private),
    posted_by_role: r.posted_by_role ?? undefined,
    plan: r.plan,
    plan_activated_at: r.plan_activated_at ?? undefined,
    is_admin: isAdminEmail(r.email),
    created_at: r.created_at,
  }
}

export function rowToJob(r: any) {
  if (!r) return null
  return {
    id: r.id,
    company_id: r.company_id,
    title: r.title,
    description: r.description,
    type: r.type,
    listing_type: r.listing_type,
    location: r.location,
    country: r.country,
    remote: bool(r.remote),
    pay: r.pay ?? undefined,
    currency: r.currency ?? undefined,
    duration: r.duration ?? undefined,
    deadline: r.deadline ?? undefined,
    tags: arr<string>(r.tags),
    responsibilities: arr<string>(r.responsibilities),
    benefits: arr<string>(r.benefits),
    qualifications: arr<string>(r.qualifications),
    status: r.status,
    apply_url: r.apply_url ?? null,
    allowed_years: arr<number>(r.allowed_years),
    allowed_schools: arr<string>(r.allowed_schools),
    students_only: bool(r.students_only),
    posted_by_role: r.posted_by_role,
    original_company_name: r.original_company_name ?? undefined,
    original_company_logo_url: r.original_company_logo_url ?? undefined,
    company_name: r.company_name ?? undefined,
    company_avatar_url: r.company_avatar_url ?? undefined,
    assignment: r.assignment ? j.parse(r.assignment, undefined) : undefined,
    created_at: r.created_at,
  }
}

export function rowToApplication(r: any) {
  if (!r) return null
  return {
    id: r.id,
    student_id: r.student_id,
    job_id: r.job_id,
    status: r.status,
    cover_note: r.cover_note ?? undefined,
    documents: arr<any>(r.documents),
    full_name: r.full_name,
    email: r.email,
    phone: r.phone ?? undefined,
    school: r.school ?? undefined,
    year: r.year ?? undefined,
    linkedin: r.linkedin ?? undefined,
    assignment_answers: r.assignment_answers ? j.parse(r.assignment_answers, []) : undefined,
    assignment_status: r.assignment_status ?? undefined,
    test_eligible_at: r.test_eligible_at ?? undefined,
    assignment_submitted_at: r.assignment_submitted_at ?? undefined,
    assignment_late: r.assignment_late ?? false,
    match_score: r.match_score ?? undefined,
    match_rationale: r.match_rationale ?? undefined,
    student_avatar_url: r.student_avatar_url ?? undefined,
    student_skills: arr<string>(r.student_skills),
    student_bio: r.student_bio ?? undefined,
    assignment_score: r.assignment_score ?? undefined,
    assignment_ai_feedback: r.assignment_ai_feedback ? j.parse(r.assignment_ai_feedback, undefined) : undefined,
    ai_recommendation: r.ai_recommendation ?? undefined,
    decision_by: r.decision_by ?? undefined,
    decision_reason: r.decision_reason ?? undefined,
    decided_at: r.decided_at ?? undefined,
    attempts: r.attempts ?? 0,
    timeline: arr<any>(r.timeline),
    created_at: r.created_at,
  }
}

export function rowToMessage(r: any) {
  if (!r) return null
  return {
    id: r.id,
    thread_id: r.thread_id,
    scope: r.scope,
    sender_id: r.sender_id,
    kind: r.kind,
    body: r.body ?? undefined,
    attachment: r.attachment ? j.parse(r.attachment, null) : undefined,
    reactions: j.parse(r.reactions, {}),
    read: bool(r.read),
    deleted: bool(r.deleted),
    created_at: r.created_at,
  }
}

export function rowToNotification(r: any) {
  return {
    id: r.id,
    user_id: r.user_id,
    type: r.type,
    title: r.title,
    body: r.body,
    read: bool(r.read),
    ref_id: r.ref_id ?? undefined,
    created_at: r.created_at,
  }
}
