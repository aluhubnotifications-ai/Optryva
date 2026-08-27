import { Router } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { claudeJsonBlocks, parseDataUrl, extractDocxText, hasClaude, MODELS } from '@/lib/claude'
import { mistralJsonBlocks, hasMistral, MISTRAL_MODEL, MISTRAL_VISION_MODEL, extractPdfText } from '@/lib/mistral'
import { groqChatJson, hasGroq, groqModel } from '@/lib/groq'
import { sourceToMistralPart, sourceToBlock } from './assignment'

// The same fixed vocabularies the client uses for the category / listing-type
// selects, so generated values map cleanly onto the form without free-text drift.
const CATEGORIES = ['Software Engineering', 'Data', 'Design', 'Marketing', 'Operations', 'Finance', 'Product']
const LISTING_TYPES = ['Internship', 'Full-time', 'Part-time', 'Fellowship']

export function registerJob(r: Router) {
  /* ---------- §9.x AI job generator ----------
   * An employer uploads a brief (PDF/docx/txt/image) and/or writes what they want;
   * Groq (preferred) or Mistral/Claude drafts a complete, ready-to-post job listing:
   * title, description, category, listing type, location, pay, duration, tags,
   * responsibilities, qualifications and benefits. The employer then reviews and
   * edits the draft in the normal editor (or tweaks it with an instruction).
   * Generation is AI-only; with no AI key it fails clearly instead of faking it. */
  r.post('/job/generate', async (req, res) => {
    const { brief, sources, instruction, existing } = req.body ?? {}
    try {
      const docs = Array.isArray(sources) ? sources.slice(0, 5) : []
      const hasBrief = typeof brief === 'string' && brief.trim().length > 0
      if (!hasBrief && !docs.length) {
        return res.status(400).json({ error: 'no_input', message: 'Upload a document or describe the role first.' })
      }

      if (hasGroq()) {
        console.log('[routes:ai:job] → using Groq for job generation')
        const content = await buildClaudeContent(brief, docs, instruction, existing)
        const result = await groqChatJson<GeneratedJob>({
          system: JOB_SYSTEM,
          messages: [{ role: 'user', content: content.map((c) => c.text).filter(Boolean).join('\n\n') }],
          schema: JOB_SCHEMA,
          maxTokens: 2000,
          temperature: 0.3,
        })
        if (result) {
          console.log('[routes:ai:job] ✓ Groq returned valid job draft')
          return res.json(normalize(result))
        }
        console.warn('[routes:ai:job] ⚠ Groq returned null — falling through to Mistral')
      }
      if (hasMistral()) {
        const parts = await buildMistralContent(brief, docs, instruction, existing)
        if (!parts.length) return res.status(400).json({ error: 'no_input', message: 'Upload a document or describe the role first.' })
        const hasImage = parts.some((p) => p.type === 'image_url')
        const model = hasImage ? MISTRAL_VISION_MODEL : MISTRAL_MODEL
        const result = await mistralJsonBlocks<GeneratedJob>({
          model,
          maxTokens: 2000,
          system: JOB_SYSTEM,
          content: parts,
          schema: JOB_SCHEMA,
          temperature: 0.3,
        })
        if (result) return res.json(normalize(result))
        return res.status(503).json({ error: 'ai_unavailable', message: 'Mistral did not return a valid job draft.' })
      }
      if (hasClaude()) {
        const content = await buildClaudeContent(brief, docs, instruction, existing)
        const result = await claudeJsonBlocks<GeneratedJob>({
          model: MODELS.chat,
          maxTokens: 2000,
          system: JOB_SYSTEM,
          content,
          schema: JOB_SCHEMA,
        })
        if (result) return res.json(normalize(result))
        return res.status(503).json({ error: 'ai_unavailable' })
      }
      return res.status(503).json({
        error: 'ai_unavailable',
        message: 'Job generation needs an AI provider. Set MISTRAL_API_KEY (preferred) or ANTHROPIC_API_KEY.',
      })
    } catch (e: any) {
      res.status(500).json({ error: 'generation_failed', message: e?.message ?? String(e) })
    }
  })
}

/** Assemble Mistral content parts (brief + sources + revise/instruction). */
async function buildMistralContent(brief: string | undefined, docs: any[], instruction?: string, existing?: any): Promise<any[]> {
  const parts: any[] = []
  if (brief?.trim()) parts.push({ type: 'text', text: `EMPLOYER BRIEF:\n${brief.trim().slice(0, 8000)}` })
  for (const src of docs) {
    const part = await sourceToMistralPart(src)
    if (part) parts.push(part)
  }
  if (existing) {
    parts.push({ type: 'text', text: 'CURRENT DRAFT TO REVISE:\n' + JSON.stringify(existing, null, 2) })
  }
  parts.push({
    type: 'text',
    text:
      (instruction?.trim() ? `EMPLOYER INSTRUCTION: ${instruction.trim()}\n\n` : '') +
      'Draft a complete, ready-to-post job listing from the material above. Return ONLY the JSON requested.',
  })
  return parts
}

/** Assemble Claude content blocks (brief + sources + revise/instruction). */
async function buildClaudeContent(brief: string | undefined, docs: any[], instruction?: string, existing?: any): Promise<any[]> {
  const content: any[] = []
  if (brief?.trim()) content.push({ type: 'text', text: `EMPLOYER BRIEF:\n${brief.trim().slice(0, 8000)}` })
  for (const src of docs) {
    const block = await sourceToBlock(src)
    if (block) content.push(block)
  }
  if (existing) {
    content.push({ type: 'text', text: 'CURRENT DRAFT TO REVISE:\n' + JSON.stringify(existing, null, 2) })
  }
  content.push({
    type: 'text',
    text:
      (instruction?.trim() ? `EMPLOYER INSTRUCTION: ${instruction.trim()}\n\n` : '') +
      'Draft a complete, ready-to-post job listing from the material above. Return ONLY the JSON requested.',
  })
  return content
}

const JOB_SYSTEM = `You are an expert job-posting writer for early-career roles (internships, graduate programmes, fellowships, part-time and full-time positions) across Africa and globally. You turn a real brief or document into a clear, compelling, ready-to-post listing.

Rules:
- Write in fluent, professional English. Be concrete and specific; avoid vague filler ("great attitude", "dynamic environment") unless it is backed by a concrete detail.
- Do NOT invent facts the brief does not support. In particular:
  • If a salary/stipend is not stated, set "pay" to an empty string (""). Do not guess a number.
  • If a duration is not stated, set "duration" to "".
  • If a location is not stated, set "location" to "" (the employer will pick a country).
- "title" is a concise role title (e.g. "Frontend Engineering Intern").
- "description" is 2-4 paragraphs: what the role is, what the candidate will do, and why it matters. Use Markdown paragraphs only.
- "category" MUST be exactly one of: Software Engineering, Data, Design, Marketing, Operations, Finance, Product.
- "listing_type" MUST be exactly one of: Internship, Full-time, Part-time, Fellowship.
- "tags" are 4-8 short skills/keywords (e.g. ["React", "TypeScript", "UX research"]).
- "responsibilities" are 4-8 specific bullet points (one sentence each) of what the candidate will do.
- "qualifications" are 3-6 specific bullet points of what the candidate should have.
- "benefits" are 2-5 concrete perks (mentorship, certificate, stipend, learning budget, etc.).
- When revising (CURRENT DRAFT TO REVISE is present), honour the employer instruction and change only what improves it.

Return ONLY JSON matching the requested schema.`

const JOB_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    category: { type: 'string', description: 'One of: Software Engineering, Data, Design, Marketing, Operations, Finance, Product' },
    listing_type: { type: 'string', description: 'One of: Internship, Full-time, Part-time, Fellowship' },
    location: { type: 'string', description: 'Empty string if not stated.' },
    pay: { type: 'string', description: 'Empty string if not stated — never invent a number.' },
    duration: { type: 'string', description: 'Empty string if not stated.' },
    tags: { type: 'array', items: { type: 'string' } },
    responsibilities: { type: 'array', items: { type: 'string' } },
    qualifications: { type: 'array', items: { type: 'string' } },
    benefits: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'description', 'category', 'listing_type', 'location', 'pay', 'duration', 'tags', 'responsibilities', 'qualifications', 'benefits'],
  additionalProperties: false,
}

interface GeneratedJob {
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
}

function coerceCategory(c: string): string {
  const s = (c ?? '').trim()
  const exact = CATEGORIES.find((x) => x.toLowerCase() === s.toLowerCase())
  if (exact) return exact
  const partial = CATEGORIES.find((x) => s.toLowerCase().includes(x.toLowerCase()) || x.toLowerCase().includes(s.toLowerCase()))
  return partial ?? CATEGORIES[0]
}

function coerceListingType(t: string): string {
  const s = (t ?? '').trim()
  const exact = LISTING_TYPES.find((x) => x.toLowerCase() === s.toLowerCase())
  if (exact) return exact
  const partial = LISTING_TYPES.find((x) => s.toLowerCase().includes(x.toLowerCase()))
  return partial ?? 'Internship'
}

function strArr(v: unknown, cap = 10): string[] {
  return Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, cap) : []
}

/** Coerce/repair the model output so the client always gets a usable, on-vocabulary draft. */
function normalize(r: GeneratedJob) {
  return {
    title: (r.title ?? '').toString().trim().slice(0, 160) || 'Untitled role',
    description: (r.description ?? '').toString().trim().slice(0, 4000),
    category: coerceCategory(r.category),
    listing_type: coerceListingType(r.listing_type),
    location: (r.location ?? '').toString().trim().slice(0, 120),
    pay: (r.pay ?? '').toString().trim().slice(0, 80),
    duration: (r.duration ?? '').toString().trim().slice(0, 60),
    tags: strArr(r.tags, 8),
    responsibilities: strArr(r.responsibilities, 8),
    qualifications: strArr(r.qualifications, 6),
    benefits: strArr(r.benefits, 5),
  }
}
