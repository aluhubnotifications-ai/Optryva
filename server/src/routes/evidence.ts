import { Router } from '@/lib/http'
import { sb, must } from '@/db'
import { uid, now } from '@/lib/util'
import { requireAuth } from '@/lib/auth'
import { storeDocument, DOCUMENT_BUCKET } from '@/lib/documents'
import { mistralText, mistralJsonBlocks, MISTRAL_VISION_MODEL, hasMistral, extractPdfText } from '@/lib/mistral'
import { extractViaService, hasExtractionService } from '@/lib/extractService'

export const evidence = Router()
evidence.use(requireAuth)

type EvidenceRow = {
  id: string
  student_id: string
  title: string
  description: string
  url: string | null
  file_path: string | null
  file_name: string | null
  links: string[]
  files: { path: string; name: string }[]
  used_in: string[]
  extracted_skills: string[]
  confirmed_skills: string[]
  status: 'self_reported' | 'ai_analyzed' | 'student_approved' | 'supervisor_verified' | 'employer_verified' | 'verified'
  verified_by: string | null
  verified_at: string | null
  verification_requested: boolean
  created_at: string
}

// One combined Mistral pass that returns both the inferred skills and a short
// first-person "what the student did" summary. Keeping skills + summary in a
// single call avoids firing multiple sequential model requests (which can be
// dropped by rate limits) and keeps extraction cheap.
async function analyzeEvidence(text: string): Promise<{ skills: string[]; summary: string | null }> {
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

// Lightweight in-process page fetcher — the Crawl4AI-equivalent step for our
// Node/Workers runtime. Fetch a public URL and return clean, AI-ready text
// (title + meta description + body). For JS-heavy sites a Crawl4AI/Playwright
// sidecar can be added later; user-submitted URLs stay the default source.
async function fetchLinkText(url: string): Promise<string | null> {
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

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text', rtf: 'application/rtf', txt: 'text/plain',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', aac: 'audio/aac', flac: 'audio/flac',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
}

function mimeForName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

// Pull the raw bytes of a stored evidence file back out of Supabase Storage so
// we can run AI over its actual content (not just its filename).
async function downloadEvidenceFile(path: string): Promise<Uint8Array | null> {
  try {
    const { data, error } = await sb.storage.from(DOCUMENT_BUCKET).download(path)
    if (error || !data) return null
    return new Uint8Array(await data.arrayBuffer())
  } catch {
    return null
  }
}

// Vision pass: describe what an image actually shows so skills can be inferred
// from it. Runs natively on Mistral's multimodal model (no extra service).
async function describeImage(dataUrl: string): Promise<string | null> {
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

// Plain-language "what the student did" summary, shown to reviewers so they
// understand the contribution at a glance.
async function summarizeEvidence(title: string, content: string): Promise<string | null> {
  if (!hasMistral()) return null
  const sys =
    'You write a short "what I did" summary for a student\'s evidence of work, ' +
    'used so reviewers understand the contribution. From the provided title and ' +
    'extracted content, write 2-3 sentences in the first person as if the ' +
    'student is describing what they actually did and produced. Mention concrete ' +
    'actions, deliverables, and context. No headers, no bullet points.'
  const user = `Title: ${title}\n\nContent:\n${content.slice(0, 6000)}`
  return mistralText({ system: sys, user, maxTokens: 300 })
}

// Keep the student's real `student_skills` in sync with confirmed evidence so
// approved evidence actually supports résumé matching. Verified evidence marks
// the skill verified; otherwise it's a normal student skill.
async function syncSkills(studentId: string, skills: string[], verified: boolean) {
  for (const raw of skills) {
    const skill = raw.trim()
    if (!skill) continue
    const existing = (await sb.from('student_skills').select('id,verified').eq('owner_id', studentId).ilike('skill', skill).maybeSingle()).data as
      | { id: string; verified: boolean }
      | null
    if (existing) {
      // Never downgrade an already-verified skill just because one evidence item changed.
      const nextVerified = verified || existing.verified
      await sb.from('student_skills').update({ verified: nextVerified, updated_at: now() }).eq('id', existing.id)
    } else {
      await sb.from('student_skills').insert({
        id: uid('sk'),
        owner_id: studentId,
        skill,
        level: 'intermediate',
        years: 0,
        sessions: 0,
        rating: 0,
        rating_count: 0,
        verified,
        portfolio_url: null,
      })
    }
  }
}

evidence.get('/', async (req, res) => {
  const rows = must(
    await sb.from('evidence_items').select('*').eq('student_id', req.user!.id).order('created_at', { ascending: false }),
  ) as EvidenceRow[]
  res.json(rows)
})

evidence.get('/student/:studentId', async (req, res) => {
  const rows = must(
    await sb.from('evidence_items').select('*').eq('student_id', req.params.studentId).order('created_at', { ascending: false }),
  ) as EvidenceRow[]
  res.json(rows)
})

evidence.post('/', async (req, res) => {
  const b = req.body ?? {}
  const title = String(b.title ?? '').trim()
  if (!title) return res.status(400).json({ error: 'title_required' })
  const description = String(b.description ?? '').trim()
  const links: string[] = Array.isArray(b.links)
    ? b.links.map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 20)
    : []
  const files: { path: string; name: string }[] = []
  if (Array.isArray(b.files)) {
    for (const f of b.files as { data?: string; name?: string }[]) {
      if (f && typeof f.data === 'string' && f.name) {
        try {
          const stored = await storeDocument(req.user!.id, 'evidence', String(f.name), f.data)
          files.push({ path: stored.url, name: String(f.name) })
        } catch {
          /* skip a file that fails to store */
        }
      }
    }
  }

  const row = must(
    await sb.from('evidence_items').insert({
      id: uid('ev'),
      student_id: req.user!.id,
      title,
      description,
      url: links[0] ?? null,
      file_path: files[0]?.path ?? null,
      file_name: files[0]?.name ?? null,
      links,
      files,
      used_in: [],
      status: 'self_reported',
    }).select('*').single(),
  ) as EvidenceRow
  res.json(row)
})

evidence.post('/:id/extract', async (req, res) => {
  const row = (await sb.from('evidence_items').select('*').eq('id', req.params.id).eq('student_id', req.user!.id).maybeSingle()).data as
    | EvidenceRow
    | null
  if (!row) return res.status(404).json({ error: 'not_found' })

  const sources: string[] = []

  // 1) Linked pages — fetch directly, fall back to the extraction service for
  //    JavaScript-heavy sites it can render with a headless browser.
  const links = row.links ?? []
  for (const link of links.slice(0, 4)) {
    let content = await fetchLinkText(link)
    if (!content && hasExtractionService()) {
      const svc = await extractViaService({ kind: 'url', url: link })
      content = svc?.text ?? null
    }
    if (content) sources.push(`Linked page (${link}):\n${content}`)
  }

  // 2) Uploaded files — process each by type.
  const fileEntries = [
    ...(row.file_path ? [{ path: row.file_path, name: row.file_name ?? 'file' }] : []),
    ...(row.files ?? []),
  ]
  for (const entry of fileEntries.slice(0, 8)) {
    const ext = (entry.name.split('.').pop() ?? '').toLowerCase()
    const mime = mimeForName(entry.name)
    const isImage = mime.startsWith('image/')
    const isPdf = ext === 'pdf'
    const isAudio = mime.startsWith('audio/')
    const isVideo = mime.startsWith('video/')
    const delegatesToService = ext === 'docx' || ext === 'doc' || ext === 'odt' || ext === 'rtf' || ext === 'pptx' || ext === 'ppt' || ext === 'xlsx' || ext === 'xls' || isAudio || isVideo

    const bytes = await downloadEvidenceFile(entry.path)
    if (!bytes) continue
    const base64 = bytesToBase64(bytes)
    const dataUrl = `data:${mime};base64,${base64}`

    if (isImage) {
      const desc = await describeImage(dataUrl)
      if (desc) sources.push(`Image (${entry.name}):\n${desc}`)
      continue
    }
    if (isPdf) {
      const txt = await extractPdfText(base64)
      if (txt) sources.push(`PDF (${entry.name}):\n${txt.slice(0, 6000)}`)
      continue
    }
    // Everything Node can't process natively goes to the extraction service.
    if (delegatesToService && hasExtractionService()) {
      const svc = await extractViaService({ kind: 'file', filename: entry.name, data_base64: base64, mime })
      if (svc?.text) sources.push(`File (${entry.name}):\n${svc.text.slice(0, 6000)}`)
    }
  }

  const text = [
    row.title ? `Title: ${row.title}` : '',
    row.description ? `Description: ${row.description}` : '',
    ...sources,
  ].filter(Boolean).join('\n\n')

  const { skills, summary } = await analyzeEvidence(text || links.join('\n'))
  // Mark the item as AI-analyzed so the gallery can show that step in the flow.
  const status = row.status === 'self_reported' ? 'ai_analyzed' : row.status
  const updated = must(
    await sb.from('evidence_items').update({ extracted_skills: skills, ai_summary: summary, status }).eq('id', row.id).select('*').single(),
  ) as EvidenceRow
  res.json(updated)
})

evidence.post('/:id/confirm', async (req, res) => {
  const b = req.body ?? {}
  const confirmed: string[] = Array.isArray(b.confirmed) ? b.confirmed.map((x: unknown) => String(x)).filter(Boolean) : []
  const row = (await sb.from('evidence_items').select('*').eq('id', req.params.id).eq('student_id', req.user!.id).maybeSingle()).data as
    | EvidenceRow
    | null
  if (!row) return res.status(404).json({ error: 'not_found' })
  const updated = must(
    await sb.from('evidence_items')
      .update({ confirmed_skills: confirmed, status: 'student_approved', verification_requested: false })
      .eq('id', row.id)
      .select('*')
      .single(),
  ) as EvidenceRow
  await syncSkills(row.student_id, confirmed, updated.status === 'verified')
  res.json(updated)
})

evidence.post('/:id/verify', async (req, res) => {
  const b = req.body ?? {}
  const verified = b.verified !== false
  const row = (await sb.from('evidence_items').select('*').eq('id', req.params.id).maybeSingle()).data as EvidenceRow | null
  if (!row) return res.status(404).json({ error: 'not_found' })
  const verifier = (await sb.from('profiles').select('user_type').eq('id', req.user!.id).maybeSingle()).data as { user_type: string } | null
  let status: EvidenceRow['status']
  if (verified) {
    // A school user verifies as "supervisor"; a company as "employer".
    if (verifier?.user_type === 'school') status = 'supervisor_verified'
    else if (verifier?.user_type === 'company') status = 'employer_verified'
    else status = 'verified'
  } else {
    status = row.verified_by ? 'student_approved' : 'self_reported'
  }
  const updated = must(
    await sb
      .from('evidence_items')
      .update({
        status,
        verified_by: verified ? req.user!.id : null,
        verified_at: verified ? now() : null,
      })
      .eq('id', row.id)
      .select('*')
      .single(),
  ) as EvidenceRow
  await syncSkills(row.student_id, updated.confirmed_skills, updated.status === 'verified' || updated.status === 'supervisor_verified' || updated.status === 'employer_verified')
  res.json(updated)
})

// Attach / detach this evidence item from one or more résumé profiles.
evidence.post('/:id/used-in', async (req, res) => {
  const b = req.body ?? {}
  const usedIn: string[] = Array.isArray(b.used_in) ? b.used_in.map((x: unknown) => String(x)).filter(Boolean) : []
  const row = (await sb.from('evidence_items').select('*').eq('id', req.params.id).eq('student_id', req.user!.id).maybeSingle()).data as
    | EvidenceRow
    | null
  if (!row) return res.status(404).json({ error: 'not_found' })
  const updated = must(
    await sb.from('evidence_items').update({ used_in: usedIn }).eq('id', row.id).select('*').single(),
  ) as EvidenceRow
  res.json(updated)
})

evidence.post('/:id/request-verification', async (req, res) => {
  const row = (await sb.from('evidence_items').select('*').eq('id', req.params.id).eq('student_id', req.user!.id).maybeSingle()).data as
    | EvidenceRow
    | null
  if (!row) return res.status(404).json({ error: 'not_found' })
  const updated = must(
    await sb.from('evidence_items').update({ verification_requested: true }).eq('id', row.id).select('*').single(),
  ) as EvidenceRow
  res.json(updated)
})
