// Heavy evidence-extraction compute. Lives in the dedicated Extraction Worker
// so the main API Worker stays lean (no Mistral/unpdf/network-crawler code).
// Everything here is pure: it takes prepared input and returns text/structured
// output. It never touches the database.

import { mistralText, mistralJsonBlocks, MISTRAL_VISION_MODEL, extractPdfText, hasMistral } from '@/lib/mistral'
import { groqText, groqChatJson, hasGroq, groqModel } from '@/lib/groq'
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
  if (!hasGroq() && !hasMistral()) return { skills: [], summary: null }
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
  let out: { skills?: string[]; summary?: string } | null = null
  if (hasGroq()) {
    out = await groqChatJson<{ skills?: string[]; summary?: string }>({
      system: sys,
      messages: [{ role: 'user', content: text }],
      schema,
      maxTokens: 900,
    })
  }
  if (!out && hasMistral()) {
    out = await mistralJsonBlocks<{ skills?: string[]; summary?: string }>({
      system: sys,
      content: [{ type: 'text', text }],
      schema,
      maxTokens: 900,
    })
  }
  if (!out) return { skills: [], summary: null }
  let skills = Array.isArray(out.skills)
    ? out.skills.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, 30)
    : []

  // Normalize: split skills that look like two skills concatenated without a
  // separator (e.g. "Event productionTeamwork" → ["Event production", "Teamwork"]).
  skills = skills.flatMap((s) => {
    if (s.length < 3) return [s]
    const parts = s.split(/(?=[A-Z])/g).map((p) => p.trim()).filter(Boolean)
    return parts.length > 1 ? parts : [s]
  })

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
  links?: string[]
  files?: { path: string; name: string }[]
}

export async function buildCandidateSummary(
  items: CandidateEvidenceItem[],
  jobDescription = '',
): Promise<string | null> {
  if (!hasMistral()) return null
  if (!items || items.length === 0) return 'No evidence submitted yet.'
  const bullets = items
    .map((it, i) => {
      const skills = (it.confirmed_skills ?? []).join(', ')
      const detail = it.ai_summary || it.description || ''
      const links = (it.links ?? []).join(', ')
      const files = (it.files ?? []).map((f) => f.name).join(', ')
      const proofs: string[] = []
      if (links) proofs.push(`links: ${links}`)
      if (files) proofs.push(`files: ${files}`)
      const proofLine = proofs.length ? `\n   Proof sources: ${proofs.join('; ')}` : ''
      return `${i + 1}. ${it.title} [${it.status}]${skills ? ` — skills: ${skills}` : ''}\n   ${detail}${proofLine}`
    })
    .join('\n')

  const jobFocus = jobDescription.trim()
    ? 'A specific job description is provided below. Write the summary for the ' +
      'recruiter evaluating this candidate FOR THAT ROLE. Lead with a short ' +
      'overview of fit, then only surface the evidence items that are genuinely ' +
      'relevant to the role — and for each, state specifically why it matters ' +
      'for this job. If the candidate\'s evidence does NOT clearly support the ' +
      'role, say so plainly and note what is missing (e.g. "no evidence of ' +
      'client-facing experience for this account-management role"). Do NOT list ' +
      'every item; ignore evidence irrelevant to the posting.\n\n' +
      `JOB DESCRIPTION:\n${jobDescription.trim()}\n\n`
    : 'Write a general, recruiter-ready summary of everything the candidate has ' +
      'actually done (no specific job in context).\n\n'

  const sys =
    'You are writing an evidence summary for an employer reviewing a student ' +
    'candidate on a hiring platform.\n\n' +
    jobFocus +
    'Structure:\n' +
    '1. A 2-3 sentence overview in active voice that captures the candidate\'s ' +
    'main strengths, domains, and the tangible outcomes they deliver.\n' +
    '2. A short "Evidence highlights" section where each relevant evidence item ' +
    'is one bullet: lead with the item title in bold, then a crisp sentence on ' +
    'what they did and the impact or skill it demonstrates.\n\n' +
    'Tone: confident, professional, and fluent. Prefer specific, concrete ' +
    'language over vague claims. Use active voice. Do not invent details not ' +
    'present. Write in clear, correct English. Use Markdown: **bold** for titles ' +
    '(**Title:**) and "- " for bullets. Never use single asterisks (*) as ' +
    'decoration. Keep concise.'
   // Groq first; if it returns null (rate limit, error, etc.), fall through to Mistral.
   let result = hasGroq()
     ? await groqText({ system: sys, user: `Candidate evidence:\n${bullets}`, maxTokens: 900 })
     : null
   if (!result && hasMistral()) {
     result = await mistralText({ system: sys, user: `Candidate evidence:\n${bullets}`, maxTokens: 900 })
   }
   if (!result) console.warn('[extraction:buildCandidateSummary] both Groq and Mistral returned null')
   return result
}

// ---------------------------------------------------------------------------
// 7) Evidence chatbot: answer an employer's question grounded ONLY in the
//    candidate's actual evidence (files/links AI already read + descriptions).
// ---------------------------------------------------------------------------
export async function answerQuestion(
  question: string,
  items: CandidateEvidenceItem[],
): Promise<string | null> {
  if (!hasGroq() && !hasMistral()) return null
  const context = items && items.length > 0
    ? items
        .map((it, i) => {
          const skills = (it.confirmed_skills ?? []).join(', ')
          const detail = it.ai_summary || it.description || ''
          const links = (it as { links?: string[] }).links ?? []
          const linkLine = links.length ? `\n   Links provided by student: ${links.join(', ')}` : ''
          return `• "${it.title}" [status: ${it.status}]${skills ? ` — skills: ${skills}` : ''}\n   What the AI extracted from the source: ${detail || '(no extractable content)'}${linkLine}`
        })
        .join('\n\n')
    : '(No evidence items found.)'
  const sys =
    'You are Optryva\'s evidence assistant helping an employer evaluate a student ' +
    'candidate\'s portfolio of work. The employer asks things like "What exactly ' +
    'did they do?", "Where is the proof?", "Does this match the role?", "What is ' +
    'missing?".\n\n' +
    'Rules:\n' +
    '- Ground EVERY answer strictly in the evidence context below (what AI ' +
    'extracted from their files and linked pages). Never invent facts.\n' +
    '- Be clear about what is directly evidenced versus what the student merely ' +
    'asserts. Say plainly when something is a claim without supporting source.\n' +
    '- If the evidence does NOT answer the question, say what is missing and ' +
    'which specific link, file, or document the employer should request (e.g. ' +
    '"ask for the live dashboard URL" or "request the published policy brief PDF").\n' +
    '- Reference each piece of evidence by its TITLE (e.g. "the Youth Leadership ' +
    'Initiative"), NEVER by item number (there is no #1/#2 in the UI).\n' +
    '- WRITE TIGHTLY. Lead with a 1–2 sentence direct answer. Then, only if you ' +
    'must list items, use a short markdown bullet list (- ). Avoid long walls of ' +
    'text, repetition, and generic filler. Use **bold** for evidence titles and ' +
    'key outcomes. Skip headings unless the answer truly needs sections.\n' +
    '- Professional, recruiter-facing tone. Be specific and concrete. Write in ' +
    'clear, fluent, grammatically correct English. Do NOT use single asterisks ' +
    '(*) for decoration — reserve **bold** for true emphasis only.'
    let answer = hasGroq()
      ? await groqText({ system: sys, user: `CANDIDATE EVIDENCE CONTEXT:\n${context}\n\nEMPLOYER QUESTION: ${question}`, maxTokens: 700 })
      : null
    if (!answer && hasMistral()) {
      answer = await mistralText({
        system: sys,
        user: `CANDIDATE EVIDENCE CONTEXT:\n${context}\n\nEMPLOYER QUESTION: ${question}`,
        maxTokens: 700,
      })
    }
    return answer
 }
