// Heavy evidence-extraction compute. Lives in the dedicated Extraction Worker
// so the main API Worker stays lean (no Mistral/unpdf/network-crawler code).
// Everything here is pure: it takes prepared input and returns text/structured
// output. It never touches the database.

import { mistralText, mistralJsonBlocks, MISTRAL_VISION_MODEL, extractPdfText, hasMistral } from '@/lib/mistral'
import { extractViaService, hasExtractionService } from '@/lib/extractService'

// ---------------------------------------------------------------------------
// 1) Linked-page fetch (in-process; the Python service is the JS-heavy fallback)
// ---------------------------------------------------------------------------
export async function fetchLinkText(url: string): Promise<string | null> {
  // Try in-process first; fall back to the Python service for JS-heavy sites it
  // can render with a headless browser.
  const direct = await fetchLinkTextDirect(url)
  if (direct) return direct
  if (hasExtractionService()) {
    const svc = await extractViaService({ kind: 'url', url })
    return svc?.text ?? null
  }
  return null
}

async function fetchLinkTextDirect(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
      headers: {
        'User-Agent': 'OptryvaBot/1.0 (+https://optryva.aluhub-notifications.workers.dev)',
        Accept: 'text/html,application/xhtml+xml,text/plain',
      },
    })
    if (!resp.ok) return null
    const ct = resp.headers.get('content-type') ?? ''
    if (!/text\/(html|plain)|application\/xhtml/.test(ct)) return null
    const raw = await resp.text()
    if (raw.length > 500_000) return null
    const title = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? ''
    const desc =
      raw.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1]?.trim() ??
      raw.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1]?.trim() ??
      ''
    const body = raw
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 6000)
    const cleaned = [title, desc, body].filter(Boolean).join('\n').slice(0, 7000).trim()
    return cleaned || null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 2) Image understanding (Mistral vision)
// ---------------------------------------------------------------------------
export async function describeImage(dataUrl: string): Promise<string | null> {
  if (!hasMistral()) return null
  const out = await mistralJsonBlocks<{ description?: string }>({
    model: MISTRAL_VISION_MODEL,
    system:
      'You are analyzing an image that is a student\'s evidence of work (a ' +
      'certificate, a project screenshot, a photo of an event they ran, a design, ' +
      'a poster, a prototype). Write a concise, factual description of what the ' +
      'image shows and the skills or activities it demonstrates. Be specific and ' +
      'neutral. Return ONLY JSON: {"description": "..."}.',
    content: [{ type: 'image_url', image_url: { url: dataUrl } }],
    maxTokens: 400,
  })
  return out?.description?.trim() || null
}

// ---------------------------------------------------------------------------
// 3) One combined pass: skills + first-person "what the student did" summary
// ---------------------------------------------------------------------------
export async function analyzeEvidence(text: string): Promise<{ skills: string[]; summary: string | null }> {
  if (!hasMistral()) return { skills: [], summary: null }
  const sys =
    'You are a skills extractor for a student portfolio. Given a description of ' +
    'work and/or text pulled from linked web pages, documents, or images, return ' +
    'ONLY a JSON object with two fields: "skills" (an array of short, concrete ' +
    'skill or competency strings, e.g. "Python", "Data cleaning", "Stakeholder ' +
    'communication") and "summary" (a 2-3 sentence first-person description of ' +
    'what the student did and produced, mentioning concrete actions and ' +
    'deliverables). Base everything on the actual content provided, not the URLs ' +
    'themselves. If nothing concrete is present, return {"skills":[],"summary":""}.'
  const schema = { skills: ['string'], summary: 'string' }
  const out = await mistralJsonBlocks<{ skills?: string[]; summary?: string }>({
    system: sys,
    content: [{ type: 'text', text }],
    schema,
    maxTokens: 900,
  })
  if (!out) return { skills: [], summary: null }
  const skills = Array.isArray(out.skills)
    ? out.skills.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, 30)
    : []
  const summary = typeof out.summary === 'string' ? out.summary.trim() || null : null
  return { skills, summary }
}

// ---------------------------------------------------------------------------
// 4) PDF text (unpdf) — forwarded from the API Worker as base64
// ---------------------------------------------------------------------------
export async function pdfText(dataBase64: string): Promise<string | null> {
  return extractPdfText(dataBase64)
}

// ---------------------------------------------------------------------------
// 5) Delegate DOCX/PPTX/XLS/audio/video to the Python extraction service
// ---------------------------------------------------------------------------
export async function delegateFile(opts: {
  filename?: string
  data_base64?: string
  mime?: string
}): Promise<{ text: string } | null> {
  if (!hasExtractionService()) return null
  return extractViaService({ kind: 'file', ...opts })
}

// ---------------------------------------------------------------------------
// 6) Candidate-level summary from a list of evidence items
// ---------------------------------------------------------------------------
export type CandidateEvidenceItem = {
  title: string
  description: string | null
  ai_summary: string | null
  confirmed_skills: string[]
  status: string
}

export async function buildCandidateSummary(items: CandidateEvidenceItem[]): Promise<string | null> {
  if (!hasMistral()) return null
  if (!items || items.length === 0) return 'No evidence submitted yet.'
  const bullets = items
    .map((it, i) => {
      const skills = (it.confirmed_skills ?? []).join(', ')
      const detail = it.ai_summary || it.description || ''
      return `${i + 1}. ${it.title} [${it.status}]${skills ? ` — skills: ${skills}` : ''}\n   ${detail}`
    })
    .join('\n')
  const sys =
    'You are writing an evidence summary for an employer reviewing a student ' +
    'candidate on a hiring platform. Write a polished, recruiter-ready summary ' +
    'of what the candidate has actually done.\n\n' +
    'Structure:\n' +
    '1. A 2-3 sentence overview in active voice that captures the candidate\'s ' +
    'main strengths, domains, and the tangible outcomes they deliver.\n' +
    '2. A short "Evidence highlights" section where each evidence item is one ' +
    'bullet: lead with the item title in bold, then a crisp sentence on what ' +
    'they did and the impact or skill it demonstrates.\n\n' +
    'Tone: confident and professional. Prefer specific, concrete language over ' +
    'vague claims. Use active voice. Do not invent details not present. Use ' +
    'Markdown: bold for titles (**Title:**), "- " for bullets. Keep concise.'
  return mistralText({ system: sys, user: `Candidate evidence:\n${bullets}`, maxTokens: 900 })
}

// ---------------------------------------------------------------------------
// 7) Evidence chatbot: answer an employer's question grounded ONLY in the
//    candidate's actual evidence (files/links AI already read + descriptions).
// ---------------------------------------------------------------------------
export async function answerQuestion(
  question: string,
  items: CandidateEvidenceItem[],
): Promise<string | null> {
  if (!hasMistral()) return null
  const context = items && items.length > 0
    ? items
        .map((it, i) => {
          const skills = (it.confirmed_skills ?? []).join(', ')
          const detail = it.ai_summary || it.description || ''
          const links = (it as { links?: string[] }).links ?? []
          const linkLine = links.length ? `\n   Links provided by student: ${links.join(', ')}` : ''
          return `${i + 1}. "${it.title}" [verification status: ${it.status}]${skills ? ` — skills: ${skills}` : ''}\n   What the AI extracted from the source: ${detail || '(no extractable content)'}${linkLine}`
        })
        .join('\n\n')
    : '(No evidence items found.)'
  const sys =
    'You are Optryva\'s evidence-verification assistant helping an employer ' +
    'interview a student candidate\'s portfolio. The employer asks questions ' +
    'like "Is this true?", "Where is the proof?", "What exactly did they do?", ' +
    '"Does anything look inconsistent?".\n\n' +
    'Rules:\n' +
    '- Ground EVERY answer strictly in the evidence context below (what AI ' +
    'extracted from their files and linked pages). Never invent facts.\n' +
    '- Be honest about limits of verification: self-reported or unverified ' +
    'items are claims, not proof. Say so plainly when relevant.\n' +
    '- If the evidence does NOT answer the question, say what is missing and ' +
    'which specific link, file, or document the employer should request (e.g. ' +
    '"ask for the live dashboard URL" or "request the published policy brief PDF").\n' +
    '- Reference evidence items by number/title when pointing at proof.\n' +
    '- Keep answers concise and skimmable (short paragraphs or a few bullets). ' +
    'Professional tone, addressed to the recruiter.'
  return mistralText({
    system: sys,
    user: `CANDIDATE EVIDENCE CONTEXT:\n${context}\n\nEMPLOYER QUESTION: ${question}`,
    maxTokens: 700,
  })
}
