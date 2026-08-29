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
  asResumeProfile,
  outcomeNudges,
  hasClaude,
} from './helpers'
import { requestManualMatch, loadOrRecalculatePair } from '@/lib/matchEngine'
import { getQueueStatus } from '@/lib/matchQueue'

export function registerMatches(r: Router) {
  r.get('/match/:jobId', async (req, res) => {
    const row = must(await sb.from('job_listings').select('*').eq('id', req.params.jobId).maybeSingle()) as any
    if (!row) return res.status(404).json({ error: 'not_found' })
    // Don't score (or even reveal a match for) a job the viewer can't see.
    const viewer = await studentRow(req.user!.id)
    const gates = await schoolGates([row.company_id])
    if (!jobVisibleTo(row, viewer, gates)) return res.status(404).json({ error: 'not_found' })
    const resumeId = req.query.resume_id as string | undefined
    const m = await getMatch(req.user!.id, rowToMatchJob(row), {}, { resumeId: resumeId ?? null })
    if (!m) return res.status(503).json({ error: 'ai_unavailable' })
    res.json(m)
  })

  r.get('/matches', async (req, res) => {
    const uid = req.user!.id
    const viewer = await studentRow(uid)
    const ready = matchReadiness(viewer)
    if (!ready.ready) return res.status(409).json({ error: 'profile_incomplete', missing: ready.missing })
    const resumeId = req.query.resume_id as string | undefined
    // Load the specific resume profile to score against (or the active one).
    let resumeRow: any = null
    if (resumeId) {
      resumeRow = (await sb.from('resume_profiles').select('*').eq('id', resumeId).eq('student_id', uid).maybeSingle()).data as any
      if (!resumeRow) return res.status(404).json({ error: 'resume_not_found' })
    } else {
      resumeRow = (await sb.from('resume_profiles').select('*').eq('student_id', uid).eq('active', 1).maybeSingle()).data as any
    }
     const rp = resumeRow ? asResumeProfile(resumeRow) : await ensureResumeProfile(viewer)
     const [visible, cm] = await Promise.all([candidateJobs(viewer, rp), cacheMap(uid, resumeId ?? null)])
     // Parallel: cached jobs return instantly; uncached ones score concurrently.
     // Jobs Claude couldn't score (no key / error) are simply omitted.
     const out = await Promise.all(
       visible.map((rr) => getMatch(uid, rowToMatchJob(rr), {}, { row: viewer, rp, resumeId: resumeId ?? null, cached: cm.get(rr.id) ?? null })),
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
    const resumeId = req.query.resume_id as string | undefined
    const cm = await cacheMap(uid, resumeId ?? null)
    const out = [...cm.values()]
      .filter((row) => {
        if (row.stale !== 0) return false
        if (!visibleIds.has(row.job_id)) return false
        return true
      })
      .map((row) => {
        try { return JSON.parse(row.payload) as AiMatch } catch { return null }
      })
      .filter((match): match is AiMatch => !!match)
    res.json(out)
  })

  /* Streaming matches: scores roles one-by-one and emits live progress so the UI
   * can show "scoring X of N: <title>" with a real percentage — and keep updating
   * even if the user switches tabs (the stream drives a global store, not a view).
   * Frames:
   *   {activity:{step,label}}      — pipeline stage (reading → résumé → scoring → ranking)
   *   {meta:{total}}               — how many roles will be scored
   *   {progress:{done,total,title},match} per job
   *   {notReady:{missing}} · {error:true} · {done:true} */
  r.post('/matches/stream', async (req, res) => {
    if (!hasClaude()) return res.status(503).json({ error: 'ai_unavailable' })
    const uid = req.user!.id
    const resumeId = req.body?.resume_id as string | undefined
    const enc = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
     async start(controller) {
        const send = (o: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`))
        try {
          send({ activity: { step: 'reading', label: 'Reading your profile…' } })
          const viewer = await studentRow(uid)
          send({ activity: { step: 'resume', label: 'Extracting & understanding your résumé…' } })
          const ready = matchReadiness(viewer)
          if (!ready.ready) { send({ notReady: { missing: ready.missing } }); send({ done: true }); return }
          let rp: any = null
          if (resumeId) {
            const rr = (await sb.from('resume_profiles').select('*').eq('id', resumeId).eq('student_id', uid).maybeSingle()).data as any
            if (!rr) { send({ error: true, reason: 'resume_not_found' }); send({ done: true }); return }
            rp = asResumeProfile(rr)
          } else {
            rp = await ensureResumeProfile(viewer)
          }
          send({ activity: { step: 'scoring', label: 'Scoring open roles against your profile…' } })
          const [visible, cm] = await Promise.all([candidateJobs(viewer, rp), cacheMap(uid, resumeId ?? null)])
          const total = visible.length
          send({ meta: { total, resumeId: resumeId ?? null } })
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
              try { m = await getMatch(uid, job, {}, { row: viewer, rp, resumeId: resumeId ?? null, cached: cm.get(rr.id) ?? null }) } catch { m = null }
              done++
              send({ progress: { done, total, title: job.title }, match: m })
            }
          })())
          await Promise.all(pool)
          send({ activity: { step: 'ranking', label: 'Ranking your best fits…' } })
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
    const resumeId = req.body?.resume_id as string | undefined
    const viewer = await studentRow(uid)
    const cm = await cacheMap(uid, resumeId ?? null)
    const jobIds = [...new Set([...cm.keys()])].filter(Boolean)
    if (!jobIds.length) return res.json({ refreshed: 0, total: 0 })
    let rp: any = null
    if (resumeId) {
      const rr = (await sb.from('resume_profiles').select('*').eq('id', resumeId).eq('student_id', uid).maybeSingle()).data as any
      if (rr) rp = asResumeProfile(rr)
    } else {
      rp = await ensureResumeProfile(viewer)
    }
    const CONCURRENCY = 3
    let cursor = 0
    let refreshed = 0
    const pool = Array.from({ length: Math.min(CONCURRENCY, jobIds.length) }, async () => {
      while (true) {
        const i = cursor++
        if (i >= jobIds.length) break
        const jobId = jobIds[i]
        try {
          const row = await loadJob(jobId)
          if (!row) continue
          // cache:false forces a fresh score; the existing cache row is passed as
          // ctx so we don't re-query it, and the new score is upserted with stale=0.
          const m = await getMatch(uid, rowToMatchJob(row), { cache: false }, { row: viewer, rp, resumeId: resumeId ?? null, cached: cm.get(jobId) })
          if (m) refreshed++
        } catch {
          /* a single failure must not abort the whole refresh */
        }
      }
    })
    await Promise.all(pool)
    res.json({ refreshed, total: jobIds.length })
  })

  // --- Manual match: student clicks "Match this job" ---
  // Always uses saved filter points as context. Bypasses auto threshold.
  // Respects hard eligibility and privacy. Triggers AI review if no current result.
  r.post('/matches/manual', async (req, res) => {
    const uid = req.user!.id
    const { job_id, resume_id, refresh = false } = req.body ?? {}

    if (!job_id) return res.status(400).json({ error: 'job_id_required' })

    const viewer = await studentRow(uid)
    const ready = matchReadiness(viewer)
    if (!ready.ready) return res.status(409).json({ error: 'profile_incomplete', missing: ready.missing })

    // Verify the résumé belongs to the student (if specified)
    let resumeRow: any = null
    if (resume_id) {
      resumeRow = (await sb.from('resume_profiles').select('*').eq('id', resume_id).eq('student_id', uid).maybeSingle()).data as any
      if (!resumeRow) return res.status(404).json({ error: 'resume_not_found' })
    } else {
      resumeRow = (await sb.from('resume_profiles').select('*').eq('student_id', uid).eq('active', 1).maybeSingle()).data as any
      if (!resumeRow) return res.status(404).json({ error: 'no_active_resume' })
    }

    // Load the job and verify visibility
    const job = await loadJob(job_id)
    if (!job) return res.status(404).json({ error: 'not_found' })
    const gates = await schoolGates([job.company_id ?? uid])
    if (!jobVisibleTo(job, viewer, gates)) return res.status(404).json({ error: 'not_found' })

    // Request manual match — respects hard eligibility
    const result = await requestManualMatch(uid, job_id, resumeRow.id, { refresh })

    if (result.state === 'excluded') {
      return res.json({ state: 'excluded', reason: result.reason })
    }
    if (result.state === 'ai_reviewed') {
      return res.json({ state: 'ai_reviewed', match: result.pair })
    }
    // queued
    return res.status(202).json({ state: 'queued', pair: result.pair })
  })

  // --- Status endpoint: queue + pair status for the authenticated user ---
  r.get('/matches/status', async (req, res) => {
    const uid = req.user!.id
    const queueStatus = await getQueueStatus(uid)

    // Get pair statuses
    const { data: candidates } = await sb
      .from('match_candidates')
      .select('job_id, resume_id, ai_status, filter_points, rank_position, updated_at')
      .eq('student_id', uid)

    const pairs = (candidates ?? []).map((c: any) => ({
      job_id: c.job_id,
      resume_id: c.resume_id,
      ai_status: c.ai_status,
      filter_points: c.filter_points,
      rank_position: c.rank_position,
      updated_at: c.updated_at,
    }))

    res.json({ queue: queueStatus, pairs })
  })

  // --- Rebuild endpoint: re-evaluate after profile/job changes ---
  r.post('/matches/rebuild', async (req, res) => {
    const uid = req.user!.id
    const { resume_id } = req.body ?? {}

    const viewer = await studentRow(uid)
    if (!viewer) return res.status(401).json({ error: 'unauthorized' })

    let resumeRow: any = null
    if (resume_id) {
      resumeRow = (await sb.from('resume_profiles').select('*').eq('id', resume_id).eq('student_id', uid).maybeSingle()).data as any
      if (!resumeRow) return res.status(404).json({ error: 'resume_not_found' })
    } else {
      resumeRow = (await sb.from('resume_profiles').select('*').eq('student_id', uid).eq('active', 1).maybeSingle()).data as any
      if (!resumeRow) return res.status(404).json({ error: 'no_active_resume' })
    }

    // Enqueue resume rebuild — the consumer will re-evaluate all pairs
    const { enqueueResumeRebuild } = await import('@/lib/matchQueue')
    await enqueueResumeRebuild(uid, resumeRow.id, (req as any).env)

    res.json({ state: 'queued', resume_id: resumeRow.id })
  })
}
