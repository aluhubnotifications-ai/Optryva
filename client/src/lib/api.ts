import * as db from '@/data/mockDb'
import { dmThreadId, seededScore, sleep, uid } from '@/lib/utils'
import { trackAi } from '@/lib/aiActivity'
import { cached, invalidateCache } from '@/lib/dataCache'
import { startLoad, endLoad } from '@/lib/loadingBar'
 import type {
   AiAssignmentQuestion,
   AiMatch,
   AiRubricCriterion,
   AppNotification,
   Application,
   ApplicationStatus,
   HousingRequest,
   JobListing,
  Message,
  Payment,
  Plan,
  Profile,
  ResumeProfile,
  Rating,
  Resource,
  SkillBooking,
  StudentSkill,
  EvidenceItem,
} from '@/types'

// ----------------------------------------------------------------------------
// Single API client. Today it operates on the in-memory mock DB. In Phase B,
// each function body is swapped for a real `fetch(...)` call — call sites stay
// identical. A small artificial latency makes the UI feel real.
// ----------------------------------------------------------------------------

const LATENCY = 220
async function delay<T>(value: T, ms = LATENCY): Promise<T> {
  await sleep(ms)
  return value
}

/* ----------------------------- Auth (real backend) ----------------------------- */
// The auth flow talks to the real Optryva server (Supabase-backed). Everything
// else still runs on the mock DB until the full swap.
export const API_BASE = ((import.meta as any).env?.VITE_API_URL as string | undefined) ?? 'http://localhost:4000/api'

async function postJson(path: string, body: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as any)?.message ?? (data as any)?.error ?? `request_failed_${res.status}`)
  return data
}

export const authApi = {
  async login(email: string, password: string): Promise<{ accessToken: string; user: Profile; isNew: boolean }> {
    return postJson('/auth/login', { email, password }) as Promise<{ accessToken: string; user: Profile; isNew: boolean }>
  },
  async register(payload: { full_name: string; email: string; password: string; user_type?: Profile['user_type'] }): Promise<{ accessToken: string; user: Profile; isNew: boolean }> {
    return postJson('/auth/register', payload) as Promise<{ accessToken: string; user: Profile; isNew: boolean }>
  },
  async logout(): Promise<void> {
    try {
      await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' })
    } catch {
      /* ignore network errors on logout */
    }
  },
  /** Permanently delete the current account. Requires proof of identity:
   *  - password account: pass `current` (must match).
   *  - Google-only account: pass `confirm` equal to the account email. */
  async deleteAccount(payload: { current?: string; confirm?: string } = {}): Promise<void> {
    await apiFetch('/auth/delete-account', { method: 'POST', body: JSON.stringify(payload) })
  },
  /** Set or change the account password. For Google-only accounts
   *  (password_hash is null) `current` is not required — the user is setting a
   *  password for the first time. For email/password accounts, `current` must
   *  verify the existing password before it can be changed. */
  async changePassword(payload: { current?: string; next: string }): Promise<void> {
    await apiFetch('/auth/change-password', { method: 'POST', body: JSON.stringify(payload) })
  },
  /** Fresh profile for the current token — used to refresh a persisted session
   *  (e.g. so is_admin / plan changes show up without re-logging-in). */
  async me(): Promise<Profile | null> {
    try {
      return await cached('auth:me', () => apiFetch('/auth/me') as Promise<Profile>, 60_000)
    } catch {
      return null
    }
  },
  /** Google OAuth entry point.
   *  The server's `/oauth/google` is a GET that 302-redirects the browser to
   *  Google's consent screen (PKCE state in an httpOnly cookie), so we hand
   *  back the URL and let the caller navigate via `window.location` — not a
   *  fetch (which would follow the redirect and never leave the SPA). */
  async googleAuthUrl(returnTo?: string): Promise<{ url: string }> {
    const params = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''
    return { url: `${API_BASE}/oauth/google${params}` }
  },
  /** Complete onboarding after role selection (called from RoleSelection page) */
  async completeOnboarding(payload: { user_type: Profile['user_type']; returnTo?: string }): Promise<{ accessToken: string; user: Profile }> {
    return apiFetch('/auth/complete-onboarding', { method: 'POST', body: JSON.stringify(payload) }) as Promise<{ accessToken: string; user: Profile }>
  },
  /** Handle pending Google account linking */
  async linkGoogle(payload: { email: string; password: string }): Promise<{ accessToken: string; user: Profile }> {
    return apiFetch('/auth/link-google', { method: 'POST', body: JSON.stringify(payload) }) as Promise<{ accessToken: string; user: Profile }>
  },
}

// Establish a session on app load *without* a pre-existing access token. The
// OAuth callback (and email/password login) set the httpOnly `optryva_rt`
// refresh cookie; trading it for a fresh access token here lets a brand-new
// Google user (who has no token in localStorage yet) reach /app or
// /role-selection without being bounced to /login. Returns true if a session
// was restored or bootstrapped.
export async function bootstrapSession(): Promise<boolean> {
  // The OAuth callback (and every login) sets the httpOnly `optryva_rt` refresh
  // cookie but not a localStorage access token. Trade that cookie for a fresh,
  // guaranteed-valid access token first — this is the reliable source of truth
  // after a reload and avoids sending a possibly-expired persisted token (which
  // would 401 before the per-request refresh kicks in). It also ensures the
  // session store (userId) is populated so route guards don't bounce a valid user.
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as { accessToken?: string } | null
      const token = data?.accessToken
      if (token) {
        setAuthToken(token)
        persistToken(token)
        const profile = await authApi.me()
        if (profile) {
          const { useSession } = await import('@/lib/store')
          useSession.getState().login(profile, token)
          return true
        }
      }
    }
  } catch {
    /* fall through to token validation */
  }
  // No/invalid refresh cookie: if we already hold an access token, validate it.
  if (authToken) {
    try {
      const profile = await authApi.me()
      if (profile) {
        const { useSession } = await import('@/lib/store')
        useSession.getState().login(profile, authToken)
        return true
      }
    } catch {
      /* invalid */
    }
  }
  return false
}

export const onboardingApi = {
  async getProgress(): Promise<any> {
    return apiFetch('/onboarding/progress')
  },
  async saveProgress(data: { current_step?: number; completed_steps?: number; skipped_steps?: string; step_data?: any }): Promise<{ ok: boolean }> {
    return apiFetch('/onboarding/progress', { method: 'PATCH', body: JSON.stringify(data) })
  },
  async saveCareerDirection(direction: string, customDirection?: string): Promise<{ ok: boolean }> {
    return apiFetch('/onboarding/step/career-direction', { method: 'POST', body: JSON.stringify({ direction, custom_direction: customDirection }) })
  },
  async saveResume(cv_text?: string, cv_url?: string, cv_filename?: string): Promise<{ ok: boolean }> {
    return apiFetch('/onboarding/step/resume', { method: 'POST', body: JSON.stringify({ cv_text, cv_url, cv_filename }) })
  },
  async saveEvidence(evidence_ids: string[]): Promise<{ ok: boolean }> {
    return apiFetch('/onboarding/step/evidence', { method: 'POST', body: JSON.stringify({ evidence_ids }) })
  },
  async savePreferences(prefs: any): Promise<{ ok: boolean }> {
    return apiFetch('/onboarding/step/preferences', { method: 'POST', body: JSON.stringify(prefs) })
  },
  async savePrivacy(consents: any): Promise<{ ok: boolean; complete?: boolean }> {
    return apiFetch('/onboarding/step/privacy', { method: 'POST', body: JSON.stringify(consents) })
  },
  async skipStep(step: number): Promise<{ ok: boolean }> {
    return apiFetch('/onboarding/skip-step', { method: 'POST', body: JSON.stringify({ step }) })
  },
}

// Access token for authenticated requests. Seeded from the persisted session so
// it survives a page refresh; the session store keeps it in sync on login/logout.
let authToken: string | null = null
try {
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('optryva-session-v2') : null
  if (raw) authToken = JSON.parse(raw)?.state?.token ?? null
} catch {
  /* ignore */
}
export function setAuthToken(t: string | null) {
  authToken = t
}

const SESSION_KEY = 'optryva-session-v2'

/** Keep the persisted session token in sync (so a reload uses the fresh token). */
function persistToken(token: string) {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 }
    parsed.state = { ...(parsed.state ?? {}), token }
    localStorage.setItem(SESSION_KEY, JSON.stringify(parsed))
  } catch {
    /* ignore */
  }
}

function rawFetch(path: string, init: RequestInit) {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(init.headers ?? {}),
    },
    credentials: 'include',
  })
}

// Single-flight access-token refresh using the httpOnly refresh cookie.
let refreshing: Promise<boolean> | null = null
function refreshAccessToken(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
        if (!res.ok) return false
        const data = await res.json().catch(() => ({}))
        if (!(data as any)?.accessToken) return false
        setAuthToken((data as any).accessToken)
        persistToken((data as any).accessToken)
        return true
      } catch {
        return false
      } finally {
        refreshing = null
      }
    })()
  }
  return refreshing
}

function handleAuthFailure() {
  setAuthToken(null)
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    window.location.href = '/login'
  }
}

/** Like rawFetch but refreshes the access token once on a 401 and retries —
 *  returning the raw Response (used by the streaming paths, which need the
 *  body stream rather than parsed JSON). Without this, an expired access token
 *  makes every SSE request 401 and silently fall back to the non-streaming
 *  endpoint, so progress (e.g. the matching percentage) never shows. */
async function rawFetchAuthed(path: string, init: RequestInit = {}): Promise<Response> {
  let res = await rawFetch(path, init)
  if (res.status === 401) {
    const ok = await refreshAccessToken()
    if (ok) res = await rawFetch(path, init)
  }
  return res
}

/** Authenticated fetch against the real server (Bearer token + cookies).
 *  On a 401, transparently refresh the access token once and retry. */
async function apiFetch(path: string, init: RequestInit = {}) {
  startLoad()
  const start = performance.now()
  try {
    let res = await rawFetch(path, init)
  if (res.status === 401) {
    const ok = await refreshAccessToken()
    if (ok) {
      res = await rawFetch(path, init)
    } else {
      handleAuthFailure()
      throw new Error('unauthorized')
    }
  }
  if (res.status === 204) return null
  const data = await res.json().catch(() => ({}))
  if ((import.meta as any).env?.DEV ?? false) {
    const ms = Math.round((performance.now() - start) * 10) / 10
    console.log(`[Optryva perf] api ${init.method ?? 'GET'} ${path}  →  ${res.status} ${ms}ms`)
  }
  if (!res.ok) throw new Error((data as any)?.message ?? (data as any)?.error ?? `request_failed_${res.status}`)
  return data
  } finally {
    endLoad()
  }
}

export async function fetchProtectedDocument(url: string): Promise<string> {
  let path = url
  try { path = new URL(url, window.location.origin).pathname } catch { /* use the supplied path */ }
  if (path.startsWith('/api')) path = path.slice(4)
  const res = await rawFetchAuthed(path)
  if (!res.ok) throw new Error(`document_request_failed_${res.status}`)
  return URL.createObjectURL(await res.blob())
}

/* ----------------------------- Profiles (real backend) ----------------------------- */
// Profiles — students, companies, and schools — come from the Supabase-backed server.
export const profilesApi = {
  async get(id: string): Promise<Profile | null> {
    try {
      return (await apiFetch(`/profiles/${id}`)) as Profile
    } catch {
      return null
    }
  },
   async update(id: string, patch: Partial<Profile>): Promise<Profile | null> {
    invalidateCache('profiles:list:all', 'profiles:list:company', 'profiles:list:school')
    return (await apiFetch(`/profiles/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })) as Profile
  },
  async updateSkills(id: string, skills: string[]): Promise<Profile | null> {
    invalidateCache('profiles:list:all', 'profiles:list:company', 'profiles:list:school')
    return (await apiFetch(`/profiles/${id}`, { method: 'PATCH', body: JSON.stringify({ skills }) })) as Profile
  },
  async list(
    type?: Profile['user_type'],
    opts?: { ids?: string[]; types?: string[]; limit?: number; offset?: number },
  ): Promise<Profile[]> {
    const params = new URLSearchParams()
    if (type) params.set('type', type)
    if (opts?.types?.length) params.set('types', opts.types.join(','))
    if (opts?.ids?.length) params.set('ids', opts.ids.join(','))
    if (opts?.limit != null) params.set('limit', String(opts.limit))
    if (opts?.offset != null) params.set('offset', String(opts.offset))
    const qs = params.toString()
    const key = `profiles:list:${type ?? 'all'}:${opts?.types?.join(',') ?? ''}:${opts?.ids?.join(',') ?? ''}:${opts?.limit ?? ''}:${opts?.offset ?? ''}`
    return cached(key, () =>
      apiFetch(`/profiles${qs ? `?${qs}` : ''}`) as Promise<Profile[]>,
    )
  },
}

export const resumesApi = {
  async list(): Promise<ResumeProfile[]> {
    return (await apiFetch('/resumes')) as ResumeProfile[]
  },
  async create(payload: Omit<ResumeProfile, 'id' | 'student_id' | 'created_at' | 'updated_at'>): Promise<ResumeProfile> {
    return (await apiFetch('/resumes', { method: 'POST', body: JSON.stringify(payload) })) as ResumeProfile
  },
  async update(id: string, patch: Partial<ResumeProfile>): Promise<ResumeProfile> {
    return (await apiFetch(`/resumes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })) as ResumeProfile
  },
  async remove(id: string): Promise<void> {
    await apiFetch(`/resumes/${id}`, { method: 'DELETE' })
  },
  async setActive(id: string): Promise<ResumeProfile> {
    return (await apiFetch(`/resumes/${id}`, { method: 'PATCH', body: JSON.stringify({ active: true }) })) as ResumeProfile
  },
}

/* ----------------------------- Jobs ----------------------------- */
// Jobs now come from the Supabase-backed server. The server enforces year/school
// visibility for the authenticated viewer, so `list()` ignores its argument
// (kept for call-site compatibility).
export const jobsApi = {
  async list(_viewer?: Profile | null, ids?: string[], opts?: { detail?: boolean }): Promise<JobListing[]> {
    const qs = new URLSearchParams()
    if (ids) qs.set('ids', ids.join(','))
    if (opts?.detail) qs.set('detail', '1')
    const qsStr = qs.toString() ? `?${qs.toString()}` : ''
    // `detail` (full descriptions) is a different payload, so cache it under a
    // distinct key — the dashboard's lean list must not poison the Opportunities view.
    const key = `jobs:list:${ids ? ids.join(',') : 'all'}:${opts?.detail ? 'detail' : 'lean'}`
    return cached(key, () => apiFetch(`/jobs${qsStr}`) as Promise<JobListing[]>)
  },
  async get(id: string): Promise<JobListing | null> {
    try {
      return (await apiFetch(`/jobs/${id}`)) as JobListing
    } catch {
      return null
    }
  },
  async byCompany(companyId: string): Promise<JobListing[]> {
    return cached('jobs:company', () => apiFetch(`/jobs/company/${companyId}`) as Promise<JobListing[]>, 60_000)
  },
  async create(job: Omit<JobListing, 'id' | 'created_at'>): Promise<JobListing> {
    invalidateCache()
    return (await apiFetch('/jobs', { method: 'POST', body: JSON.stringify(job) })) as JobListing
  },
  async update(id: string, patch: Partial<JobListing>): Promise<JobListing | null> {
    invalidateCache()
    return (await apiFetch(`/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })) as JobListing
  },
  async remove(id: string): Promise<boolean> {
    invalidateCache()
    await apiFetch(`/jobs/${id}`, { method: 'DELETE' })
    return true
  },
  // External-apply listings: record that someone opened the apply link. Best-effort.
  async trackOpen(id: string): Promise<void> {
    try {
      await apiFetch(`/jobs/${id}/open`, { method: 'POST' })
    } catch {
      /* tracking is non-critical — never block the apply */
    }
  },
  // Unique opens per listing for the current company (job_id -> count).
  async openCounts(): Promise<Record<string, number>> {
    try {
      return await cached('jobs:opens', () => apiFetch('/jobs/opens/mine') as Promise<Record<string, number>>, 60_000)
    } catch {
      return {}
    }
  },
  // Employer Smart Shortlist (Optryva AI Smart): matched students for a posted job,
  // enriched with a Mistral employer-facing decision aid when available.
  async shortlist(jobId: string): Promise<SmartShortlistResponse> {
    return (await apiFetch(`/jobs/${jobId}/shortlist`)) as SmartShortlistResponse
  },
  // Employer-initiated full re-score of every applicant for a job.
  async rescoreShortlist(jobId: string): Promise<SmartShortlistResponse> {
    return (await apiFetch(`/jobs/${jobId}/shortlist/rescore`, { method: 'POST' })) as SmartShortlistResponse
  },
  // Employer AI research: free-form question about one candidate (candidateId) or
  // the whole applicant pipeline for a job.
  async research(jobId: string, question: string, candidateId?: string): Promise<{ answer: string }> {
    return (await apiFetch(`/jobs/${jobId}/research`, {
      method: 'POST',
      body: JSON.stringify({ question, candidateId }),
    })) as { answer: string }
  },
}

export interface SmartShortlistCandidate {
  student_id: string
  resume_id: string | null
  name: string
  avatar_url: string | null
  major: string | null
  location: string | null
  skills: string[]
  applied: boolean
  application_id: string | null
  application_status: string | null
  score: number
  score_unavailable?: boolean
  matched_skills: string[]
  reasons: string[]
  mismatch_flags: string[]
  breakdown?: { skills?: number; experience?: number; location?: number; compensation?: number } | null
  assessment_status?: string | null
  assessment_score?: number | null
  assessment_feedback?: { overall: string; perQuestion: { id: string; feedback: string }[] } | null
  matched_resume_id?: string | null
  matched_resume_name?: string | null
  current_resume_id?: string | null
  resume_changed?: boolean
  category?: 'not_qualified' | 'insufficient_evidence' | 'potential_fit' | null
  fit_score?: number
  verdict?: 'strong' | 'possible' | 'weak' | null
  decision_note?: string | null
  fit_strengths?: string[]
  fit_gaps?: string[]
}

export interface SmartShortlistResponse {
  job_id: string
  mistral: boolean
  summary: string | null
  candidates: SmartShortlistCandidate[]
  note?: string
  // Scoring progress: how many applicants have a real match score vs the total.
  scored?: number
  total?: number
  job?: {
    id: string
    title: string
    description: string
    company_name: string
    company_id: string
    location: string
    country: string
    remote: boolean
    pay: string
    duration: string
    listing_type: string
    tags: string[]
    responsibilities: string[]
    qualifications: string[]
    benefits: string[]
  }
  cached?: boolean
  computed_at?: string
  rescored?: boolean
}

/* ----------------------------- Applications (real backend) ----------------------------- */
// Talks to the Supabase-backed server. Creating an application notifies the
// company; a status change notifies the student (server-side, in `notify`).
export const applicationsApi = {
  async byStudent(_studentId: string): Promise<Application[]> {
    return cached(`apps:student:${_studentId}`, () => apiFetch('/applications/mine') as Promise<Application[]>)
  },
  async byJob(jobId: string, archived = false): Promise<Application[]> {
    const key = archived ? `apps:job:${jobId}:archived` : `apps:job:${jobId}`
    return cached(key, () => apiFetch(`/applications/job/${jobId}${archived ? '?archived=1' : ''}`) as Promise<Application[]>, 60_000)
  },
  async archive(id: string): Promise<Application | null> {
    invalidateCache()
    return (await apiFetch(`/applications/${id}/archive`, { method: 'PATCH' })) as Application
  },
  async restore(id: string): Promise<Application | null> {
    invalidateCache()
    return (await apiFetch(`/applications/${id}/restore`, { method: 'PATCH' })) as Application
  },
  async byCompany(_companyId: string): Promise<Application[]> {
    return cached('apps:company', () => apiFetch('/applications/company') as Promise<Application[]>, 60_000)
  },
  async get(id: string): Promise<Application | null> {
    try {
      return (await apiFetch(`/applications/${id}`)) as Application
    } catch {
      return null
    }
  },
  async create(app: Omit<Application, 'id' | 'created_at' | 'timeline' | 'status'>): Promise<Application> {
    invalidateCache(`apps:student:${app.student_id}`)
    return (await apiFetch('/applications', { method: 'POST', body: JSON.stringify(app) })) as Application
  },
  async saveDraft(app: Omit<Application, 'id' | 'created_at' | 'timeline' | 'status'>): Promise<Application> {
    invalidateCache(`apps:student:${app.student_id}`)
    return (await apiFetch('/applications/draft', { method: 'PUT', body: JSON.stringify(app) })) as Application
  },
  async getDraft(jobId: string): Promise<Application | null> {
    try {
      return (await apiFetch(`/applications/draft/${jobId}`)) as Application
    } catch {
      return null
    }
  },
  async setStatus(id: string, status: ApplicationStatus, reason?: string): Promise<Application | null> {
    invalidateCache()
    return (await apiFetch(`/applications/${id}/status`, { method: 'PATCH', body: JSON.stringify(reason !== undefined ? { status, reason } : { status }) })) as Application
  },
  async review(id: string, body: { assignment_score?: number; decision_reason?: string; tags?: string[] }): Promise<Application | null> {
    invalidateCache()
    return (await apiFetch(`/applications/${id}/review`, { method: 'PATCH', body: JSON.stringify(body) })) as Application
  },
  async scoreAssignment(id: string): Promise<Application | null> {
    invalidateCache()
    return (await apiFetch(`/applications/${id}/score-assignment`, { method: 'POST' })) as Application
  },
  async remove(id: string): Promise<boolean> {
    invalidateCache()
    await apiFetch(`/applications/${id}`, { method: 'DELETE' })
    return true
  },
  // Records an integrity violation (e.g. proctor cancel) so the candidate can't
  // re-take the test for this job. Returns the (cancelled) application.
  async proctorCancel(app: { job_id: string; reason: string }): Promise<Application> {
    return (await apiFetch('/applications/proctor-cancel', { method: 'POST', body: JSON.stringify(app) })) as Application
  },
  // Submits the completed proctored test for an already-submitted application
  // (apply-first flow). Returns the updated application with scoring.
  async submitAssignment(id: string, payload: { assignment_answers: any[]; duration_seconds?: number }): Promise<Application> {
    invalidateCache()
    return (await apiFetch(`/applications/${id}/assignment`, { method: 'PATCH', body: JSON.stringify(payload) })) as Application
  },
  // Employer override: re-open the test for a candidate who failed / exhausted
  // attempts, so they can take it again. Returns the updated application.
  async unlockTest(id: string): Promise<Application> {
    invalidateCache()
    return (await apiFetch(`/applications/${id}/unlock-test`, { method: 'POST' })) as Application
  },
}

/* ----------------------------- Messaging ----------------------------- */
export interface Conversation {
  thread_id: string
  scope: 'application' | 'dm'
  counterpartId: string
  jobTitle?: string
  lastBody?: string
  lastAt?: string
  unread: number
}

// Messaging — real backend (Supabase). Application + DM threads. Near real-time
// via short-interval polling in the Messages page.
export const messagesApi = {
  async conversations(_userId: string, opts?: { limit?: number }): Promise<Conversation[]> {
    const q = opts?.limit ? `?limit=${opts.limit}` : ''
    return cached(`msgs:conv:${_userId}${q}`, () => apiFetch(`/messages/conversations${q}`) as Promise<Conversation[]>)
  },
  async markThreadRead(threadId: string, _userId: string) {
    invalidateCache(`msgs:conv:${_userId}`)
    await apiFetch(`/messages/thread/${threadId}/read`, { method: 'POST' })
    return true
  },
  async thread(threadId: string, opts?: { limit?: number; before?: string }): Promise<Message[]> {
    const qs = new URLSearchParams()
    if (opts?.limit) qs.set('limit', String(opts.limit))
    if (opts?.before) qs.set('before', opts.before)
    const q = qs.toString()
    return (await apiFetch(`/messages/thread/${threadId}${q ? `?${q}` : ''}`)) as Message[]
  },
  async send(msg: Omit<Message, 'id' | 'created_at' | 'reactions' | 'read'>) {
    return apiFetch('/messages', {
      method: 'POST',
      body: JSON.stringify({
        thread_id: msg.thread_id,
        scope: msg.scope,
        kind: msg.kind ?? 'text',
        body: msg.body,
        attachment: (msg as { attachment?: unknown }).attachment,
      }),
    })
  },
  async react(id: string, emoji: string, _userId: string) {
    await apiFetch(`/messages/${id}/react`, { method: 'POST', body: JSON.stringify({ emoji }) })
    return true
  },
  async remove(id: string) {
    await apiFetch(`/messages/${id}`, { method: 'DELETE' })
    return true
  },
  /** Open (or get the id of) a DM thread with another user. */
  async startDm(otherId: string): Promise<string> {
    const r = (await apiFetch(`/messages/dm/${otherId}`, { method: 'POST' })) as { thread_id: string }
    return r.thread_id
  },
}

/* ----------------------------- Skills ----------------------------- */
export const skillsApi = {
  async list() {
    return delay(db.studentSkills)
  },
  async byOwner(ownerId: string) {
    return delay(db.studentSkills.filter((s) => s.owner_id === ownerId))
  },
  async create(skill: Omit<StudentSkill, 'id' | 'sessions' | 'rating' | 'rating_count' | 'verified'>) {
    const created: StudentSkill = {
      ...skill,
      id: uid('sk'),
      verified: false,
      sessions: 0,
      rating: 0,
      rating_count: 0,
    }
    db.studentSkills.unshift(created)
    return delay(created)
  },
  async book(booking: Omit<SkillBooking, 'id' | 'created_at'>, bookerName: string) {
    const created: SkillBooking = { ...booking, id: uid('bk'), created_at: new Date().toISOString() }
    db.skillBookings.push(created)
    const skill = db.studentSkills.find((s) => s.id === booking.skill_id)
    if (skill) {
      skill.sessions += 1
      const thread = dmThreadId(booking.booker_id, skill.owner_id)
      db.messages.push({
        id: uid('m'),
        thread_id: thread,
        scope: 'dm',
        sender_id: booking.booker_id,
        kind: 'text',
        body: `📅 Session request for "${skill.skill}" — preferred ${new Date(
          booking.preferred_at,
        ).toLocaleString()}.${booking.message ? `\n\n${booking.message}` : ''}`,
        reactions: {},
        read: false,
        created_at: new Date().toISOString(),
      })
      db.notifications.unshift({
        id: uid('n'),
        user_id: skill.owner_id,
        type: 'booking',
        title: 'New session request',
        body: `${bookerName} requested a "${skill.skill}" session.`,
        read: false,
        ref_id: thread,
        created_at: new Date().toISOString(),
      })
      return delay({ booking: created, threadId: thread })
    }
    return delay({ booking: created, threadId: '' })
  },
}

/* ----------------------------- Resources ----------------------------- */
export const resourcesApi = {
  async list() {
    return delay(db.resources)
  },
  async create(r: Omit<Resource, 'id' | 'created_at' | 'sales'>) {
    const created: Resource = { ...r, id: uid('r'), sales: 0, created_at: new Date().toISOString() }
    db.resources.unshift(created)
    return delay(created)
  },
}

/* ----------------------------- Housing ----------------------------- */
export const housingApi = {
  async list() {
    return delay(
      db.housing
        .filter((h) => h.status === 'active')
        .sort((a, b) => Number(b.urgent) - Number(a.urgent)),
    )
  },
  async create(h: Omit<HousingRequest, 'id' | 'created_at' | 'status'>) {
    const created: HousingRequest = {
      ...h,
      id: uid('h'),
      status: 'active',
      created_at: new Date().toISOString(),
    }
    db.housing.unshift(created)
    db.notifications.unshift({
      id: uid('n'),
      user_id: h.poster_id,
      type: 'housing',
      title: 'Housing post published',
      body: `Your post "${h.title}" is live.`,
      read: false,
      ref_id: created.id,
      created_at: new Date().toISOString(),
    })
    return delay(created)
  },
}

/* ----------------------------- Guides ----------------------------- */
export const guidesApi = {
  async list() {
    return delay(db.relocationGuides)
  },
}

/* ----------------------------- Follows & Ratings ----------------------------- */
// Follows — real backend. A student's follows live in `company_follows`, so the
// server can notify followers when a company they follow posts a new role.
export const followsApi = {
  async forStudent(_studentId: string): Promise<{ company_id: string; email_notifications: boolean }[]> {
    return (await apiFetch('/social/follows/mine')) as { company_id: string; email_notifications: boolean }[]
  },
  async isFollowing(studentId: string, companyId: string): Promise<boolean> {
    const mine = await this.forStudent(studentId)
    return mine.some((f) => f.company_id === companyId)
  },
  async toggle(_studentId: string, companyId: string): Promise<boolean> {
    const r = (await apiFetch(`/social/follows/${companyId}/toggle`, { method: 'POST' })) as { following: boolean }
    return r.following
  },
  async followerCount(companyId: string): Promise<number> {
    const r = (await apiFetch(`/social/follows/count/${companyId}`)) as { count: number }
    return r.count ?? 0
  },
  /** Batched follower counts keyed by company_id — one request instead of N. */
  async followerCounts(ids: string[]): Promise<Record<string, number>> {
    if (!ids.length) return {}
    try {
      return (await apiFetch(`/social/follows/counts?ids=${encodeURIComponent(ids.join(','))}`)) as Record<string, number>
    } catch {
      return {}
    }
  },
  async setEmailPref(_studentId: string, companyId: string, on: boolean): Promise<boolean> {
    await apiFetch(`/social/follows/${companyId}/email`, { method: 'POST', body: JSON.stringify({ on }) })
    return true
  },
}

export const ratingsApi = {
  async forRef(refType: Rating['ref_type'], refId: string): Promise<Rating[]> {
    return (await apiFetch(`/social/ratings/${refType}/${refId}`)) as Rating[]
  },
  async rate(r: Omit<Rating, 'id' | 'created_at'>): Promise<{ id: string }> {
    return (await apiFetch('/social/ratings', {
      method: 'POST',
      body: JSON.stringify({ ref_type: r.ref_type, ref_id: r.ref_id, stars: r.stars, comment: r.comment }),
    })) as { id: string }
  },
}

/* ----------------------------- Notifications (real backend) ----------------------------- */
export const notificationsApi = {
  async forUser(_userId: string): Promise<AppNotification[]> {
    return (await apiFetch('/notifications')) as AppNotification[]
  },
  async markRead(id: string): Promise<boolean> {
    await apiFetch(`/notifications/${id}/read`, { method: 'POST' })
    return true
  },
  async markAllRead(_userId: string): Promise<boolean> {
    await apiFetch('/notifications/read-all', { method: 'POST' })
    return true
  },
}

/* ----------------------------- Payments ----------------------------- */
export const paymentsApi = {
  async forUser(userId: string) {
    return delay(db.payments.filter((p) => p.user_id === userId))
  },
  async checkout(p: Omit<Payment, 'id' | 'created_at' | 'status'>) {
    // Mock Stripe-style checkout: always succeeds after a short delay.
    const created: Payment = {
      ...p,
      id: uid('p'),
      status: 'paid',
      created_at: new Date().toISOString(),
    }
    db.payments.unshift(created)
    db.notifications.unshift({
      id: uid('n'),
      user_id: p.user_id,
      type: 'payment',
      title: 'Payment successful',
      body: `${p.label} — paid.`,
      read: false,
      created_at: new Date().toISOString(),
    })
    return delay(created, 1400)
  },
}

/* ----------------------------- AI — offline TEXT fallback ----------------------------- */
// Canned text fallbacks for the NON-scoring AI features (coach, research, chat,
// CV tips) so those still respond when the server is unreachable. There is NO
// local match scoring — matching is Claude-only (server). When the server can't
// score, match surfaces return null / empty rather than a fabricated number.
const mockAi = {
  async coach(student: Profile, job: JobListing) {
    const draft = `As a ${student.year ? `Year ${student.year} ` : ''}${student.major ?? 'student'}, I'm excited to apply for the ${job.title} role at the company behind this listing. My hands-on work with ${(student.skills ?? []).slice(0, 3).join(', ')} maps directly to what you're building. In a recent project I shipped a production feature end-to-end, and I'd bring that same ownership here. I'm drawn to this role because it sits at the intersection of ${job.type} and real impact — exactly where I want to grow.`
    const critique = {
      strengths: ['Concrete skills named', 'Clear motivation', 'First-person and specific'],
      weaknesses: ['Opening is slightly generic', 'Could quantify the project impact'],
      missing: ['A metric or outcome from the named project'],
      verdict: 'refine' as const,
    }
    const final = `I'm a ${student.year ? `Year ${student.year} ` : ''}${student.major ?? 'student'} who ships. The ${job.title} role stood out because it pairs ${job.tags.slice(0, 2).join(' and ')} with real ownership — my favourite combination. Recently I built and shipped a production feature used by thousands of users, working across ${(student.skills ?? []).slice(0, 3).join(', ')}. I move fast, sweat the details, and learn relentlessly. I'd love to bring that energy to your team.`
    return delay({ draft, critique, final }, 1600)
  },

  async companyResearch(companyName: string, role?: string) {
    return delay(
      {
        overview: `${companyName} is a fast-growing company in its space, building products with real traction across multiple markets. It has a reputation for shipping quickly and investing in early-career talent.`,
        culture: `Interns and new hires report genuine ownership, supportive mentorship, and an async, outcomes-focused environment. Expect to contribute to real work early.`,
        opportunity: `For an ambitious early-career candidate, ${companyName} offers strong learning velocity, exposure to production systems, and a global, diverse team.`,
        red_flags: `As with any high-growth company, scope can shift quickly and processes are still maturing — clarify expectations and review cadence up front.`,
        questions: [
          `What does success look like in the first 90 days of ${role ?? 'this role'}?`,
          `How is feedback and mentorship structured for early-career hires?`,
          `What's the team's approach to work-life balance during crunch periods?`,
        ],
        verdict: `A strong fit for a self-driven learner who wants real impact early — go for it.`,
      },
      900,
    )
  },

  /**
   * AI sourcing engine (Accio-style): the user describes in plain language what they
   * want, and the AI "finds" matching opportunities from the catalog with reasoning.
   */
  async sourceOpportunities(query: string, jobs: JobListing[], student: Profile) {
    const q = query.toLowerCase()
    const wantRemote = /\bremote\b|work from home|anywhere/.test(q)
    const wantPaid = /\bpaid\b|stipend|salary|well[- ]?paid/.test(q)
    const wantVisa = /visa|sponsor|relocat/.test(q)
    let wantType: string | null = null
    if (/intern/.test(q)) wantType = 'Internship'
    else if (/full[- ]?time|new grad|graduate role|permanent/.test(q)) wantType = 'Full-time'
    else if (/fellow/.test(q)) wantType = 'Fellowship'
    else if (/part[- ]?time/.test(q)) wantType = 'Part-time'

    // pay threshold like "$2000", "2k", "over 2000"
    let minPay = 0
    const payMatch = q.match(/(\d[\d,\.]*)\s*k|\$\s*(\d[\d,\.]*)/)
    if (payMatch) {
      const raw = payMatch[1] ?? payMatch[2] ?? ''
      const n = parseFloat(raw.replace(/,/g, ''))
      minPay = /k/.test(payMatch[0]) ? n * 1000 : n
    }

    // country detection from the jobs' own countries
    const countries = Array.from(new Set(jobs.map((j) => j.country)))
    const wantCountry = countries.find((c) => c !== 'Remote' && q.includes(c.toLowerCase())) ?? null

    // field detection
    const fields = ['Software Engineering', 'Data', 'Design', 'Marketing', 'Operations', 'Finance', 'Product']
    const fieldHints: Record<string, RegExp> = {
      'Software Engineering': /software|developer|engineer|frontend|backend|coding|web|mobile/,
      Data: /data|machine learning|\bml\b|analyt|scientist/,
      Design: /design|ux|ui|figma/,
      Marketing: /marketing|content|social|growth|community/,
      Operations: /operations|ops|process/,
      Finance: /finance|fp&a|account|investment/,
      Product: /product|\bpm\b|roadmap/,
    }
    const wantFields = fields.filter((f) => fieldHints[f]?.test(q))

    function payNumber(pay?: string) {
      if (!pay) return 0
      const m = pay.replace(/,/g, '').match(/(\d[\d.]*)\s*k/i) || pay.replace(/,/g, '').match(/(\d[\d.]*)/)
      if (!m) return 0
      const n = parseFloat(m[1])
      return /k/i.test(pay) ? n * 1000 : n
    }

    const scored = jobs
      .map((job) => {
        const why: string[] = []
        let score = seededScore(`${student.id}:${job.id}`, 38, 97) / 2 // base affinity
        let hardFail = false

        if (wantRemote) {
          if (job.remote) { score += 18; why.push('Remote ✓') } else hardFail = true
        }
        if (wantType) {
          if (job.listing_type === wantType) { score += 16; why.push(`${wantType} ✓`) } else hardFail = true
        }
        if (wantCountry) {
          if (job.country === wantCountry) { score += 16; why.push(`${wantCountry} ✓`) } else hardFail = true
        }
        if (wantFields.length) {
          if (wantFields.includes(job.type)) { score += 16; why.push(`${job.type} role`) } else hardFail = true
        }
        if (minPay > 0) {
          if (payNumber(job.pay) >= minPay) { score += 12; why.push('Meets your pay bar ✓') } else if (payNumber(job.pay) > 0) hardFail = true
        }
        if ((wantPaid || wantVisa) && job.remote) why.push(wantVisa ? 'Remote — easier across borders' : 'Paid role')

        // skill overlap bonus + reasoning
        const overlap = job.tags.filter((t) =>
          (student.skills ?? []).some((s) => s.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(s.toLowerCase())),
        )
        if (overlap.length) {
          score += overlap.length * 4
          why.push(`Uses your ${overlap.slice(0, 2).join(' & ')}`)
        }
        return { job, why, score: Math.min(99, Math.round(score)), hardFail }
      })
      // If the user stated hard constraints, drop the misses; otherwise keep & rank all.
      .filter((r) => !r.hardFail)
      .sort((a, b) => b.score - a.score)

    const results = scored.slice(0, 8)
    const bits: string[] = []
    if (wantType) bits.push(wantType.toLowerCase() + (wantType === 'Internship' ? 's' : ' roles'))
    else bits.push('opportunities')
    if (wantFields.length) bits.push(`in ${wantFields.join('/')}`)
    if (wantRemote) bits.push('that are remote')
    if (wantCountry) bits.push(`in ${wantCountry}`)
    if (minPay > 0) bits.push(`paying around ${minPay >= 1000 ? `$${minPay / 1000}k+` : `$${minPay}+`}`)

    const summary =
      results.length === 0
        ? `I couldn't find a perfect match for that. Try relaxing one constraint — for example, allow remote roles or a different country.`
        : `I found ${results.length} ${bits.join(' ')} for you, ranked by fit. The top result aligns best with your profile${
            (student.skills ?? []).length ? ` and skills like ${(student.skills ?? []).slice(0, 2).join(', ')}` : ''
          }.`

    return delay({ summary, results }, 1300)
  },

  /** User describes what they want researched about a role/company → AI answers. */
  async researchAsk(companyName: string, role: string | undefined, question: string) {
    const q = question.trim()
    const lower = q.toLowerCase()
    let answer: string
    if (/visa|sponsor|relocat|work permit/.test(lower)) {
      answer = `${companyName} hires across multiple countries and ${role ? `the ${role} role ` : 'many roles '}can be remote-friendly. For visa sponsorship or relocation support, confirm directly — early-career roles vary. Ask in your first call: "Is this position open to international candidates, and do you support visas/relocation?"`
    } else if (/salary|pay|compensation|money|stipend/.test(lower)) {
      answer = `Based on the listing and market data, the pay for ${role ?? 'this role'} at ${companyName} is competitive for an early-career candidate in this region. There's usually room to negotiate on start date, learning budget, and remote stipend. Anchor your ask to the value you'll deliver in the first 90 days.`
    } else if (/interview|process|hire|round/.test(lower)) {
      answer = `A typical process at a company like ${companyName} is: (1) application screen, (2) a recruiter chat, (3) a technical or portfolio round tied to ${role ?? 'the role'}, and (4) a values/team-fit conversation. Prepare 2–3 concrete stories that show ownership and impact.`
    } else if (/culture|work life|balance|remote|team/.test(lower)) {
      answer = `${companyName} leans toward an outcomes-focused, collaborative culture with real ownership early on. Expect autonomy paired with mentorship. To gauge balance, ask how the team handles deadlines and what a normal week looks like for ${role ?? 'this role'}.`
    } else if (/growth|career|promot|learn/.test(lower)) {
      answer = `For an ambitious early-career candidate, ${companyName} offers strong learning velocity and exposure to real production work. Growth tends to follow impact — ask about how progression and feedback work for ${role ?? 'this role'} in the first year.`
    } else {
      answer = `Here's what I found on "${q}" for ${role ?? 'this role'} at ${companyName}: it's a strong, fast-moving environment where early-career talent gets real responsibility. ${companyName} values self-driven people who ship. To go deeper, raise this exact question with the hiring manager — and tie your follow-up to your own goals.`
    }
    return delay(answer, 1100)
  },

  async chat(_message: string) {
    return delay(
      `Here's how I'd approach that:\n\n1. **Sharpen your résumé** around measurable outcomes.\n2. **Target roles** that match your top skills.\n3. **Prepare stories** using the STAR format.\n\n| Focus | Why it matters |\n|---|---|\n| Projects | Proof you can ship |\n| Metrics | Show impact |\n| Fit | Tailor every application |\n\nWant me to draft a 30-day prep plan?`,
      1100,
    )
  },

  /* ---- Career Compass (multi-stage counselor) ---- */
  compassQuestions: [
    'To start: what kind of problem or impact do you most want to work on?',
    'What environment helps you do your best work — big team, small startup, remote, on-site?',
    "Tell me about a project or moment you're genuinely proud of.",
    'Which skills do you most want to build over the next year?',
    'Any real-life constraints I should factor in — location, language, schedule?',
  ] as string[],

  async compassInterview(answers: string[]) {
    const idx = answers.length
    const reactions = [
      'That gives me a strong signal.',
      'Love that — it tells me a lot about how you work.',
      'Great, noted.',
      'Helpful, thank you.',
    ]
    if (idx >= this.compassQuestions.length) {
      return delay({ done: true as const, message: "Perfect — I have enough to suggest some directions. Let me pull together your matches." })
    }
    const lead = idx === 0 ? "Let's find a path that fits you. " : `${reactions[(idx - 1) % reactions.length]} `
    return delay({ done: false as const, message: lead + this.compassQuestions[idx], question: this.compassQuestions[idx] })
  },

  async compassRecommend(answers: string[], jobs: JobListing[], student: Profile) {
    const scored = jobs
      .map((job) => {
        const score = seededScore(`${student.id}:${job.id}`, 38, 97)
        const matched = job.tags.filter((t) => (student.skills ?? []).some((s) => s.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(s.toLowerCase())))
        return { job, score, matched }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)

    const recs = scored.map(({ job, score, matched }) => {
      const missing = job.tags.filter((t) => !matched.includes(t))
      return {
        job,
        score,
        why: `This fits what you told me${answers[0] ? ` about wanting to work on ${answers[0].toLowerCase().slice(0, 60)}` : ''}. Your background${matched.length ? ` in ${matched.slice(0, 2).join(', ')}` : ''} lines up well with this ${job.listing_type.toLowerCase()}.`,
        stretch: missing.length ? `You'd stretch into ${missing.slice(0, 2).join(' and ')} — a healthy challenge.` : `You'd deepen your existing strengths here.`,
        actions: [
          `Tailor your CV to highlight ${matched[0] ?? job.type} for this role.`,
          `Build or polish one small project using ${missing[0] ?? job.tags[0] ?? 'a core skill'}.`,
          `Use AI Research on this role, then message someone on the team.`,
        ],
      }
    })

    const intro =
      recs.length === 0
        ? "I couldn't find strong matches right now — try broadening your profile or adding skills."
        : `Based on our conversation, here are my top ${recs.length} recommendations, ranked by fit. I prioritized roles that match both what you said and your profile.`
    return delay({ intro, recs }, 1500)
  },

  async compassPrep(job: JobListing, student: Profile) {
    const matched = job.tags.filter((t) => (student.skills ?? []).some((s) => s.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(s.toLowerCase())))
    const missing = job.tags.filter((t) => !matched.includes(t))
    return delay(
      {
        fit: `You're a solid candidate for ${job.title}: your strengths${matched.length ? ` in ${matched.join(', ')}` : ''} are directly relevant.`,
        gap: missing.length ? `The main gap is ${missing.slice(0, 2).join(' and ')} — address it head-on.` : 'No major gaps — focus on storytelling and polish.',
        skills: (missing.length ? missing : job.tags).slice(0, 4).map((t) => `Brush up on ${t}`),
        talkingPoints: [
          `I've worked hands-on with ${(student.skills ?? [job.type]).slice(0, 2).join(' and ')}.`,
          `I'm drawn to this role because it combines ${job.tags.slice(0, 2).join(' and ')}.`,
          `As a ${student.major ?? 'student'}, I learn fast and take ownership.`,
        ],
        questions: [
          `What does success look like in the first 90 days of ${job.title}?`,
          'How is feedback and mentorship structured here?',
          `What's the team's tech/tooling for ${job.type}?`,
          'What are the biggest challenges the team is facing right now?',
        ],
        actions: [
          `Do a 2-hour refresher on ${missing[0] ?? job.tags[0] ?? job.type}.`,
          'Rewrite your top CV bullet to show measurable impact.',
          'Prepare 2 STAR stories about ownership and teamwork.',
        ],
      },
      1300,
    )
  },

  async cvTips(_student: Profile) {
    return delay(
      [
        'Lead each bullet with a strong verb and a measurable result.',
        'Move your most relevant project to the top of the page.',
        'Add the specific tools/frameworks recruiters search for.',
        'Cut anything older than your most recent, most relevant work.',
        'Keep it to one page — every line should earn its place.',
        'Add links: GitHub, portfolio, and LinkedIn in the header.',
      ],
      900,
    )
  },
}

/* ----------------------------- AI — real backend (Claude), mock fallback ----------------------------- */
export interface CoachResult {
  draft: string
  critique: { strengths: string[]; weaknesses: string[]; missing: string[]; verdict: string }
  final: string
}
export interface ModelUsage {
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  calls: number
  cost_usd: number
  credits: number
}
export interface UsageSummary {
  available: boolean
  models: ModelUsage[]
  totals: { input_tokens: number; output_tokens: number; calls: number; cost_usd: number; credits: number }
}
export interface PrepResult {
  fit: string
  gap: string
  skills: string[]
  talkingPoints: string[]
  questions: string[]
  actions: string[]
}
export interface CompanyResearch {
  overview: string
  culture: string
  opportunity: string
  red_flags: string
  questions: string[]
  verdict: string
}
export interface CompassRec {
  job: JobListing
  score: number
  why: string
  stretch: string
  actions: string[]
}
async function aiPost(path: string, body: unknown) {
  return apiFetch(path, { method: 'POST', body: JSON.stringify(body) })
}

/**
 * Consume a Server-Sent-Events stream from an AI endpoint, invoking `onToken`
 * for each text delta so the UI renders the answer live (token-by-token). Shows
 * up in the AI activity panel via trackAi. Returns true if any text streamed;
 * throws on failure so callers can fall back to the non-streaming endpoint.
 */
/** Read a Server-Sent-Events stream and invoke `onFrame` for each JSON frame.
 *  Lower-level than streamAi (no activity-panel task) — used by the match runner,
 *  which manages its own progress task. Throws on a non-OK response. */
async function consumeSse(path: string, body: unknown, onFrame: (obj: any) => void): Promise<void> {
  const res = await rawFetchAuthed(path, { method: 'POST', body: JSON.stringify(body) })
  if (!res.ok || !res.body) throw new Error(`stream_failed_${res.status}`)
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const chunks = buf.split('\n\n')
    buf = chunks.pop() ?? ''
    for (const chunk of chunks) {
      const line = chunk.trim()
      if (!line.startsWith('data:')) continue
      try { onFrame(JSON.parse(line.slice(5).trim())) } catch { /* ignore partial */ }
    }
  }
}

async function streamAi(label: string, path: string, body: unknown, onToken: (t: string) => void, onMeta?: (m: any) => void, onDone?: (info: { cached: boolean }) => void): Promise<boolean> {
  return trackAi(label, async () => {
    const res = await rawFetchAuthed(path, { method: 'POST', body: JSON.stringify(body) })
    if (!res.ok || !res.body) throw new Error(`stream_failed_${res.status}`)
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let got = false
    let errored = false
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const chunks = buf.split('\n\n')
      buf = chunks.pop() ?? ''
      for (const chunk of chunks) {
        const line = chunk.trim()
        if (!line.startsWith('data:')) continue
        try {
          const obj = JSON.parse(line.slice(5).trim())
          if (obj.meta !== undefined) onMeta?.(obj.meta)
          if (obj.t) {
            if (obj.t === 'done') {
              onDone?.({ cached: !!obj.cached })
              continue
            }
            got = true
            onToken(obj.t as string)
          }
          if (obj.error) errored = true
        } catch { /* ignore partial frames */ }
      }
    }
    if (errored && !got) throw new Error('ai_stream_error')
    return got
  })
}

// Honest error surfaced when a real Claude call fails WITH a key present. The
// server returns its hardcoded safety-net (HTTP 200) only when there is no API
// key, so reaching these catch blocks means a genuine failure — never mask it
// with fabricated content.
const AI_ERR = 'AI is temporarily unavailable — please try again in a moment.'

export const aiApi = {
  compassQuestions: mockAi.compassQuestions,

  /** Per-job match — Claude-only (server). Returns null when the server can't
   *  score it (no API key / unreachable). No local fabricated fallback. */
  async match(_student: Profile, job: JobListing): Promise<AiMatch | null> {
    try {
      return (await trackAi('Scoring this role against your profile', () => apiFetch(`/ai/match/${job.id}`))) as AiMatch
    } catch {
      return null
    }
  },

  /** All matches in ONE request (server scores every visible job). Empty when
   *  the server is unreachable — there is no local engine. Pass resumeId to
   *  score against a specific résumé profile instead of the active one. */
  async matchAll(_student: Profile, _jobs: JobListing[], resumeId?: string): Promise<AiMatch[]> {
    try {
      const params = resumeId ? `?resume_id=${encodeURIComponent(resumeId)}` : ''
      return (await trackAi('Matching you to open roles', () => apiFetch(`/ai/matches${params}`))) as AiMatch[]
    } catch {
      return []
    }
  },

  /** Read today's stored scores without starting or refreshing matching.
   *  Pass resumeId to get only matches for a specific résumé profile. */
  async cachedMatches(resumeId?: string): Promise<AiMatch[]> {
    try {
      const params = resumeId ? `?resume_id=${encodeURIComponent(resumeId)}` : ''
      return (await apiFetch(`/ai/matches/cached${params}`)) as AiMatch[]
    } catch {
      return []
    }
  },

  /** Stream matches with live progress. Calls onMeta(total) once, then
   *  onProgress(done,total,title,match) per scored role. Throws if streaming is
   *  unavailable so the caller can fall back to matchAll().
   *  Pass resumeId to stream scores against a specific résumé profile. */
  async matchAllStream(handlers: {
    onMeta?: (total: number, resumeId?: string | null) => void
    onProgress?: (done: number, total: number, title: string, match: AiMatch | null) => void
    /** Live pipeline stage (reading → résumé → scoring → ranking) so the UI can
     *  animate "what the AI is doing" instead of a frozen spinner. */
    onActivity?: (step: string, label: string) => void
    /** The server refused to run because the profile is incomplete (no résumé /
     *  no preferences). The funnel can't rank without something to match on. */
    onNotReady?: (missing: string[]) => void
  }, resumeId?: string): Promise<void> {
    const body = resumeId ? { resume_id: resumeId } : {}
    await consumeSse('/ai/matches/stream', body, (obj) => {
      if (obj.activity) handlers.onActivity?.(obj.activity.step, obj.activity.label)
      if (obj.notReady) handlers.onNotReady?.(obj.notReady.missing ?? [])
      if (obj.meta) handlers.onMeta?.(obj.meta.total ?? 0, obj.meta.resumeId ?? null)
      if (obj.progress) handlers.onProgress?.(obj.progress.done, obj.progress.total, obj.progress.title, obj.match ?? null)
      if (obj.error) throw new Error('match_stream_error')
    })
  },

  /** Application-progress nudges (DB-derived, no AI) — cheap, so the Insights
   *  Snapshot can render them without re-scoring every role. */
  async outcomeNudges(): Promise<{ title: string; message: string; status: string }[]> {
    try {
      return (await apiFetch('/ai/outcome-nudges')) as { title: string; message: string; status: string }[]
    } catch {
      return []
    }
  },

  /** Bounded re-score of the student's EXISTING matches only (their already-
   *  matched roles) — cheap and concurrency-capped on the server, so fixing a CV
   *  and refreshing never re-runs the full discovery funnel. Pass resumeId to
   *  refresh only that résumé's scores. */
  async refreshMatches(resumeId?: string): Promise<{ refreshed: number; total: number }> {
    try {
      const body = resumeId ? JSON.stringify({ resume_id: resumeId }) : undefined
      return (await apiFetch('/ai/matches/refresh', { method: 'POST', body })) as { refreshed: number; total: number }
    } catch {
      return { refreshed: 0, total: 0 }
    }
  },

  /** AI usage metering — per-model token totals + estimated credits for the
   *  current user. Used by the Usage page. Returns an empty summary on failure. */
  async usage(): Promise<UsageSummary> {
    try {
      return (await apiFetch('/ai/usage')) as UsageSummary
    } catch {
      return { available: false, models: [], totals: { input_tokens: 0, output_tokens: 0, calls: 0, cost_usd: 0, credits: 0 } }
    }
  },

  async coach(student: Profile, job: JobListing): Promise<CoachResult> {
    try {
      return (await trackAi('Preparing coaching tips', () => aiPost('/ai/coach', { job_id: job.id }))) as CoachResult
    } catch {
      return { draft: AI_ERR, critique: { strengths: [], weaknesses: [], missing: [], verdict: 'refine' }, final: '' }
    }
  },

  async companyResearch(companyName: string, role?: string, force?: boolean): Promise<CompanyResearch> {
    try {
      return (await trackAi(`Researching ${companyName}`, () => aiPost('/ai/company', { company: companyName, role, force }))) as CompanyResearch
    } catch {
      return { overview: AI_ERR, culture: '', opportunity: '', red_flags: '', questions: [], verdict: '' }
    }
  },

  async sourceOpportunities(query: string, jobs: JobListing[], student: Profile) {
    try {
      const r = (await trackAi('Finding opportunities for you', () => aiPost('/ai/source', { query }))) as { summary: string; results: { job: { id: string }; why: string[]; score: number }[] }
      const byId = new Map(jobs.map((j) => [j.id, j]))
      const results = r.results
        .map((x) => ({ job: byId.get(x.job.id), why: x.why, score: x.score }))
        .filter((x): x is { job: JobListing; why: string[]; score: number } => !!x.job)
      return { summary: r.summary, results }
    } catch {
      return { summary: AI_ERR, results: [] as { job: JobListing; why: string[]; score: number }[] }
    }
  },

  async researchAsk(companyName: string, role: string | undefined, question: string): Promise<string> {
    try {
      const r = (await trackAi('Answering your research question', () => aiPost('/ai/research/ask', { company: companyName, role, question }))) as { answer: string }
      return r.answer
    } catch {
      return AI_ERR
    }
  },

  /** Streamed company research (live web-grounded Markdown). Renders progressively
   *  instead of blocking ~1min on a single call. Returns true if anything streamed;
   *  throws on a hard failure so the store can surface an error.
   *  `onDone` receives `{ cached: boolean }` when the server signals completion. */
  async companyResearchStream(
    companyName: string,
    role: string | undefined,
    onToken: (t: string) => void,
    force?: boolean,
    onDone?: (info: { cached: boolean }) => void,
  ): Promise<boolean> {
    return await streamAi(`Researching ${companyName}`, '/ai/company/stream', { company: companyName, role, force }, onToken, onDone)
  },

  /** Streamed research answer (live web-grounded). Returns true if anything
   *  streamed; on failure returns false so the caller can fall back. */
  async researchAskStream(companyName: string, role: string | undefined, question: string, onToken: (t: string) => void): Promise<boolean> {
    try {
      return await streamAi('Answering your research question', '/ai/research/ask/stream', { company: companyName, role, question }, onToken)
    } catch {
      return false
    }
  },

  async chat(message: string): Promise<string> {
    try {
      const r = (await trackAi('Thinking…', () => aiPost('/ai/chat', { message }))) as { text: string }
      return r.text
    } catch {
      return AI_ERR
    }
  },

  /** Streamed, CV-aware chat. Returns true if anything streamed; false on
   *  failure so the caller can fall back to the non-streaming chat. */
  async chatStream(message: string, onToken: (t: string) => void): Promise<boolean> {
    try {
      return await streamAi('Thinking…', '/ai/chat/stream', { message }, onToken)
    } catch {
      return false
    }
  },

  async compassInterview(answers: string[]): Promise<{ done: boolean; message: string; question?: string }> {
    try {
      return (await trackAi('Career Compass — listening', () => aiPost('/ai/compass/interview', { answers }))) as { done: boolean; message: string; question?: string }
    } catch {
      return mockAi.compassInterview(answers)
    }
  },

  /** Stream the next Compass question live. Returns true if it streamed; the
   *  greeting / closing turns return false so the caller uses compassInterview. */
  async compassInterviewStream(answers: string[], onToken: (t: string) => void, onMeta: (m: any) => void): Promise<boolean> {
    try {
      return await streamAi('Career Compass — listening', '/ai/compass/interview/stream', { answers }, onToken, onMeta)
    } catch {
      return false
    }
  },

  async compassRecommend(answers: string[], jobs: JobListing[], student: Profile): Promise<{ intro: string; signals?: string[]; recs: CompassRec[] }> {
    try {
      const r = (await trackAi('Career Compass — finding directions', () => aiPost('/ai/compass/recommend', { answers }))) as {
        intro: string
        signals?: string[]
        recs: { job: { id: string }; score: number; why: string; stretch: string; actions: string[] }[]
      }
      const byId = new Map(jobs.map((j) => [j.id, j]))
      const recs: CompassRec[] = r.recs
        .map((x) => ({ ...x, job: byId.get(x.job.id) }))
        .filter((x): x is CompassRec => !!x.job)
      return { intro: r.intro, signals: r.signals, recs }
    } catch {
      return { intro: AI_ERR, recs: [] as CompassRec[] }
    }
  },

  async compassPrep(job: JobListing, student: Profile): Promise<PrepResult> {
    try {
      return (await trackAi('Building your prep plan', () => aiPost('/ai/compass/prep', { job_id: job.id }))) as PrepResult
    } catch {
      return { fit: AI_ERR, gap: '', skills: [], talkingPoints: [], questions: [], actions: [] }
    }
  },

  async cvTips(student: Profile): Promise<string[]> {
    try {
      return (await trackAi('Reviewing your CV', () => aiPost('/ai/cv-tips', {}))) as string[]
    } catch {
      return [AI_ERR]
    }
  },

  /**
   * AI assignment studio — generate a practical candidate assignment (title,
   * prompt, questions + rubric) from a role brief and/or uploaded document(s).
   * Pass `existing` + `instruction` to refine the current assignment in place.
   */
  async generateAssignment(payload: {
    job?: { title?: string; description?: string; type?: string; tags?: string[] }
    sources?: { kind: string; name?: string; dataUrl: string }[]
    instruction?: string
    existing?: { questions?: AiAssignmentQuestion[]; rubric?: AiRubricCriterion[] }
  }): Promise<{ title: string; prompt: string; questions: AiAssignmentQuestion[]; rubric: AiRubricCriterion[] }> {
    return (await trackAi('Designing your assignment', () => aiPost('/ai/assignment/generate', payload))) as any
  },
  async generateJob(payload: {
    brief?: string
    sources?: { kind: string; name?: string; dataUrl: string }[]
    instruction?: string
    existing?: Record<string, unknown>
  }): Promise<{
    title: string
    description: string
    category: string
    listing_type: string
    location: string
    pay: string
    duration: string
    tags: string[]
    responsibilities: string[]
    qualifications: string[]
    benefits: string[]
  }> {
    return (await trackAi('Drafting your job posting', () => aiPost('/ai/job/generate', payload))) as any
  },
}

// ---- Admin (gated server-side by ADMIN_EMAILS; UI also hidden from non-admins) ----
export interface AdminUserRow {
  id: string
  full_name: string
  email: string
  user_type: 'student' | 'company' | 'school'
  plan: Plan
  avatar_url: string | null
  company_name: string | null
  created_at: string
  jobs: number
  applications: number
  input_tokens: number
  output_tokens: number
  calls: number
  credits: number
}
export interface AdminData {
  usageAvailable: boolean
  counts: { total: number; students: number; companies: number; schools: number; applications: number }
  totals: UsageSummary['totals']
  models: ModelUsage[]
  users: AdminUserRow[]
}
export interface AdminApplication {
  id: string
  student_id: string
  applicant_name: string
  applicant_email: string
  avatar_url: string | null
  job_id: string
  job_title: string
  org_id: string | null
  org_name: string
  org_type: 'company' | 'school' | null
  status: string
  created_at: string
}

export const adminApi = {
  async data(): Promise<AdminData> {
    return (await apiFetch('/admin/data')) as AdminData
  },
  async applications(): Promise<AdminApplication[]> {
    const r = (await apiFetch('/admin/applications')) as { applications: AdminApplication[] }
    return r.applications
  },
  async setPlan(userId: string, plan: Plan): Promise<void> {
    await apiFetch(`/admin/users/${userId}/plan`, { method: 'POST', body: JSON.stringify({ plan }) })
  },
  async clearUsage(userId: string): Promise<void> {
    await apiFetch(`/admin/users/${userId}/clear-usage`, { method: 'POST' })
  },
}

/* ----------------------------- Evidence ----------------------------- */
export const evidenceApi = {
  async list(): Promise<EvidenceItem[]> {
    return (await apiFetch('/evidence')) as EvidenceItem[]
  },
  async listForStudent(studentId: string): Promise<EvidenceItem[]> {
    return (await apiFetch(`/evidence/student/${studentId}`)) as EvidenceItem[]
  },
  async create(payload: { title: string; description?: string; links?: string[]; files?: { data: string; name: string }[] }): Promise<EvidenceItem> {
    return (await apiFetch('/evidence', { method: 'POST', body: JSON.stringify(payload) })) as EvidenceItem
  },
  async extract(id: string): Promise<EvidenceItem> {
    return (await apiFetch(`/evidence/${id}/extract`, { method: 'POST' })) as EvidenceItem
  },
  async confirm(id: string, confirmed: string[]): Promise<EvidenceItem> {
    return (await apiFetch(`/evidence/${id}/confirm`, { method: 'POST', body: JSON.stringify({ confirmed }) })) as EvidenceItem
  },
   async summary(studentId: string, jobDescription?: string): Promise<{ summary: string }> {
     const key = `evidence:summary:${studentId}:${jobDescription ?? ''}`
     return cached(
       key,
       () =>
         apiFetch(`/evidence/student/${studentId}/summary`, {
           method: 'POST',
           body: JSON.stringify({ jobDescription: jobDescription ?? '' }),
         }) as Promise<{ summary: string }>,
       2 * 60 * 1000, // 2 min — keep short because summaries change with evidence
     )
  },
  async listChat(studentId: string): Promise<Array<{ id: string; role: 'employer' | 'ai'; content: string; created_at: string }>> {
    return (await apiFetch(`/evidence/student/${studentId}/chat`)) as Array<{ id: string; role: 'employer' | 'ai'; content: string; created_at: string }>
  },
  async askChat(studentId: string, content: string): Promise<Array<{ id: string; role: 'employer' | 'ai'; content: string; created_at: string }>> {
    return (await apiFetch(`/evidence/student/${studentId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    })) as Array<{ id: string; role: 'employer' | 'ai'; content: string; created_at: string }>
  },
  async deleteChat(studentId: string, messageId: string): Promise<{ ok: boolean }> {
    return (await apiFetch(`/evidence/student/${studentId}/chat/${messageId}`, {
      method: 'DELETE',
    })) as { ok: boolean }
  },
  async clearChat(studentId: string): Promise<{ ok: boolean }> {
    return (await apiFetch(`/evidence/student/${studentId}/chat`, {
      method: 'DELETE',
    })) as { ok: boolean }
  },
}

/* ----------------------------- Optryva Assistant ----------------------------- */
export type AssistantAction = {
  type: 'inject_data' | 'navigate' | 'update_profile' | 'add_evidence' | 'create_job' | 'start_shortlist'
  target: string
  data: Record<string, unknown>
}
export interface AssistantToolEvent {
  type: 'tool_use' | 'tool_result'
  name?: string
  input?: Record<string, unknown>
  result?: string
}

export interface AssistantChatResponse {
  text: string
  session_id: string
  actions: AssistantAction[]
  tool_events?: AssistantToolEvent[]
}

export const assistantApi = {
  /** Chat with the Optryva Assistant. Returns the reply + immediate-injection actions. */
  async chat(
    message: string,
    opts?: { sessionId?: string; mode?: string; pageContext?: string },
    signal?: AbortSignal,
  ): Promise<AssistantChatResponse> {
    return (await trackAi('Thinking…', () =>
      apiFetch('/assistant/chat', {
        method: 'POST',
        body: JSON.stringify({
          message,
          session_id: opts?.sessionId,
          mode: opts?.mode,
          context: opts?.pageContext ? { pageContext: opts.pageContext } : undefined,
        }),
        signal,
      }),
    )) as AssistantChatResponse
  },

  /** List the user's assistant sessions (newest first). */
  async sessions(): Promise<any[]> {
    return (await apiFetch('/assistant/sessions')) as any[]
  },

  /** Fetch a session's message history (newest-first → reversed by API). */
  async messages(sessionId: string): Promise<{ session_id: string; messages: any[] }> {
    return (await apiFetch(`/assistant/sessions/${sessionId}/messages`)) as { session_id: string; messages: any[] }
  },

  /** Delete a conversation session. */
  async deleteSession(sessionId: string): Promise<void> {
    await apiFetch(`/assistant/sessions/${sessionId}`, { method: 'DELETE' })
  },

  /** Demo: Fixed-40 match results for a student (mock data). */
  async fixed40Matches(studentId: string): Promise<any[]> {
    return ((await apiFetch(`/assistant/match/${studentId}`)) as { matches: any[] }).matches
  },

   /** Demo-aware employer shortlist. */
  async shortlist(jobId: string): Promise<any | null> {
    try {
      return (await apiFetch(`/assistant/jobs/${jobId}/shortlist`)) as any
    } catch {
      return null
    }
  },

  /**
   * Run an autonomous agentic task (streaming SSE). The AI can call tools
   * autonomously to complete multi-step requests like "Create a Frontend
   * intern job in Nairobi". Each SSE frame is one of:
   *   { event: 'text', text }        — a text delta
   *   { event: 'tool_use', name, input }
   *   { event: 'tool_result', name, result }
   *   { event: 'action', action }    — immediate-injection action for the widget
   *   { event: 'done', summary }
   *   { event: 'error', message }
   *   { event: 'end' }
   */
   async runTask(
     message: string,
     opts: { sessionId?: string; mode?: string; pageContext?: string },
     onEvent: (ev: any) => void,
     signal?: AbortSignal,
   ): Promise<void> {
     const res = await rawFetchAuthed('/assistant/task', {
       method: 'POST',
       body: JSON.stringify({
         message,
         session_id: opts?.sessionId,
         mode: opts?.mode,
         context: opts?.pageContext ? { pageContext: opts.pageContext } : undefined,
       }),
       signal,
     })
     if (!res.ok || !res.body) throw new Error(`task_failed_${res.status}`)
     const reader = res.body.getReader()
     const dec = new TextDecoder()
     let buf = ''
     for (;;) {
       const { done, value } = await reader.read()
       if (done) break
       buf += dec.decode(value, { stream: true })
       const chunks = buf.split('\n\n')
       buf = chunks.pop() ?? ''
       for (const chunk of chunks) {
         const line = chunk.trim()
         if (!line.startsWith('data:')) continue
         try {
           onEvent(JSON.parse(line.slice(5).trim()))
         } catch {
           /* ignore partial frames */
         }
       }
     }
   },
}
