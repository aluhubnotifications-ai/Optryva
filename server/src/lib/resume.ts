// ----------------------------------------------------------------------------
// Résumé Understanding — Layer 1 of the match engine.
//
// We parse a student's CV text ONCE (when it first gets scored, or whenever the
// CV changes) into a structured, evidence-bearing profile. Every later job score
// reads this JSON instead of re-reading the raw résumé — far cheaper and, more
// importantly, the source of *grounded* reasons (we cite stored evidence, never
// invent a skill). Falls back to a heuristic profile when Claude is unavailable.
// ----------------------------------------------------------------------------

import { claudeText, extractJson, hasClaude, MODELS } from '@/lib/claude'

export type Seniority = 'student' | 'entry' | 'junior' | 'mid' | 'senior'
export type SkillLevel = 'familiar' | 'proficient' | 'expert'

export interface ResumeSkill {
  name: string
  level?: SkillLevel
  years?: number
  evidence?: string
}
export interface ResumeProject {
  name: string
  impact?: string
  stack?: string[]
}
export interface ResumeProfile {
  summary: string
  seniority: Seniority
  total_years: number
  skills: ResumeSkill[]
  domains: string[]
  roles: string[]
  projects: ResumeProject[]
  strengths: string[]
  gaps: string[]
}

const SCHEMA =
  '{"summary":"1-2 sentence factual summary","seniority":"student|entry|junior|mid|senior","total_years":number,' +
  '"skills":[{"name":"...","level":"familiar|proficient|expert","years":number,"evidence":"short quote/where it appears"}],' +
  '"domains":["e.g. fintech, healthcare"],"roles":["job titles held or targeted, from the text"],' +
  '"projects":[{"name":"...","impact":"measurable outcome if stated","stack":["tools"]}],' +
  '"strengths":["..."],"gaps":["skills a recruiter might expect but that are absent"]}'

/**
 * Structured parse via Claude. Returns null on any failure so the caller can use
 * the heuristic fallback. Only facts present in the text — never invented.
 */
export async function parseResume(cvText: string): Promise<ResumeProfile | null> {
  if (!hasClaude() || !cvText.trim()) return null
  const text = await claudeText({
    model: MODELS.score,
    maxTokens: 1600,
    system:
      'You are an expert résumé parser. Extract ONLY facts present in the text — never invent skills, years, titles, or projects. ' +
      'If something is absent, omit it or use [] / 0. Be conservative with levels and years. ' +
      `Reply with ONLY this JSON object: ${SCHEMA}`,
    user: cvText.slice(0, 14000),
  })
  const parsed = extractJson<ResumeProfile>(text)
  if (!parsed || !Array.isArray(parsed.skills)) return null
  return normalize(parsed)
}

/** Deterministic fallback: a thin profile from self-reported skills + CV length. */
export function heuristicResume(cvText: string, skills: string[]): ResumeProfile {
  const len = (cvText ?? '').length
  const seniority: Seniority = len > 2500 ? 'junior' : len > 800 ? 'entry' : 'student'
  return normalize({
    summary: cvText ? cvText.slice(0, 180).replace(/\s+/g, ' ').trim() : '',
    seniority,
    total_years: 0,
    skills: skills.map((s) => ({ name: s, level: 'familiar' as SkillLevel })),
    domains: [],
    roles: [],
    projects: [],
    strengths: skills.slice(0, 3),
    gaps: [],
  })
}

function normalize(p: ResumeProfile): ResumeProfile {
  return {
    summary: String(p.summary ?? '').slice(0, 400),
    seniority: (['student', 'entry', 'junior', 'mid', 'senior'] as Seniority[]).includes(p.seniority) ? p.seniority : 'entry',
    total_years: Math.max(0, Math.min(40, Number(p.total_years) || 0)),
    skills: (p.skills ?? []).filter((s) => s?.name).slice(0, 40),
    domains: (p.domains ?? []).filter(Boolean).slice(0, 12),
    roles: (p.roles ?? []).filter(Boolean).slice(0, 12),
    projects: (p.projects ?? []).filter((x) => x?.name).slice(0, 12),
    strengths: (p.strengths ?? []).filter(Boolean).slice(0, 8),
    gaps: (p.gaps ?? []).filter(Boolean).slice(0, 8),
  }
}

/** Flatten the structured skills into plain terms (for the deterministic engine). */
export function resumeSkillTerms(rp: ResumeProfile | null | undefined): string[] {
  if (!rp) return []
  const fromSkills = (rp.skills ?? []).map((s) => s.name)
  const fromStacks = (rp.projects ?? []).flatMap((p) => p.stack ?? [])
  return Array.from(new Set([...fromSkills, ...fromStacks, ...(rp.domains ?? [])]))
}
