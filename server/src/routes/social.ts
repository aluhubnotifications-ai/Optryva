import { Router } from '@/lib/http'
import { sb, must } from '@/db'
import { requireAuth } from '@/lib/auth'
import { rowToNotification } from '@/lib/serialize'
import { uid, now, notify, dmThreadId } from '@/lib/util'

/* ----------------------------- Follows + ratings + companies ----------------------------- */
export const social = Router()
social.use(requireAuth)

social.get('/follows/mine', async (req, res) => {
  const rows = must(await sb.from('company_follows').select('company_id, email_notifications').eq('student_id', req.user!.id)) as any[]
  res.json(rows.map((r: any) => ({ company_id: r.company_id, email_notifications: r.email_notifications === 1 })))
})

social.post('/follows/:companyId/toggle', async (req, res) => {
  const { companyId } = req.params
  const existing = must(await sb.from('company_follows').select('company_id').eq('student_id', req.user!.id).eq('company_id', companyId).maybeSingle())
  if (existing) {
    must(await sb.from('company_follows').delete().eq('student_id', req.user!.id).eq('company_id', companyId))
    return res.json({ following: false })
  }
  must(await sb.from('company_follows').insert({ student_id: req.user!.id, company_id: companyId, email_notifications: 1 }))
  res.json({ following: true })
})

social.post('/follows/:companyId/email', async (req, res) => {
  const on = !!req.body?.on
  must(await sb.from('company_follows').update({ email_notifications: on ? 1 : 0 }).eq('student_id', req.user!.id).eq('company_id', req.params.companyId))
  res.json({ ok: true })
})

social.get('/follows/count/:companyId', async (req, res) => {
  const { count, error } = await sb.from('company_follows').select('*', { count: 'exact', head: true }).eq('company_id', req.params.companyId)
  if (error) throw new Error(error.message)
  res.json({ count: count ?? 0 })
})

social.get('/ratings/:refType/:refId', async (req, res) => {
  const rows = must(await sb.from('company_ratings').select('*').eq('ref_type', req.params.refType).eq('ref_id', req.params.refId).order('created_at', { ascending: false }))
  res.json(rows)
})

social.post('/ratings', async (req, res) => {
  const { ref_type, ref_id, stars, comment } = req.body ?? {}
  const existing = must(await sb.from('company_ratings').select('id').eq('rater_id', req.user!.id).eq('ref_type', ref_type).eq('ref_id', ref_id).maybeSingle()) as any
  if (existing) {
    must(await sb.from('company_ratings').update({ stars, comment: comment ?? null }).eq('id', existing.id))
    return res.json({ id: existing.id })
  }
  const id = uid('rt')
  must(await sb.from('company_ratings').insert({ id, rater_id: req.user!.id, ref_type, ref_id, stars, comment: comment ?? null, created_at: now() }))
  res.json({ id })
})

/* ----------------------------- Notifications ----------------------------- */
export const notifications = Router()
notifications.use(requireAuth)

notifications.get('/', async (req, res) => {
  const rows = must(await sb.from('notifications').select('*').eq('user_id', req.user!.id).order('created_at', { ascending: false })) as any[]
  res.json(rows.map(rowToNotification))
})
notifications.post('/:id/read', async (req, res) => {
  must(await sb.from('notifications').update({ read: 1 }).eq('id', req.params.id).eq('user_id', req.user!.id))
  res.json({ ok: true })
})
notifications.post('/read-all', async (req, res) => {
  must(await sb.from('notifications').update({ read: 1 }).eq('user_id', req.user!.id))
  res.json({ ok: true })
})

/* ----------------------------- Messaging ----------------------------- */
export const messages = Router()
messages.use(requireAuth)

messages.get('/conversations', async (req, res) => {
  const meId = req.user!.id
  const me = must(await sb.from('profiles').select('user_type').eq('id', meId).maybeSingle()) as any
  const isCompany = me?.user_type === 'company' || me?.user_type === 'school'

  // 1) Application-scoped conversations (1–2 queries, no per-row lookups).
  let apps: any[]
  if (isCompany) {
    const myJobs = must(await sb.from('job_listings').select('id').eq('company_id', meId)) as any[]
    const ids = myJobs.map((j2) => j2.id)
    apps = ids.length ? (must(await sb.from('applications').select('id, student_id, job_id').in('job_id', ids)) as any[]) : []
  } else {
    apps = must(await sb.from('applications').select('id, student_id, job_id').eq('student_id', meId)) as any[]
  }
  // Batch-fetch the jobs for those applications in one query.
  const jobIds = [...new Set(apps.map((a) => a.job_id))]
  const jobRows = jobIds.length
    ? (must(await sb.from('job_listings').select('id, title, company_id').in('id', jobIds)) as any[])
    : []
  const jobMap = new Map<string, any>(jobRows.map((j2) => [j2.id, j2]))

  const convos: any[] = apps.map((a) => {
    const job = jobMap.get(a.job_id)
    return { thread_id: a.id, scope: 'application', counterpartId: isCompany ? a.student_id : job?.company_id, jobTitle: job?.title }
  })

  // 2) DM-scoped conversations involving me.
  const dmRows = must(await sb.from('messages').select('thread_id').eq('scope', 'dm')) as any[]
  const seen = new Set<string>()
  for (const d of dmRows) {
    if (seen.has(d.thread_id)) continue
    seen.add(d.thread_id)
    const parts = d.thread_id.split('__')
    if (!parts.includes(meId)) continue
    convos.push({ thread_id: d.thread_id, scope: 'dm', counterpartId: parts.find((x: string) => x !== meId) })
  }

  // 3) Fetch every relevant message in ONE query, then group + summarise in memory.
  const threadIds = convos.map((c) => c.thread_id)
  const allMsgs = threadIds.length
    ? (must(await sb.from('messages').select('thread_id, body, attachment, read, sender_id, created_at').in('thread_id', threadIds).eq('deleted', 0).order('created_at', { ascending: true })) as any[])
    : []
  const byThread = new Map<string, any[]>()
  for (const m of allMsgs) {
    const arr = byThread.get(m.thread_id)
    if (arr) arr.push(m)
    else byThread.set(m.thread_id, [m])
  }
  for (const c of convos) {
    const msgs = byThread.get(c.thread_id) ?? []
    const last = msgs[msgs.length - 1]
    c.lastBody = last?.body ?? (last?.attachment ? '📎 Attachment' : undefined)
    c.lastAt = last?.created_at
    c.unread = msgs.filter((m) => m.read === 0 && m.sender_id !== meId).length
  }
  convos.sort((a, b) => (b.lastAt ? +new Date(b.lastAt) : 0) - (a.lastAt ? +new Date(a.lastAt) : 0))
  res.json(convos)
})

messages.get('/thread/:threadId', async (req, res) => {
  const rows = must(await sb.from('messages').select('*').eq('thread_id', req.params.threadId).eq('deleted', 0).order('created_at', { ascending: true })) as any[]
  res.json(rows.map((r: any) => ({ ...r, reactions: JSON.parse(r.reactions ?? '{}'), attachment: r.attachment ? JSON.parse(r.attachment) : undefined, read: r.read === 1, deleted: false })))
})

messages.post('/thread/:threadId/read', async (req, res) => {
  must(await sb.from('messages').update({ read: 1 }).eq('thread_id', req.params.threadId).neq('sender_id', req.user!.id))
  res.json({ ok: true })
})

messages.post('/', async (req, res) => {
  const b = req.body ?? {}
  const id = uid('m')
  const ts = now()
  must(await sb.from('messages').insert({
    id, thread_id: b.thread_id, scope: b.scope, sender_id: req.user!.id,
    kind: b.kind ?? 'text', body: b.body ?? null,
    attachment: b.attachment ? JSON.stringify(b.attachment) : null,
    reactions: '{}', read: 0, deleted: 0, created_at: ts,
  }))
  res.json({ id, created_at: ts })
})

messages.post('/:id/react', async (req, res) => {
  const { emoji } = req.body ?? {}
  const r = must(await sb.from('messages').select('reactions').eq('id', req.params.id).maybeSingle()) as any
  if (!r) return res.status(404).json({ error: 'not_found' })
  const reactions = JSON.parse(r.reactions ?? '{}')
  const arr: string[] = reactions[emoji] ?? []
  reactions[emoji] = arr.includes(req.user!.id) ? arr.filter((u) => u !== req.user!.id) : [...arr, req.user!.id]
  if (!reactions[emoji].length) delete reactions[emoji]
  must(await sb.from('messages').update({ reactions: JSON.stringify(reactions) }).eq('id', req.params.id))
  res.json({ ok: true })
})

messages.delete('/:id', async (req, res) => {
  must(await sb.from('messages').update({ deleted: 1 }).eq('id', req.params.id).eq('sender_id', req.user!.id))
  res.json({ ok: true })
})

// Start/continue a DM thread with another user.
messages.post('/dm/:otherId', (req, res) => {
  res.json({ thread_id: dmThreadId(req.user!.id, req.params.otherId) })
})
