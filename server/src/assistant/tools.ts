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
  console.log('[assistant:tools:deepInspect] START:', { url, len: url.length })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  let res: Response
  try {
    console.log('[assistant:tools:deepInspect] fetching URL…')
    res = await fetch(url, {
      headers: { 'User-Agent': 'Optryva-Assistant/1.0 (career-analysis)' },
      signal: controller.signal,
    })
    console.log('[assistant:tools:deepInspect] fetch complete:', res.status)
    if (!res.ok) {
      console.warn('[assistant:tools:deepInspect] ✗ HTTP error:', res.status, url)
      return { url, title, status: `http_${res.status}`, skills: [], achievements: [], summary: `URL returned HTTP ${res.status}: ${url}` }
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      console.warn('[assistant:tools:deepInspect] ✗ fetch timed out after 8s:', url)
      return { url, title: '', status: 'fetch_timeout', skills: [], achievements: [], summary: `URL load timed out after 8s: ${url}` }
    }
    console.error('[assistant:tools:deepInspect] ✗ fetch error:', { message: e?.message, url, error_name: e?.name })
    throw e
  } finally {
    clearTimeout(timeout)
  }
  const html = await res.text()
  console.log('[assistant:tools:deepInspect] response body length:', html.length)
  const text = htmlToText(html)
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  const title = titleMatch ? titleMatch[1].trim() : url

  let commitsText = ''
  const ghMatch = url.match(/github\.com\/([^/]+)\/([^/]+)/)
  if (ghMatch && res.ok) {
    const [, owner, repo] = ghMatch
    const cleanRepo = repo.replace(/#.*$/, '')
    try {
      const commitsRes = await fetch(`https://api.github.com/repos/${owner}/${cleanRepo}/commits?per_page=5`, {
        headers: {
          'User-Agent': 'Optryva-Assistant/1.0',
          'Accept': 'application/vnd.github.v3+json',
        },
      })
      if (commitsRes.ok) {
        const commits = await commitsRes.json() as any[]
        commitsText = commits.map((c) => c.commit?.message ?? '').join('\n').slice(0, 2000)
        console.log('[assistant:tools:deepInspect] ✓ fetched GitHub commits:', commits.length)
      } else {
        console.warn('[assistant:tools:deepInspect] GitHub API returned:', commitsRes.status)
      }
    } catch (e: any) {
      console.warn('[assistant:tools:deepInspect] GitHub API error:', e?.message)
    }
  }
  console.log('[assistant:tools:deepInspect] extracted title:', title, { text_len: text.length })

  let skills: string[] = []
  let achievements: string[] = []
  let summary = ''

  if (text && hasAI()) {
    console.log('[assistant:tools:deepInspect] calling generateText (hasAI = true)')
    const ai = await generateText({
      maxTokens: 1000,
      system:
        'You are an expert résumé/skill extractor. Read the provided web page content and extract:\n' +
        '1. Technical skills (languages, frameworks, tools, libraries).\n' +
        '2. Measurable achievements (quantified outcomes, project results).\n' +
        '3. A one-sentence summary of what this person/project/company does.\n\n' +
        'Return ONLY a JSON object: {"skills":["..."],"achievements":["..."],"summary":"..."}',
      user: `URL: ${url}\nTitle: ${title}\n\nContent:\n${text.slice(0, 6000)}${commitsText ? `\n\nRecent commits:\n${commitsText}` : ''}`,
    })
    console.log('[assistant:tools:deepInspect] generateText raw result:', ai?.slice(0, 200) ?? 'null')
    const parsed = extractJson<{ skills?: string[]; achievements?: string[]; summary?: string }>(ai)
    if (parsed) {
      console.log('[assistant:tools:deepInspect] ✓ parsed AI output:', { skills: parsed.skills?.length, achievements: parsed.achievements?.length, summary_len: parsed.summary?.length })
      skills = parsed.skills ?? []
      achievements = parsed.achievements ?? []
      summary = parsed.summary ?? ''
    } else {
      console.warn('[assistant:tools:deepInspect] ⚠ extractJson failed to parse AI response')
    }
  } else if (!hasAI()) {
    console.warn('[assistant:tools:deepInspect] ⚠ no AI provider — skipping skill extraction')
  } else if (!text) {
    console.warn('[assistant:tools:deepInspect] ⚠ no readable text from page')
  }

  console.log('[assistant:tools:deepInspect] COMPLETE:', { url, title, status: 'verified_evidence', skills_count: skills.length, achievements_count: achievements.length })
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
  console.log('[assistant:tools:getFixed40Matches] START:', { studentId })
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
  const result = mockTitles.map((title, i) => ({
    id: `demo_${i}`,
    title,
    score: Math.max(40, Math.round(85 - i * 0.8)),
    reason: 'Demo match — powered by the Fixed-40 engine.',
    is_demo: true,
  }))
  console.log('[assistant:tools:getFixed40Matches] COMPLETE:', { studentId, count: result.length })
  return result
}
