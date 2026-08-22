import { Router } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { sb, must } from '@/db'
import { schoolGates, jobVisibleTo } from '@/lib/visibility'
import type { AiMatch } from '@/lib/matching'
import {
  studentRow,
  rowToMatchJob,
  loadJob,
  getMatch,
  cacheMap,
  matchReadiness,
  candidateJobs,
  visibleJobs,
  ensureResumeProfile,
  outcomeNudges,
  hasClaude,
} from './helpers'

export function registerMatches(r: Router) {
  r.get('/match/:jobId', async (req, res) => {
    const row = must(await sb.from('job_listings').select('*').eq('id', req.params.jobId).maybeSingle()) as any
    if (!row) return res.status(404).json({ error: 'not_found' })
    // Don't score (or even reveal a match for) a job the viewer can't see.
    const viewer = await studentRow(req.user!.id)
    const gates = await schoolGates([row.company_id])
    if (!jobVisibleTo(row, viewer, gates)) return res.status(404).json({ error: 'not_found' })
    const m = await getMatch(req.user!.id, rowToMatchJob(row))
    if (!m) return res.status(503).json({ error: 'ai_unavailable' })
    res.json(m)
  })

  r.get('/matches', async (req, res) => {
    const uid = req.user!.id
    const viewer = await studentRow(uid)
    const ready = matchReadiness(viewer)
    if (!ready.ready) return res.status(409).json({ error: 'profile_incomplete', missing: ready.missing })
    const rp = await ensureResumeProfile(viewer)
    const [visible, cm] = await Promise.all([candidateJobs(viewer, rp), cacheMap(uid)])
    // Parallel: cached jobs return instantly; uncached ones score concurrently.
    // Jobs Claude couldn't score (no key / error) are simply omitted.
    const out = await Promise.all(
      visible.map((rr) => getMatch(uid, rowToMatchJob(rr), {}, { row: viewer, rp, cached: cm.get(rr.id) ?? null })),
    )
    res.json(out.filter(Boolean))
  })

  // Rehydrate scores completed earlier today without invoking the scorer.
  // This is used after a page reload; it must remain read-only so the daily
  // run marker never causes cached matches to be recomputed.
  r.get('/matches/cached', async (req, res) => {
    const uid = req.user!.id
    const viewer = await studentRow(uid)
    const visible = await visibleJobs(viewer)
    const visibleIds = new Set(visible.map((job) => job.id))
    const cm = await cacheMap(uid)
    const out = [...cm.values()]
      .filter((row) => row.stale === 0 && visibleIds.has(row.job_id))
      .map((row) => {
        try { return JSON.parse(row.payload) as AiMatch } catch { return null }
      })
      .filter((match): match is AiMatch => !!match)
    res.json(out)
  })

  /* Streaming matches: scores roles one-by-one and emits live progress so the UI
   * can show "scoring X of N: <title>" with a real percentage — and keep updating
   * even if the user switches tabs (the stream drives a global store, not a view).
   * Frames: {meta:{total}} · {progress:{done,total,title}, match} per job · {done:true}. */
  r.post('/matches/stream', async (req, res) => {
    if (!hasClaude()) return res.status(503).json({ error: 'ai_unavailable' })
    const uid = req.user!.id
    const viewer = await studentRow(uid)
    const ready = matchReadiness(viewer)
    const rp = ready.ready ? await ensureResumeProfile(viewer) : null
    const [visible, cm] = ready.ready
      ? await Promise.all([candidateJobs(viewer, rp), cacheMap(uid)])
      : [[] as any[], new Map<string, AiMatch>()]
    const enc = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (o: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`))
        try {
          if (!ready.ready) { send({ notReady: { missing: ready.missing } }); send({ done: true }); return }
          const total = visible.length
          send({ meta: { total } })
          // Score concurrently in a bounded pool: progress stays per-role granular, but
          // we no longer spend 30 sequential round-trips. Cached roles still return
          // instantly; the pool size keeps us under the Haiku rate limit.
          const CONCURRENCY = 5
          let done = 0
          let cursor = 0
          const pool = Array.from({ length: Math.min(CONCURRENCY, total || 1) }, () => (async () => {
            while (true) {
              const i = cursor++
              if (i >= visible.length) break
              const rr = visible[i]
              const job = rowToMatchJob(rr)
              let m: AiMatch | null = null
              try { m = await getMatch(uid, job, {}, { row: viewer, rp, cached: cm.get(rr.id) ?? null }) } catch { m = null }
              done++
              send({ progress: { done, total, title: job.title }, match: m })
            }
          })())
          await Promise.all(pool)
          send({ done: true })
        } catch {
          send({ error: true })
        } finally {
          controller.close()
        }
      },
    })
    res.sse(stream)
  })

  // Cheap, AI-free nudges (DB-derived) so the Insights Snapshot can show the
  // "application progress" card without re-running the full scoring pass.
  r.get('/outcome-nudges', async (req, res) => {
    const uid = req.user!.id
    res.json(await outcomeNudges(uid))
  })

  /* Bounded, on-demand re-score of a student's EXISTING matches only (the roles
   * already in their cache) — used after they edit their CV and want fresh scores
   * without re-running the full discovery funnel. Concurrency-capped (3) so it
   * can't stampede Claude. Re-scores even stale rows and writes the new current-
   * engine score back into the cache. This is the safe answer to "I fixed my gaps,
   * do I need to re-match?": yes, but only your existing matches, not the world. */
  r.post('/matches/refresh', async (req, res) => {
    if (!hasClaude()) return res.status(503).json({ error: 'ai_unavailable' })
    const uid = req.user!.id
    const viewer = await studentRow(uid)
    const rp = await ensureResumeProfile(viewer)
    const cm = await cacheMap(uid)
    const ids = [...cm.keys()]
    if (!ids.length) return res.json({ refreshed: 0, total: 0 })
    const CONCURRENCY = 3
    let cursor = 0
    let refreshed = 0
    const pool = Array.from({ length: Math.min(CONCURRENCY, ids.length) }, async () => {
      while (true) {
        const i = cursor++
        if (i >= ids.length) break
        const jobId = ids[i]
        try {
          const row = await loadJob(jobId)
          if (!row) continue
          // cache:false forces a fresh score; the existing cache row is passed as
          // ctx so we don't re-query it, and the new score is upserted with stale=0.
          const m = await getMatch(uid, rowToMatchJob(row), { cache: false }, { row: viewer, rp, cached: cm.get(jobId) })
          if (m) refreshed++
        } catch {
          /* a single failure must not abort the whole refresh */
        }
      }
    })
    await Promise.all(pool)
    res.json({ refreshed, total: ids.length })
  })
}
