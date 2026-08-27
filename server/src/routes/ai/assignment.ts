import { Router } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { claudeJsonBlocks, parseDataUrl, extractDocxText, hasClaude, MODELS, extractAnyDocumentText } from '@/lib/claude'
import { mistralJsonBlocks, hasMistral, MISTRAL_MODEL, MISTRAL_VISION_MODEL, extractPdfText } from '@/lib/mistral'
import { groqChatJson, hasGroq, groqModel } from '@/lib/groq'

export function registerAssignment(r: Router) {
  /* ---------- §8.x AI assignment studio ----------
   * An employer uploads a brief (PDF/docx/txt/image) and/or describes the role;
   * Mistral (preferred) or Claude designs a practical candidate assignment: a
   * title, an overview prompt, 3-6 questions (mixed types), and a scoring rubric.
   * Generation is AI-only (no template fallback). Supports a "refine" pass: the
   * caller resends an instruction plus the current questions/rubric and the model
   * revises them in place. */
  r.post('/assignment/generate', async (req, res) => {
    const { job, sources, instruction, existing } = req.body ?? {}
    try {
      const jobCtx = buildJobContext(job)
      const docs = Array.isArray(sources) ? sources.slice(0, 5) : []
      if (!jobCtx && !docs.length) {
        return res.status(400).json({ error: 'no_input', message: 'Upload a document or describe the role first.' })
      }

      // Assessment generation is AI-only (no deterministic template — a real brief
      // needs a model). Groq (preferred) or Mistral/Claude designs the assignment.
      // With no AI key at all, fail clearly instead of faking a result.
      if (hasGroq()) {
        console.log('[routes:ai:assignment] → using Groq for assignment generation')
        const content = await buildGroqContent(job, docs, instruction, existing)
        const result = await groqChatJson<GeneratedAssignment>({
          system: ASSIGNMENT_SYSTEM,
          messages: [{ role: 'user', content }],
          schema: ASSIGNMENT_SCHEMA,
          maxTokens: 2000,
          temperature: 0.4,
        })
        if (result) {
          console.log('[routes:ai:assignment] ✓ Groq returned valid assignment')
          return res.json(normalize(result))
        }
        console.warn('[routes:ai:assignment] ⚠ Groq returned null — falling through to Mistral')
      }
      if (hasMistral()) {
        const parts = await buildMistralContent(job, docs, instruction, existing)
        if (!parts.length) return res.status(400).json({ error: 'no_input', message: 'Upload a document or describe the role first.' })
        const hasImage = parts.some((p) => p.type === 'image_url')
        const model = hasImage ? MISTRAL_VISION_MODEL : MISTRAL_MODEL
        const result = await mistralJsonBlocks<GeneratedAssignment>({
          model,
          maxTokens: 2000,
          system: ASSIGNMENT_SYSTEM,
          content: parts,
          schema: ASSIGNMENT_SCHEMA,
          temperature: 0.4,
        })
        if (result) return res.json(normalize(result))
        return res.status(503).json({ error: 'ai_unavailable', message: 'Mistral did not return a valid assignment.' })
      }
      if (hasClaude()) {
        const content = await buildAssignmentContent(job, docs, instruction, existing)
        const result = await claudeJsonBlocks<GeneratedAssignment>({
          model: MODELS.chat,
          maxTokens: 2000,
          system: ASSIGNMENT_SYSTEM,
          content,
          schema: ASSIGNMENT_SCHEMA,
        })
        if (result) return res.json(normalize(result))
        return res.status(503).json({ error: 'ai_unavailable' })
      }
      return res.status(503).json({
        error: 'ai_unavailable',
        message: 'Assessment generation needs an AI provider. Set MISTRAL_API_KEY (preferred) or ANTHROPIC_API_KEY.',
      })
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

/** Assemble the content blocks (role context + sources + revise/instruction) shared
 *  by every generation provider, so Mistral and Claude receive identical grounding. */
async function buildAssignmentContent(job: any, sources: any, instruction?: string, existing?: any): Promise<any[]> {
  const content: any[] = []
  const jobCtx = buildJobContext(job)
  if (jobCtx) content.push({ type: 'text', text: jobCtx })

  const docs = Array.isArray(sources) ? sources.slice(0, 5) : []
  for (const src of docs) {
    const block = await sourceToBlock(src)
    if (block) content.push(block)
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
      'Design a STREAMLINED candidate assignment for this role based on the material above. ' +
      'Return ONLY the JSON requested. Use 3-5 questions, each prompt 1-2 clear sentences, and ' +
      'ONLY these "type" values: essay, single_choice, multiple_choice, true_false ' +
      '(choice questions must include 2-4 options). Rubric: 3-4 criteria whose points sum to 100.',
  })
  return content
}

/** Assemble Mistral content parts (role context + sources + revise/instruction).
 *  Images become `image_url` parts (read by pixtral); PDFs/docx/txt become extracted
 *  text. This is what lets Mistral actually *see* a brief instead of a placeholder. */
async function buildMistralContent(job: any, docs: any[], instruction?: string, existing?: any): Promise<any[]> {
  const parts: any[] = []
  const jobCtx = buildJobContext(job)
  if (jobCtx) parts.push({ type: 'text', text: jobCtx })

  for (const src of docs) {
    const part = await sourceToMistralPart(src)
    if (part) parts.push(part)
  }
  if (existing?.questions?.length || existing?.rubric?.length) {
    parts.push({
      type: 'text',
      text:
        'CURRENT ASSIGNMENT TO REVISE:\n' +
        JSON.stringify({ questions: existing.questions ?? [], rubric: existing.rubric ?? [] }, null, 2),
    })
  }
  parts.push({
    type: 'text',
    text:
      (instruction?.trim() ? `EMPLOYER INSTRUCTION: ${instruction.trim()}\n\n` : '') +
      'Design a STREAMLINED candidate assignment for this role based on the material above. ' +
      'Return ONLY the JSON requested. Use 3-5 questions, each prompt 1-2 clear sentences, and ' +
      'ONLY these "type" values: essay, single_choice, multiple_choice, true_false ' +
      '(choice questions must include 2-4 options). Rubric: 3-4 criteria whose points sum to 100.',
  })
  return parts
}

/** Assemble content for Groq (and other text-only providers). Extracts text from
 *  ANY document type locally — PDF, DOCX, PPTX, XLSX, DOC, RTF, HTML, CSV, JSON,
 *  plain text. Images are described inline (Groq/OpenAI compatible API supports
 *  base64 data URLs in some models; for text-only we embed a note). */
async function buildGroqContent(job: any, docs: any[], instruction?: string, existing?: any): Promise<string> {
  const parts: string[] = []
  const jobCtx = buildJobContext(job)
  if (jobCtx) parts.push(jobCtx)

  for (const src of docs) {
    if (!src?.dataUrl) continue
    const parsed = parseDataUrl(src.dataUrl)
    if (!parsed) continue
    const { mediaType } = parsed
    if (mediaType.startsWith('image/')) {
      parts.push(`[Image attached: ${src.name ?? 'image'} — ${mediaType}]`)
    } else {
      const text = await extractAnyDocumentText(src.dataUrl)
      if (text) parts.push(`CONTENT OF ${src.name ?? 'document'}:\n${text.slice(0, 20000)}`)
    }
  }

  if (existing?.questions?.length || existing?.rubric?.length) {
    parts.push('CURRENT ASSIGNMENT TO REVISE:\n' + JSON.stringify({ questions: existing.questions ?? [], rubric: existing.rubric ?? [] }, null, 2))
  }

  parts.push(
    (instruction?.trim() ? `EMPLOYER INSTRUCTION: ${instruction.trim()}\n\n` : '') +
    'Design a STREAMLINED candidate assignment for this role based on the material above. ' +
    'Return ONLY the JSON requested. Use 3-5 questions, each prompt 1-2 clear sentences, and ' +
    'ONLY these "type" values: essay, single_choice, multiple_choice, true_false ' +
    '(choice questions must include 2-4 options). Rubric: 3-4 criteria whose points sum to 100.',
  )
  return parts.join('\n\n')
}

/** Turn an uploaded source into a Mistral content part (image_url / extracted text). */
export async function sourceToMistralPart(src: SourceInput): Promise<any | null> {
  if (!src?.dataUrl) return null
  const parsed = parseDataUrl(src.dataUrl)
  if (!parsed) return null
  const { mediaType, data } = parsed

  if (mediaType.startsWith('image/')) {
    return { type: 'image_url', image_url: { url: `data:${mediaType};base64,${data}` } }
  }
  if (mediaType === 'application/pdf') {
    const text = await extractPdfText(data)
    if (text) return { type: 'text', text: `CONTENT OF ${src.name ?? 'PDF'}:\n${text.slice(0, 20000)}` }
    return null
  }
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

/** Turn an uploaded source into a Claude content block (image / PDF / extracted text). */
export async function sourceToBlock(src: SourceInput): Promise<any | null> {
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
- ALWAYS use exactly one of these question "type" values, and never any other word: "essay", "single_choice", "multiple_choice", "true_false".
  • essay: a written answer (1-3 short paragraphs).
  • single_choice / multiple_choice: MUST include 2-4 "options" (strings). For single_choice pick one; for multiple_choice any number.
  • true_false: a statement the candidate marks true/false.
- Keep it STREAMLINED: 3-5 questions total, each prompt a single clear sentence or two (no numbered sub-lists inside a prompt). Mix types — typically 1-2 essay + 1-2 choice/true-false. Do NOT use file or video uploads; keep everything text-based so candidates answer inline.
- Set "required" true for the most important questions; allow 1-2 optional.
- The rubric must have 3-4 criteria; each "points" is an integer and the criteria sum to EXACTLY 100. Labels name what is judged (e.g. "Problem framing", "Technical approach").
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
          type: { type: 'string', enum: ['essay', 'single_choice', 'multiple_choice', 'true_false'] },
          prompt: { type: 'string' },
          required: { type: 'boolean' },
          options: { type: 'array', items: { type: 'string' }, description: 'Required only for single/multiple choice.' },
          minWords: { type: 'integer', description: 'Optional minimum word count for essay answers.' },
          maxWords: { type: 'integer', description: 'Optional maximum word count for essay answers.' },
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
  questions: { type: string; prompt: string; required?: boolean; options?: string[]; minWords?: number; maxWords?: number }[]
  rubric: { label: string; points: number }[]
}

/** Map a model's (possibly off-spec) question type string onto the supported enum.
 *  Models sometimes say "short-answer"/"long_answer"/"paragraph" — fold those into
 *  "essay" so the structured output stays valid and the UI renders cleanly. */
function coerceType(t: string): GeneratedAssignment['questions'][number]['type'] {
  const s = (t ?? '').toLowerCase().replace(/[_\s-]/g, '')
  if (s.includes('single') || s === 'mcq' || s === 'mc' || s === 'multiplechoicedropdown') return 'single_choice'
  if (s.includes('multi') || s === 'multiselect' || s === 'checkboxes' || s === 'checkbox') return 'multiple_choice'
  if (s.includes('true') || s === 'bool' || s === 'yesno' || s === 'yes/no' || s === 'tf') return 'true_false'
  // file/video/uploads have been removed from assessments (candidates answer
  // inline). Coerce any model leak of those types to essay so nothing breaks.
  if (s.includes('video') || s.includes('file') || s.includes('upload') || s.includes('document')) return 'essay'
  // short/long answer, paragraph, written, open → essay
  return 'essay'
}

/** Coerce/repair the model output so the client always gets a usable shape. */
function normalize(r: GeneratedAssignment) {
  const questions = (r.questions ?? []).map((q) => {
    const type = coerceType(q.type)
    const isChoice = type === 'single_choice' || type === 'multiple_choice'
    return {
      type,
      prompt: (q.prompt ?? '').toString().slice(0, 500),
      required: !!q.required,
      options: isChoice
        ? (() => {
            const opts = (q.options ?? []).map((o) => (o ?? '').toString().trim()).filter(Boolean).slice(0, 6)
            return opts.length >= 2 ? opts : ['', '']
          })()
        : undefined,
      minWords: Number(q.minWords) > 0 ? Math.floor(Number(q.minWords)) : null,
      maxWords: Number(q.maxWords) > 0 ? Math.floor(Number(q.maxWords)) : null,
    }
  })
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


/* ---------- §5.x AI assessment scoring ----------
 * Given an approved assignment and a candidate's submitted answers, Claude returns
 * an overall rubric score (0..100), a recommendation, and per-question feedback.
 * This is a SUGGESTION only — the employer records the final, human decision.
 * Degrades to a transparent completion-based estimate when no API key is set. */
export interface AssignmentScoreResult {
  score: number
  recommendation: 'advance' | 'consider' | 'hold'
  feedback: { overall: string; perQuestion: { id: string; feedback: string }[] }
}

/** The candidate's EXISTING match score (computed earlier by the matcher from
 *  their résumé + this role). The employer's review AI uses it as a prior signal
 *  of role-fit so it doesn't re-derive fit from scratch — it only freshly
 *  evaluates the submitted assessment against the rubric. */
export interface MatchContext {
  score?: number | null
  rationale?: string | null
  matchedSkills?: string[]
}

const SCORE_SYSTEM = `You are an assistant to a human reviewer hiring for early-career roles. You evaluate a candidate's submitted assessment answers against the employer's approved rubric. You are rigorous and fair, you never invent information that is not in the answers, and you keep feedback specific and actionable.

Return ONLY JSON matching the requested schema. Score is 0..100. Recommendation must be one of: advance (strong evidence), consider (mixed), hold (weak or incomplete). Per-question feedback is a short sentence.`

const SCORE_SCHEMA = {
  type: 'object',
  properties: {
    overall_feedback: { type: 'string' },
    score: { type: 'integer', description: '0..100 overall rubric score' },
    recommendation: { type: 'string', enum: ['advance', 'consider', 'hold'] },
    per_question: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, feedback: { type: 'string' } },
        required: ['id', 'feedback'],
        additionalProperties: false,
      },
    },
  },
  required: ['overall_feedback', 'score', 'recommendation', 'per_question'],
  additionalProperties: false,
}

export async function scoreAssignmentWithAI(
  assignment: any,
  answers: { question_id?: string; criterion_id?: string; answer: string | string[] }[],
  job?: any,
  matchContext?: MatchContext | null,
): Promise<AssignmentScoreResult> {
  const questions = assignment?.questions?.length
    ? assignment.questions
    : (assignment?.rubric ?? []).map((c: any) => ({ id: c.id, prompt: c.label, required: true }))
  const answeredCount = answers.filter((a) => (Array.isArray(a.answer) ? a.answer.length > 0 : !!String(a.answer ?? '').trim())).length
  const completion = questions.length ? answeredCount / questions.length : 0

  // The employer's review AI reasons from the candidate's already-computed match
  // fit (résumé + role), not from scratch. This is the "judge them on their
  // previous score" rule: the fit prior is the basis, the assessment is the fresh evidence.
  const priorBlock = matchContext && matchContext.score != null
    ? 'CANDIDATE’S EXISTING MATCH SCORE (from the matcher, grounded in their résumé + this role — treat as a prior, do NOT re-derive fit):\n' +
      `• Role fit: ${matchContext.score}%\n` +
      (matchContext.rationale ? `• Why this fit was assigned: ${matchContext.rationale}\n` : '') +
      (matchContext.matchedSkills?.length ? `• Skills that drove the fit: ${matchContext.matchedSkills.join(', ')}\n` : '') +
      '\nYou are evaluating ONLY the submitted assessment against the rubric. Reconcile it with the fit prior above: if the assessment confirms or contradicts that prior, say so explicitly. Never invent résumé facts the matcher did not already establish.'
    : ''

  const answerText = answers
    .map((a) => {
      const q = questions.find((x: any) => x.id === (a.question_id ?? a.criterion_id))
      const ans = Array.isArray(a.answer) ? a.answer.join(', ') : String(a.answer ?? '')
      return `Q: ${q?.prompt ?? a.question_id ?? a.criterion_id}\nA: ${ans ?? '(no answer)'}`
    })
    .join('\n\n')

  const content: any[] = [
    { type: 'text', text: `ROLE: ${job?.title ?? 'role'}\n${job?.description ? job.description.slice(0, 3000) : ''}` },
    { type: 'text', text: `ASSIGNMENT:\n${JSON.stringify({ title: assignment?.title, prompt: assignment?.prompt, questions: assignment?.questions, rubric: assignment?.rubric }, null, 2)}` },
    { type: 'text', text: `CANDIDATE SUBMISSION:\n${answerText}` },
    ...(priorBlock ? [{ type: 'text', text: priorBlock }] : []),
    { type: 'text', text: 'Evaluate the submission against the approved rubric. Return ONLY the requested JSON.' },
  ]

  // Transparent fallback used when no AI provider succeeds: a completion-based
  // estimate, clearly labelled so the employer knows it isn't a real evaluation.
  const estimate = (): AssignmentScoreResult => {
    const score = Math.round(40 + completion * 50)
    const priorNote = matchContext?.score != null ? ` The candidate's existing match fit was ${matchContext.score}%.` : ''
    return {
      score,
      recommendation: score >= 75 ? 'advance' : score >= 55 ? 'consider' : 'hold',
      feedback: {
        overall: 'AI scoring is unavailable right now — this score is a transparent estimate based on how much of the assignment was completed. A human should review the answers directly before deciding.' + priorNote,
        perQuestion: questions.map((q: any) => ({ id: q.id, feedback: 'Not auto-evaluated — please review manually.' })),
      },
    }
  }

  // Mistral is preferred for scoring (so its behaviour is observable to the
  // employer during testing), then Claude, then the transparent estimate.
  if (hasMistral()) {
    try {
      const result = await mistralJsonBlocks<any>({ model: MISTRAL_MODEL, maxTokens: 1500, system: SCORE_SYSTEM, content, schema: SCORE_SCHEMA })
      if (result) {
        const score = Math.max(0, Math.min(100, Math.round(Number(result.score) || 0)))
        const recommendation = ['advance', 'consider', 'hold'].includes(result.recommendation) ? result.recommendation : (score >= 75 ? 'advance' : score >= 55 ? 'consider' : 'hold')
        const perQuestion = (result.per_question ?? []).map((p: any) => ({ id: String(p.id), feedback: String(p.feedback ?? '') }))
        return { score, recommendation, feedback: { overall: String(result.overall_feedback ?? ''), perQuestion } }
      }
    } catch {
      /* fall through to Claude */
    }
  }
  if (hasClaude()) {
    try {
      const result = await claudeJsonBlocks<any>({ model: MODELS.chat, maxTokens: 1500, system: SCORE_SYSTEM, content, schema: SCORE_SCHEMA })
      if (result) {
        const score = Math.max(0, Math.min(100, Math.round(Number(result.score) || 0)))
        const recommendation = ['advance', 'consider', 'hold'].includes(result.recommendation) ? result.recommendation : (score >= 75 ? 'advance' : score >= 55 ? 'consider' : 'hold')
        const perQuestion = (result.per_question ?? []).map((p: any) => ({ id: String(p.id), feedback: String(p.feedback ?? '') }))
        return { score, recommendation, feedback: { overall: String(result.overall_feedback ?? ''), perQuestion } }
      }
    } catch {
      /* fall through to estimate */
    }
  }
  return estimate()
}
