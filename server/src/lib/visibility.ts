// ----------------------------------------------------------------------------
// School-domain & privacy gating — the single source of truth for "can this
// viewer see this job / this school".
//
//   • A school lists its students' email domains (student_domains).
//   • A viewer "belongs" to a school iff their account email domain is one of
//     those domains.
//   • is_private (school)  → only belonging viewers see the school + its jobs.
//   • students_only (job)  → only belonging viewers see that single listing.
//
// All gates are skipped gracefully until migration 0011 adds the columns.
// ----------------------------------------------------------------------------
import { sb, must, j } from '@/db'

/** Normalize a domain: lowercase, trim, strip a leading '@' and 'www.'. */
export function normDomain(d: string): string {
  return d.trim().toLowerCase().replace(/^@/, '').replace(/^www\./, '')
}

/** The normalized domain portion of an email ('' when absent/invalid). */
export function emailDomain(email?: string | null): string {
  if (!email) return ''
  const at = email.lastIndexOf('@')
  return at >= 0 ? normDomain(email.slice(at + 1)) : ''
}

/** Parse a school's student_domains JSON column into a normalized list. */
export function parseDomains(raw: any): string[] {
  return j.parse<string[]>(raw, []).map(normDomain).filter(Boolean)
}

/** True when the viewer's account email domain is one of the school's domains. */
export function viewerInDomains(viewer: any, domains: string[]): boolean {
  if (!domains.length) return false
  return domains.includes(emailDomain(viewer?.email))
}

export interface SchoolGate {
  is_private: boolean
  domains: string[]
}

function gateOf(row: any): SchoolGate {
  return { is_private: row?.is_private === 1, domains: parseDomains(row?.student_domains) }
}

// Migration 0011 may not have run yet; detect the columns once so reads don't
// 500 on a stale schema (matches the contentCols/cvUrl pattern elsewhere).
let hasCols: boolean | null = null
export async function visibilityColsExist(): Promise<boolean> {
  if (hasCols !== null) return hasCols
  const { error } = await sb.from('profiles').select('is_private').limit(1)
  hasCols = !error
  return hasCols
}

/** companyId -> gate for the given poster ids (empty map until columns exist). */
export async function schoolGates(companyIds: string[]): Promise<Map<string, SchoolGate>> {
  const ids = [...new Set(companyIds)].filter(Boolean)
  if (!ids.length || !(await visibilityColsExist())) return new Map()
  const rows = (must(await sb.from('profiles').select('id, is_private, student_domains').in('id', ids)) as any[]) ?? []
  return new Map(rows.map((r) => [r.id, gateOf(r)]))
}

/** The full job visibility decision, shared by the jobs routes and the matcher. */
export function jobVisibleTo(jobRow: any, viewer: any, gates: Map<string, SchoolGate>): boolean {
  if (jobRow.status !== 'active') return false

  // The posting school's owner always sees its own listings.
  const isOwner = viewer?.id === jobRow.company_id
  if (!isOwner) {
    const gate = gates.get(jobRow.company_id)
    if (gate) {
      const inside = viewerInDomains(viewer, gate.domains)
      if (gate.is_private && !inside) return false           // private school hides everything
      if (jobRow.students_only === 1 && !inside) return false // students-only listing
    }
  }

  // Existing student-facing gate (study year) still applies — but a graduated
  // student has no study year, so they're eligible for every level (including
  // internships) rather than being filtered out.
  if (viewer?.user_type !== 'student') return true
  if (viewer.graduated) return true
  const years = j.parse<number[]>(jobRow.allowed_years, [])
  if (years.length && viewer.year && !years.includes(viewer.year)) return false
  return true
}

/** True when a private school is hidden from this viewer (used by profile reads). */
export function schoolHiddenFrom(schoolRow: any, viewer: any): boolean {
  if (schoolRow?.user_type !== 'school' || schoolRow?.is_private !== 1) return false
  if (viewer?.id === schoolRow.id) return false // own profile
  return !viewerInDomains(viewer, parseDomains(schoolRow.student_domains))
}
