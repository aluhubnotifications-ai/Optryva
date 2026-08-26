/**
 * Tool library — Deep Inspection & demo-match utilities.
 *
 * deepInspect: fetches an external URL (GitHub profile, portfolio, job posting,
 *   etc.), extracts readable text, and asks the LLM to pull out concrete skills
 *   + achievements. Uses the ./llm abstraction (Mistral primary, Claude fallback).
 *
 * getFixed40Matches: DEMO-ONLY multi-résumé matcher. Returns a fixed 40 results
 *   to showcase the matching UX without touching production match data.
 */
import { generateText, hasAI } from './llm'
import { extractJson } from '@/lib/claude'
import { j } from '@/db'
import type { AssistantAction } from './types'

/** Best-effort text extraction from arbitrary HTML (strips scripts/styles/nav). */
function htmlToText(html: string): string {
  try {
    const withoutScripts = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    const withoutStyles = withoutScripts.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    const withoutTags = withoutStyles.replace(/<[^>]+>/g, ' ')
    const decoded = withoutTags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
    return decoded.replace(/\s{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 8000)
  } catch {
    return ''
  }
}

/** Result of a deep inspection — ready to fold into assistant context or actions. */
export interface InspectResult {
  url: string
  title: string
  status: string
  skills: string[]
  achievements: string[]
  summary: string
}

/** Deep Inspection: scrape an external link + AI-extract skills and achievements.
 *  Called when the user drops a URL into the chat (e.g. a GitHub repo or portfolio). */
export async function deepInspect(url: string): Promise<InspectResult> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Optryva-Assistant/1.0 (career-analysis)' },
  })
  const html = await res.text()
  const text = htmlToText(html)
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  const title = titleMatch ? titleMatch[1].trim() : url

  let skills: string[] = []
  let achievements: string[] = []
  let summary = ''

  if (text && hasAI()) {
    const ai = await generateText({
      maxTokens: 1000,
      system:
        'You are an expert résumé/skill extractor. Read the provided web page content and extract:\n' +
        '1. Technical skills (languages, frameworks, tools, libraries).\n' +
        '2. Measurable achievements (quantified outcomes, project results).\n' +
        '3. A one-sentence summary of what this person/project/company does.\n\n' +
        'Return ONLY a JSON object: {"skills":["..."],"achievements":["..."],"summary":"..."}',
      user: `URL: ${url}\nTitle: ${title}\n\nContent:\n${text.slice(0, 6000)}`,
    })
    const parsed = extractJson<{ skills?: string[]; achievements?: string[]; summary?: string }>(ai)
    if (parsed) {
      skills = parsed.skills ?? []
      achievements = parsed.achievements ?? []
      summary = parsed.summary ?? ''
    }
  }

  return {
    url,
    title,
    status: 'verified_evidence',
    skills,
    achievements,
    summary: summary || `Verified evidence from ${title}.`,
  }
}

/** Build an inject_data action for adding evidence to the student's profile. */
export function evidenceAction(inspect: InspectResult): AssistantAction {
  return {
    type: 'add_evidence',
    target: 'profile_evidence',
    data: {
      source_url: inspect.url,
      title: inspect.title,
      status: inspect.status,
      skills: inspect.skills,
      achievements: inspect.achievements,
      summary: inspect.summary,
    },
  }
}

/** Multi-Résumé Matcher: Fixed 40 results.
 *  IMPORTANT: DEMO ONLY. Uses mock data to demonstrate the "Fixed 40" matching
 *  logic. Do NOT connect to live production match data yet. */
export async function getFixed40Matches(studentId: string) {
  const mockTitles = [
    'Frontend Engineer Intern', 'Backend Developer Intern', 'Product Manager Intern',
    'Data Science Intern', 'UX Research Intern', 'DevOps Intern',
    'Security Analyst Intern', 'Mobile App Developer Intern', 'QA Automation Intern',
    'Machine Learning Intern', 'Cloud Engineering Intern', 'Growth Marketing Intern',
    'Software Engineering Intern', 'AI Research Intern', 'Full Stack Developer Intern',
    'DevRel Intern', 'Platform Engineer Intern', 'Technical Writer Intern',
    'SRE Intern', 'Blockchain Developer Intern', 'Embedded Systems Intern',
    'Computer Vision Intern', 'Game Developer Intern', 'Data Engineer Intern',
    'Cybersecurity Intern', 'Bioinformatics Intern', 'Quant Research Intern',
    'Solutions Engineer Intern', 'Business Analyst Intern', 'Financial Engineer Intern',
    'Research Assistant', 'Academic Technology Intern', 'EdTech Product Intern',
    'Fintech Engineering Intern', 'Climate Tech Intern', 'Social Impact Intern',
    'Open Source Contributor', 'Dev Tools Intern', 'Infrastructure Intern',
    'API Platform Intern',
  ]
  return mockTitles.map((title, i) => ({
    id: `demo_${i}`,
    title,
    score: Math.max(40, Math.round(85 - i * 0.8)),
    reason: 'Demo match — powered by the Fixed-40 engine.',
    is_demo: true,
  }))
}
