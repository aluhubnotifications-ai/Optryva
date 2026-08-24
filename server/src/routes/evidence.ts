import { Router } from '@/lib/http'
import { sb, must } from '@/db'
import { uid, now } from '@/lib/util'
import { requireAuth } from '@/lib/auth'
import { storeDocument } from '@/lib/documents'
import { mistralText, hasMistral } from '@/lib/mistral'

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

// Ask the model for a clean JSON array of skill strings inferred from the work.
async function extractEvidenceSkills(text: string): Promise<string[]> {
  if (!hasMistral()) return []
  const sys =
    'You are a skills extractor for a student portfolio. Given a description of ' +
    'work and/or text pulled from linked web pages (project pages, portfolios, ' +
    'GitHub repos, articles), return ONLY a JSON array of short, concrete skill or ' +
    'competency strings (e.g. "Python", "Data cleaning", "Stakeholder communication"). ' +
    'Base skills on the actual content provided, not the URLs themselves. No ' +
    'explanations, no objects — just a JSON array of strings. If nothing concrete ' +
    'is present, return [].'
  const out = await mistralText({ system: sys, user: text, maxTokens: 400 })
  if (!out) return []
  try {
    const parsed = JSON.parse(out)
    if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, 30)
  } catch {
    // Tolerate models that wrap the array in prose: grab the first [ ... ] block.
    const m = out.match(/\[[^\]]*\]/s)
    if (m) {
      try {
        const parsed = JSON.parse(m[0])
        if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, 30)
      } catch {
        /* ignore */
      }
    }
  }
  return []
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
  const links = row.links ?? []
  const linkBlocks: string[] = []
  for (const link of links.slice(0, 4)) {
    const content = await fetchLinkText(link)
    if (content) linkBlocks.push(`Linked page (${link}):\n${content}`)
  }
  const text = [
    row.title ? `Title: ${row.title}` : '',
    row.description ? `Description: ${row.description}` : '',
    ...linkBlocks,
  ].filter(Boolean).join('\n\n')
  const skills = await extractEvidenceSkills(text || links.join('\n'))
  // Mark the item as AI-analyzed so the gallery can show that step in the flow.
  const status = row.status === 'self_reported' ? 'ai_analyzed' : row.status
  const updated = must(
    await sb.from('evidence_items').update({ extracted_skills: skills, status }).eq('id', row.id).select('*').single(),
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
