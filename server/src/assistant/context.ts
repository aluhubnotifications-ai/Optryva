/**
 * Context builders — gather grounding for each assistant mode so Claude isn't
 * reasoning from a blank slate. Each returns a rich string the engine injects
 * into the system prompt. Reuses the match-engine loaders where possible so the
 * assistant sees the same résumé evidence the matcher does.
 */
import { sb, must, j } from '@/db'
import { studentRow } from '@/routes/ai/helpers'
import { ensureResumeProfile } from '@/lib/enrich'
import { type ResumeProfile } from '@/lib/resume'
import { matchContext } from '@/routes/ai/helpers'

/** Short-lived in-memory cache for context builders — 30s TTL. */
const CACHE_TTL_MS = 30_000
const ctxCache = new Map<string, { result: string; expires: number }>()

function cached<T>(key: string, fn: () => Promise<T>, ttl = CACHE_TTL_MS): Promise<T> {
  const cached = ctxCache.get(key)
  if (cached && cached.expires > Date.now()) {
    console.log('[assistant:context] cache HIT:', key)
    return Promise.resolve(cached.result as T)
  }
  console.log('[assistant:context] cache MISS:', key)
  return fn().then((r) => {
    ctxCache.set(key, { result: r as unknown as string, expires: Date.now() + ttl })
    console.log('[assistant:context] cache SET:', key, { result_len: (r as unknown as string).length, expires_in_ms: ttl })
    return r
  })
}

/** Student context: résumé evidence + real scored matches. */
export async function getStudentContext(userId: string): Promise<string> {
  console.log('[assistant:context] getStudentContext START:', userId)
  return cached(`ctx:student:${userId}`, async () => {
    try {
    const row = await studentRow(userId)
    console.log('[assistant:context] studentRow result:', { found: !!row, userId })
    if (!row) return `The current user is a new student who hasn't completed onboarding yet.`

    const rp = await ensureResumeProfile(row)
    let ctx = `USER PROFILE (student mode):\n`
    ctx += `  Name: ${row.full_name ?? 'student'}\n`
    ctx += `  School: ${row.school ?? '—'}\n`
    ctx += `  Major: ${row.major ?? '—'}\n`
    ctx += `  Year: ${row.year ?? '—'}\n`
    ctx += `  Skills (self-reported): ${(j.parse<string[]>(row.skills, [])).join(', ') || ' — '}\n`
    ctx += `  Desired roles: ${(j.parse<string[]>(row.desired_roles, [])).join(', ') || ' — '}\n`
    ctx += `  Preferred industries: ${(j.parse<string[]>(row.preferred_industries, [])).join(', ') || ' — '}\n`
    ctx += `  Work type: ${row.work_type ?? 'any'}\n`
    ctx += `  Location preference: ${row.location_pref ?? 'any'}\n`

    if (rp) {
      ctx += `\nRÉSUMÉ PROFILE (parsed evidence):\n`
      ctx += `  Summary: ${rp.summary}\n`
      ctx += `  Seniority: ${rp.seniority} (~${rp.total_years} years experience)\n`
      ctx += `  Parsed skills: ${(rp.skills ?? []).map((s) => `${s.name}${s.level ? ` (${s.level})` : ''}`).join(', ') || ' — '}\n`
      const projs = (rp.projects ?? []).map((p) => `${p.name}${p.impact ? ` — ${p.impact}` : ''}`).join('; ')
      ctx += `  Projects: ${projs || ' — '}\n`
      ctx += `  Domains: ${(rp.domains ?? []).join(', ') || ' — '}\n`
      ctx += `  Gaps: ${(rp.gaps ?? []).join(', ') || ' — '}\n`
    } else if ((row.cv_text ?? '').trim()) {
      ctx += `\nRÉSUMÉ TEXT (raw, ${row.cv_text!.length} chars):\n${String(row.cv_text).slice(0, 3000)}\n`
    } else {
      ctx += `\nNo résumé on file yet.\n`
    }

    const mc = await matchContext(userId)
    console.log('[assistant:context] matchContext result:', { found: !!mc })
    if (mc) ctx += `\n${mc}\n`

    console.log('[assistant:context] getStudentContext complete:', { ctx_len: ctx.length })
    return ctx
    } catch (e: any) {
      console.error('[assistant:context] ✗ error in getStudentContext:', e?.message)
      return `Student context fetch error for user ${userId}.`
    }
  })
}

/** Employer context: their postings + recent application pipeline. */
export async function getEmployerContext(userId: string): Promise<string> {
  console.log('[assistant:context] getEmployerContext START:', userId)
  return cached(`ctx:employer:${userId}`, async () => {
    try {
    const row = must(await sb.from('profiles').select('*').eq('id', userId).maybeSingle()) as any
    console.log('[assistant:context] employer profile fetch:', { found: !!row, userId })
    if (!row) return `The current user is a new employer who hasn't completed onboarding.`

    let ctx = `USER PROFILE (employer mode):\n`
    ctx += `  Company: ${row.company_name ?? '—'}\n`
    ctx += `  Industry: ${row.industry ?? '—'}\n`
    ctx += `  Company size: ${row.company_size ?? '—'}\n`
    ctx += `  Bio: ${row.bio ?? '—'}\n`

    const { data: jobs } = await sb.from('job_listings').select('*').eq('company_id', userId).order('created_at', { ascending: false })
    console.log('[assistant:context] employer jobs query:', { count: jobs?.length ?? 0 })
    if (jobs && jobs.length > 0) {
      ctx += `\nYOUR JOB POSTINGS:\n`
      for (const j2 of jobs as any[]) {
        ctx += `  • ${j2.title} (${j2.listing_type || 'Internship'}, ${j2.location || 'remote-ok'})\n`
        ctx += `    Tags: ${(j.parse<string[]>(j2.tags, [])).join(', ') || ' — '}\n`
        ctx += `    Description: ${(j2.description ?? '').slice(0, 500)}...\n`
      }
    } else {
      ctx += `\nNo job postings yet. Offer to help them create one.\n`
    }

      // applications → job_listings → profiles (company_id). The applications
      // table has no company_id column, so we resolve the employer's jobs first.
      const jobIds = (jobs ?? []).map((j: any) => j.id)
      console.log('[assistant:context] employer job IDs for applications query:', jobIds.length)
      const { data: apps } = jobIds.length
        ? await sb.from('applications').select('id, job_id, status, created_at, match_score, student_id, full_name').in('job_id', jobIds).order('created_at', { ascending: false }).limit(20)
        : { data: [] }
      console.log('[assistant:context] employer applications query:', { count: apps?.length ?? 0 })
     if (apps && apps.length > 0) {
       ctx += `\nRECENT APPLICATIONS:\n`
       for (const a of apps as any[]) {
         const score = a.match_score ? ` • score ${Math.round(a.match_score)}` : ''
         ctx += `  • App ${a.id.slice(0, 8)} → job ${a.job_id?.slice(0, 8)}: ${a.status} (${a.full_name ?? 'candidate'}${score})\n`
       }
     }

     // Fetch evidence summaries for recent applicants
     const studentIds = [...new Set((apps ?? []).map((a: any) => a.student_id).filter(Boolean))] as string[]
     if (studentIds.length > 0) {
       const { data: profs } = await sb
         .from('profiles')
         .select('id, full_name, evidence_summary')
         .in('id', studentIds)
       const evidenceMap = new Map((profs ?? []).map((p: any) => [p.id, p]))
       ctx += `\nCANDIDATE EVIDENCE SUMMARIES:\n`
       for (const a of apps as any[]) {
         const p = evidenceMap.get(a.student_id)
         if (p?.evidence_summary) {
           ctx += `  • ${p.full_name || a.full_name}: ${(p.evidence_summary as string).slice(0, 200)}…\n`
         }
      }
    }

    console.log('[assistant:context] getEmployerContext complete:', { ctx_len: ctx.length })
    return ctx
    } catch (e: any) {
      console.error('[assistant:context] ✗ error in getEmployerContext:', e?.message)
      return `Employer context fetch error for user ${userId}.`
    }
  })
}

/** University context: programme-wide placement stats + job listings + candidates. */
export async function getUniversityContext(userId: string): Promise<string> {
  console.log('[assistant:context] getUniversityContext START:', userId)
  return cached(`ctx:university:${userId}`, async () => {
    try {
    const row = must(await sb.from('profiles').select('*').eq('id', userId).maybeSingle()) as any
    console.log('[assistant:context] university profile fetch:', { found: !!row, userId })
    let ctx = `USER PROFILE (university mode):\n`
    ctx += `  School: ${row.company_name ?? row.full_name ?? '—'}\n`
    ctx += `  Student domains: ${(j.parse<string[]>(row.student_domains, [])).join(', ') || ' — '}\n`

    // All students registered at this university
    const { data: students } = await sb.from('profiles').select('id, full_name, school, major, graduated').eq('posted_by_role', 'school').limit(500)
    const studentCount = students?.length ?? 0
    ctx += `\nRegistered students at this school: ${studentCount}\n`

    // Match outcomes / placements
    const studentIds = (students ?? []).map((s: any) => s.id)
    if (studentIds.length) {
      const { data: outcomes } = await sb.from('match_outcomes').select('status').in('student_id', studentIds)
      const placed = (outcomes ?? []).filter((o: any) => o.status === 'likely_hired').length
      ctx += `Confirmed placements: ${placed}\n`
    }

    // Jobs the university has posted (they can post for themselves and other companies)
    const { data: uniJobs } = await sb.from('job_listings').select('id, title, company_name, location, listing_type, status, created_at').eq('company_id', userId).order('created_at', { ascending: false }).limit(50)
    if (uniJobs && uniJobs.length > 0) {
      ctx += `\nJOBS POSTED BY THIS UNIVERSITY:\n`
      for (const j2 of uniJobs as any[]) {
        ctx += `  • ${j2.title} (${j2.listing_type || 'Internship'}, ${j2.location || 'remote-ok'}, ${j2.status})\n`
      }
    }

    // Also see jobs posted by companies the university is connected to
    const { data: partnerJobs } = await sb.from('job_listings').select('id, title, company_name, location, listing_type, status, created_at').eq('company_id', userId).neq('company_id', userId).order('created_at', { ascending: false }).limit(50)
    if (partnerJobs && partnerJobs.length > 0) {
      ctx += `\nPARTNER COMPANY JOB LISTINGS:\n`
      for (const j2 of partnerJobs as any[]) {
        ctx += `  • ${j2.title} at ${j2.company_name ?? '—'} (${j2.listing_type || 'Internship'}, ${j2.location || 'remote-ok'}, ${j2.status})\n`
      }
    }

    // Applications for university-posted jobs — candidates who applied
    const uniJobIds = (uniJobs ?? []).map((j: any) => j.id)
    if (uniJobIds.length) {
      const { count: uniAppCount } = await sb.from('applications').select('*', { count: 'exact', head: true }).in('job_id', uniJobIds)
      const { data: uniApps } = await sb.from('applications').select('id, job_id, student_id, full_name, status, match_score, created_at').in('job_id', uniJobIds).order('created_at', { ascending: false }).limit(20)
      ctx += `\nCANDIDATES FOR UNIVERSITY-POSTED JOBS (${uniAppCount ?? 0} total applications):\n`
      const uniJobMap = new Map((uniJobs ?? []).map((j: any) => [j.id, j.title]))
      for (const a of uniApps as any[] ?? []) {
        const score = a.match_score ? ` • score ${Math.round(a.match_score)}` : ''
        ctx += `  • ${a.full_name || 'candidate'} → ${uniJobMap.get(a.job_id) || 'unknown role'} — ${a.status}${score}\n`
      }
    }

    // Conversations messages context for the university user
    const { count: msgCount } = await sb.from('assistant_messages').select('*', { count: 'exact', head: true }).not('session_id', 'is', null)
    ctx += `\nYou have ${msgCount ?? 0} message(s) in your conversation history.\n`

    console.log('[assistant:context] getUniversityContext complete:', { students: studentCount, uniJobs: uniJobs?.length ?? 0, partnerJobs: partnerJobs?.length ?? 0, ctx_len: ctx.length })
    return ctx
    } catch (e: any) {
      console.error('[assistant:context] ✗ error in getUniversityContext:', e?.message)
      return `University context fetch error for user ${userId}.`
    }
  })
}
