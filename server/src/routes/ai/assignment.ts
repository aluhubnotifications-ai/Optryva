import { Router } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { claudeJsonBlocks, parseDataUrl, extractDocxText, hasClaude, MODELS } from '@/lib/claude'

export function registerAssignment(r: Router) {
  /* ---------- §8.x AI assignment studio ----------
   * An employer uploads a brief (PDF/docx/txt/image) and/or describes the role;
   * Claude designs a practical candidate assignment: a title, an overview
   * prompt, 3-6 questions (mixed types), and a scoring rubric. Supports a
   * "refine" pass: the caller resends an instruction plus the current
   * questions/rubric and Claude revises them in place. */
  r.post('/assignment/generate', async (req, res) => {
    const { job, sources, instruction, existing } = req.body ?? {}
    if (!hasClaude()) {
      return res.json(fallbackAssignment(job, instruction))
    }
    try {
      const content: any[] = []
      const jobCtx = buildJobContext(job)
      if (jobCtx) content.push({ type: 'text', text: jobCtx })

      const docs = Array.isArray(sources) ? sources.slice(0, 5) : []
      for (const src of docs) {
        const block = await sourceToBlock(src)
        if (block) content.push(block)
      }
      if (!content.length) {
        return res.status(400).json({ error: 'no_input', message: 'Upload a document or describe the role first.' })
      }

      if (existing?.questions?.length || existing?.rubric?.length) {
        content.push({
          type: 'text',
          text:
            'CURRENT ASSIGNMENT TO REVISE:\n' +
            JSON.stringify({ questions: existing.questions ?? [], rubric: existing.rubric ?? [] }, null, 2),
        })
      }
      content.push({
        type: 'text',
        text:
          (instruction?.trim() ? `EMPLOYER INSTRUCTION: ${instruction.trim()}\n\n` : '') +
          'Design a candidate assignment for this role based on the material above. ' +
          'Return ONLY the JSON requested. Make questions specific to the content (not generic), ' +
          'with a realistic mix of essay, single/multiple choice, true/false, and optionally one ' +
          'file or video submission question. The rubric should have 3-5 criteria whose points sum to 100.',
      })

      const result = await claudeJsonBlocks<GeneratedAssignment>({
        model: MODELS.chat,
        maxTokens: 2000,
        system: ASSIGNMENT_SYSTEM,
        content,
        schema: ASSIGNMENT_SCHEMA,
      })
      if (!result) return res.status(503).json({ error: 'ai_unavailable' })
      res.json(normalize(result))
    } catch (e: any) {
      res.status(500).json({ error: 'generation_failed', message: e?.message ?? String(e) })
    }
  })
}

interface SourceInput {
  kind?: string
  name?: string
  dataUrl?: string
}

/** Turn an uploaded source into a Claude content block (image / PDF / extracted text). */
async function sourceToBlock(src: SourceInput): Promise<any | null> {
  if (!src?.dataUrl) return null
  const parsed = parseDataUrl(src.dataUrl)
  if (!parsed) return null
  const { mediaType, data } = parsed

  if (mediaType.startsWith('image/')) {
    return { type: 'image', source: { type: 'base64', media_type: mediaType as any, data } }
  }
  if (mediaType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
  }
  // .docx (Word) or any generic/octet-stream whose bytes are a ZIP → unzip locally.
  const isDocx = mediaType.includes('officedocument.wordprocessingml') || mediaType === 'application/vnd.ms-word'
  const looksLikeZip = mediaType !== 'application/pdf' && /^UEsDB/.test(data)
  if (isDocx || looksLikeZip) {
    const text = extractDocxText(data)
    if (text) return { type: 'text', text: `CONTENT OF ${src.name ?? 'document'}:\n${text.slice(0, 20000)}` }
    return null
  }
  if (mediaType.startsWith('text/')) {
    const text = Buffer.from(data, 'base64').toString('utf-8')
    return { type: 'text', text: `CONTENT OF ${src.name ?? 'document'}:\n${text.slice(0, 20000)}` }
  }
  return null
}

function buildJobContext(job: any): string {
  if (!job) return ''
  const parts = ['ROLE CONTEXT:']
  if (job.title) parts.push(`Title: ${job.title}`)
  if (job.type) parts.push(`Category: ${job.type}`)
  if (Array.isArray(job.tags) && job.tags.length) parts.push(`Tags: ${job.tags.join(', ')}`)
  if (job.description) parts.push(`Description:\n${job.description.slice(0, 4000)}`)
  return parts.join('\n')
}

const ASSIGNMENT_SYSTEM = `You are an expert hiring assessment designer for early-career roles (internships, graduate programmes, fellowships) across Africa and globally. You turn a real job brief into a fair, specific, practical candidate assignment that lets a human reviewer gauge skill — not a trivia quiz.

Rules:
- Questions must be grounded in the uploaded material / role context. Avoid generic filler ("Tell us about yourself").
- Vary question types: prefer essay + 1-2 single/multiple-choice + true/false for quick screening, and at most one file or video submission question (candidates upload, humans review).
- Set "required" true for the most important questions; allow 1-2 optional.
- The rubric must have 3-5 criteria with "points" that sum to exactly 100. Labels should name what is being judged (e.g. "Problem framing", "Technical approach").
- Keep the assignment title short and the prompt a single clear paragraph.
- When revising (CURRENT ASSIGNMENT TO REVISE is present), honour the employer instruction and change only what improves it.

Return ONLY JSON matching the requested schema.`

const ASSIGNMENT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short assignment title.' },
    prompt: { type: 'string', description: 'One-paragraph overview of what the candidate should submit.' },
    questions: {
      type: 'array',
      description: '3-6 questions.',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['essay', 'single_choice', 'multiple_choice', 'true_false', 'file', 'video'] },
          prompt: { type: 'string' },
          required: { type: 'boolean' },
          options: { type: 'array', items: { type: 'string' }, description: 'Required only for single/multiple choice.' },
        },
        required: ['type', 'prompt', 'required'],
        additionalProperties: false,
      },
    },
    rubric: {
      type: 'array',
      description: '3-5 criteria whose points sum to 100.',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          points: { type: 'integer' },
        },
        required: ['label', 'points'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'prompt', 'questions', 'rubric'],
  additionalProperties: false,
}

interface GeneratedAssignment {
  title: string
  prompt: string
  questions: { type: string; prompt: string; required?: boolean; options?: string[] }[]
  rubric: { label: string; points: number }[]
}

/** Coerce/repair the model output so the client always gets a usable shape. */
function normalize(r: GeneratedAssignment) {
  const questions = (r.questions ?? []).map((q) => ({
    type: ['essay', 'single_choice', 'multiple_choice', 'true_false', 'file', 'video'].includes(q.type) ? q.type : 'essay',
    prompt: (q.prompt ?? '').toString().slice(0, 500),
    required: !!q.required,
    options:
      q.type === 'single_choice' || q.type === 'multiple_choice'
        ? (q.options ?? ['', '']).map((o) => (o ?? '').toString()).filter((o, i, a) => o || i < 2)
        : undefined,
  }))
  const rubric = (r.rubric ?? [])
    .map((c) => ({ label: (c.label ?? '').toString().slice(0, 120), points: Number(c.points) || 0 }))
    .filter((c) => c.label)
  if (!rubric.length) {
    rubric.push({ label: 'Overall quality', points: 100 })
  }
  return {
    title: (r.title ?? 'Practical challenge').toString().slice(0, 160),
    prompt: (r.prompt ?? '').toString().slice(0, 2000),
    questions: questions.length ? questions : [{ type: 'essay', prompt: 'Describe how you would approach this role’s core challenge.', required: true }],
    rubric,
  }
}

/** No-API-key safety net: a sensible template derived from the role. */
function fallbackAssignment(job: any, instruction?: string) {
  const title = job?.title ? `${job.title} practical challenge` : 'Practical challenge'
  return {
    title,
    prompt:
      instruction?.trim() ||
      `Show us how you would approach a realistic problem for this ${job?.type || 'role'}. Share your assumptions, decisions, and what you would measure.`,
    questions: [
      { type: 'essay', prompt: 'Walk us through how you would tackle the core challenge of this role. What would you do in the first week?', required: true },
      { type: 'single_choice', prompt: 'Which best describes your approach to ambiguous problems?', required: true, options: ['Move fast and ask later', 'Clarify then plan', 'Wait for direction', 'Avoid them'] },
      { type: 'video', prompt: 'Record a 2-minute video introducing yourself and a project you’re proud of.', required: false },
    ],
    rubric: [
      { label: 'Problem framing and clarity', points: 30 },
      { label: 'Technical or strategic approach', points: 40 },
      { label: 'Communication and trade-offs', points: 30 },
    ],
  }
}
