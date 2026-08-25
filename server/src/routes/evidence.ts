import { Router } from '@/lib/http'
import { sb, must } from '@/db'
import { uid, now } from '@/lib/util'
import { requireAuth } from '@/lib/auth'
import { storeDocument, DOCUMENT_BUCKET } from '@/lib/documents'
import { extractionClient } from '@/lib/extractionClient'
import { mimeForName } from '@/lib/bytes'
import type { CandidateEvidenceItem } from '@/lib/extraction'

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
  status: 'self_reported' | 'ai_analyzed' | 'student_approved'
  verified_by: string | null
  verified_at: string | null
  verification_requested: boolean
  created_at: string
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

// Build a candidate-level AI summary of ALL a student's evidence — what they've
// actually done — for employers to read instead of scrolling raw gallery images.
// Heavy compute is delegated to the Extraction Worker.
async function refreshCandidateSummary(studentId: string) {
  try {
    const items = (await sb.from('evidence_items')
      .select('title,description,ai_summary,confirmed_skills,status')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false })).data as CandidateEvidenceItem[] | null
    const summary = await extractionClient.candidateSummary(items ?? [])
    if (summary) await sb.from('profiles').update({ evidence_summary: summary }).eq('id', studentId)
  } catch {
    /* non-fatal */
  }
}

// Keep the student's real `student_skills` in sync with confirmed evidence so
// approved evidence actually supports résumé matching.
async function syncSkills(studentId: string, skills: string[]) {
  for (const raw of skills) {
    const skill = raw.trim()
    if (!skill) continue
    const existing = (await sb.from('student_skills').select('id,verified').eq('owner_id', studentId).ilike('skill', skill).maybeSingle()).data as
      | { id: string; verified: boolean }
      | null
    if (existing) {
      await sb.from('student_skills').update({ updated_at: now() }).eq('id', existing.id)
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
        verified: false,
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

// Candidate-level AI summary for employers. Returns the cached profile summary,
// generating + storing it on first request if missing.
evidence.get('/student/:studentId/summary', async (req, res) => {
  const studentId = req.params.studentId
  const profile = (await sb.from('profiles').select('evidence_summary').eq('id', studentId).maybeSingle()).data as
    | { evidence_summary: string | null }
    | null
  let summary = profile?.evidence_summary ?? null
  if (!summary) {
    const items = (await sb.from('evidence_items')
      .select('title,description,ai_summary,confirmed_skills,status')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false })).data as CandidateEvidenceItem[] | null
    summary = await extractionClient.candidateSummary(items ?? [])
    if (summary) await sb.from('profiles').update({ evidence_summary: summary }).eq('id', studentId)
  }
  res.json({ summary: summary ?? 'No evidence submitted yet.' })
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

  // 1) Linked pages — fetched by the Extraction Worker (with Python-service
  //    fallback for JS-heavy sites done inside the worker).
  for (const link of (row.links ?? []).slice(0, 4)) {
    const content = await extractionClient.url(link)
    if (content) sources.push(`Linked page (${link}):\n${content}`)
  }

  // 2) Uploaded files — processed by type, all compute delegated to the worker.
  const fileEntries = [
    ...(row.file_path ? [{ path: row.file_path, name: row.file_name ?? 'file' }] : []),
    ...(row.files ?? []),
  ]
  for (const entry of fileEntries.slice(0, 8)) {
    const ext = (entry.name.split('.').pop() ?? '').toLowerCase()
    const mime = mimeForName(entry.name)
    const isImage = mime.startsWith('image/')
    const isPdf = ext === 'pdf'
    const delegatesToService = ext === 'docx' || ext === 'doc' || ext === 'odt' || ext === 'rtf' || ext === 'pptx' || ext === 'ppt' || ext === 'xlsx' || ext === 'xls' || mime.startsWith('audio/') || mime.startsWith('video/')

    const bytes = await downloadEvidenceFile(entry.path)
    if (!bytes) continue
    const base64 = bytesToBase64(bytes)
    const dataUrl = `data:${mime};base64,${base64}`

    if (isImage) {
      const desc = await extractionClient.image(dataUrl)
      if (desc) sources.push(`Image (${entry.name}):\n${desc}`)
      continue
    }
    if (isPdf) {
      const txt = await extractionClient.pdf(base64)
      if (txt) sources.push(`PDF (${entry.name}):\n${txt.slice(0, 6000)}`)
      continue
    }
    if (delegatesToService) {
      const svc = await extractionClient.file({ filename: entry.name, data_base64: base64, mime })
      if (svc?.text) sources.push(`File (${entry.name}):\n${svc.text.slice(0, 6000)}`)
    }
  }

  const text = [
    row.title ? `Title: ${row.title}` : '',
    row.description ? `Description: ${row.description}` : '',
    ...sources,
  ].filter(Boolean).join('\n\n')

  const analyzed = await extractionClient.analyze(text || (row.links ?? []).join('\n'))
  const skills = analyzed?.skills ?? []
  const summary = analyzed?.summary ?? null
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
      .update({ confirmed_skills: confirmed, status: 'student_approved' })
      .eq('id', row.id)
      .select('*')
      .single(),
  ) as EvidenceRow
  await syncSkills(row.student_id, confirmed)
  await refreshCandidateSummary(row.student_id)
  res.json(updated)
})

// ---------------------------------------------------------------------------
// Evidence chatbot — an AI assistant grounded in this candidate's evidence.
// Employers ask "is this true?" / "where is the proof?" and get honest,
// source-based answers plus suggestions for what to request next.
// ---------------------------------------------------------------------------

type ChatMsg = { id: string; role: 'employer' | 'ai'; content: string; created_at: string }

evidence.get('/student/:studentId/chat', async (req, res) => {
  const msgs = must(
    await sb.from('evidence_chat_messages')
      .select('id,role,content,created_at')
      .eq('user_id', req.user!.id)
      .eq('student_id', req.params.studentId)
      .order('created_at', { ascending: true })
      .limit(100),
  ) as ChatMsg[]
  res.json(msgs)
})

evidence.post('/student/:studentId/chat', async (req, res) => {
  const b = req.body ?? {}
  const question = String(b.content ?? '').trim()
  if (!question) return res.status(400).json({ error: 'content_required' })
  const studentId = req.params.studentId

  const userMsg = must(
    await sb.from('evidence_chat_messages').insert({
      id: uid('ch'),
      student_id: studentId,
      user_id: req.user!.id,
      role: 'employer',
      content: question,
    }).select('id,role,content,created_at').single(),
  ) as ChatMsg

  // Grounding context: every item incl. what AI extracted from its sources + links.
  const items = (await sb.from('evidence_items')
    .select('title,description,ai_summary,confirmed_skills,status,links,url')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })).data as CandidateEvidenceItem[] | null

  let answer: string | null = null
  try {
    answer = await extractionClient.ask(question, items ?? [])
  } catch {
    answer = null
  }
  if (!answer) answer = 'Sorry — I could not analyse the evidence right now. Please try again in a moment.'

  const aiMsg = must(
    await sb.from('evidence_chat_messages').insert({
      id: uid('ch'),
      student_id: studentId,
      user_id: req.user!.id,
      role: 'ai',
      content: answer,
    }).select('id,role,content,created_at').single(),
  ) as ChatMsg

  res.json([userMsg, aiMsg])
})
