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
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached.result as T)
  return fn().then((r) => {
    ctxCache.set(key, { result: r as unknown as string, expires: Date.now() + ttl })
    return r
  })
}

/** Student context: résumé evidence + real scored matches. */
export async function getStudentContext(userId: string): Promise<string> {
  return cached(`ctx:student:${userId}`, async () => {
    const row = await studentRow(userId)
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
    if (mc) ctx += `\n${mc}\n`

    return ctx
  })
}

/** Employer context: their postings + recent application pipeline. */
export async function getEmployerContext(userId: string): Promise<string> {
  return cached(`ctx:employer:${userId}`, async () => {
    const row = must(await sb.from('profiles').select('*').eq('id', userId).maybeSingle()) as any
    if (!row) return `The current user is a new employer who hasn't completed onboarding.`

    let ctx = `USER PROFILE (employer mode):\n`
    ctx += `  Company: ${row.company_name ?? '—'}\n`
    ctx += `  Industry: ${row.industry ?? '—'}\n`
    ctx += `  Company size: ${row.company_size ?? '—'}\n`
    ctx += `  Bio: ${row.bio ?? '—'}\n`

    const { data: jobs } = await sb.from('job_listings').select('*').eq('company_id', userId).order('created_at', { ascending: false })
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

     const { data: apps } = await sb.from('applications').select('id, job_id, status, created_at, match_score, student_id, full_name').eq('company_id', userId).order('created_at', { ascending: false }).limit(20)
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

    return ctx
  })
}

/** University context: programme-wide placement stats. */
export async function getUniversityContext(userId: string): Promise<string> {
  return cached(`ctx:university:${userId}`, async () => {
    const row = must(await sb.from('profiles').select('*').eq('id', userId).maybeSingle()) as any
    let ctx = `USER PROFILE (university mode):\n`
    ctx += `  School: ${row.company_name ?? row.full_name ?? '—'}\n`
    ctx += `  Student domains: ${(j.parse<string[]>(row.student_domains, [])).join(', ') || ' — '}\n`

    const { data: students } = await sb.from('profiles').select('id, full_name, school, major, graduated').eq('posted_by_role', 'school').limit(100)
    const count = students?.length ?? 0
    ctx += `\nRegistered students at this school: ${count}\n`

    const { data: outcomes } = await sb.from('match_outcomes').select('status').in('student_id', (students ?? []).map((s) => s.id))
    const placed = (outcomes ?? []).filter((o: any) => o.status === 'likely_hired').length
    ctx += `Confirmed placements: ${placed}\n`

    return ctx
  })
}
