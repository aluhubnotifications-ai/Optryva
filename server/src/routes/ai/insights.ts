import { Router } from '@/lib/http'
import { sb, must, j } from '@/db'
import { cacheGet, cacheSet } from '@/lib/cache'
import { claudeText, MODELS, hasClaude } from '@/lib/claude'
import type { AiMatch } from '@/lib/matching'
import {
  studentRow,
  matchReadiness,
  candidateJobs,
  cacheMap,
  rowToMatchJob,
  getMatch,
  ensureResumeProfile,
  outcomeNudges,
  firstNameOf,
  parseJsonArray,
  parseList,
} from './helpers'

export function registerInsights(r: Router) {
  /* ---------- §8.2 Insights — one engine, aggregated (skill gaps, demand, do-next) ---------- */
  r.get('/insights', async (req, res) => {
    const uid = req.user!.id
    // Score-every-role is expensive (N AI calls). Cache the aggregate for a short
    // window so re-opening Insights or switching back to the tab is instant, while
    // staying fresh enough for day-to-day use.
    const cacheKey = `insights:${uid}`
    const cached = cacheGet<Record<string, unknown>>(cacheKey)
    if (cached) return res.json(cached)
    const viewer = await studentRow(uid)
    const ready = matchReadiness(viewer)
    if (!ready.ready) return res.status(409).json({ error: 'profile_incomplete', missing: ready.missing })
    const rp = await ensureResumeProfile(viewer)
    const [visible, cm] = await Promise.all([candidateJobs(viewer, rp), cacheMap(uid)])
    const scoredRows = await Promise.all(
      visible.map(async (rr) => {
        const job = rowToMatchJob(rr)
        const m = await getMatch(uid, job, {}, { row: viewer, rp, cached: cm.get(rr.id) ?? null })
        return m ? { job, m } : null
      }),
    )
    const rows = scoredRows.filter((x): x is { job: any; m: AiMatch } => !!x)
    rows.sort((a, b) => b.m.score - a.m.score)

    const scores = rows.map((rr) => rr.m.score)
    const readiness = scores.length ? Math.round(scores.slice(0, 5).reduce((a, b) => a + b, 0) / Math.min(5, scores.length)) : 0
    const distribution = {
      excellent: scores.filter((s) => s >= 85).length,
      strong: scores.filter((s) => s >= 70 && s < 85).length,
      stretch: scores.filter((s) => s >= 50 && s < 70).length,
      weak: scores.filter((s) => s < 50).length,
    }

    const gapCount = new Map<string, number>()
    const strengthCount = new Map<string, number>()
    const demandCount = new Map<string, number>()
    for (const { job, m } of rows) {
      for (const tag of job.tags ?? []) demandCount.set(tag, (demandCount.get(tag) ?? 0) + 1)
      for (const s of m.matched_skills) strengthCount.set(s, (strengthCount.get(s) ?? 0) + 1)
      for (const tag of (job.tags ?? []).filter((t: string) => !m.matched_skills.includes(t))) gapCount.set(tag, (gapCount.get(tag) ?? 0) + 1)
    }
    const rank = (mp: Map<string, number>, n: number) => Array.from(mp.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }))
    const gaps = rank(gapCount, 8)
    const strengths = rank(strengthCount, 8)
    const demand = rank(demandCount, 10)

    const topMatches = rows.slice(0, 5).map(({ job, m }) => ({ job_id: job.id, title: job.title, company_id: job.company_id, listing_type: job.listing_type, location: job.location, score: m.score }))
    const nudges = await outcomeNudges(uid)

    // Career-trajectory ("reachable roles"): stretch matches the student is only a few
    // LEARNABLE skills away from — forward-looking, not just current fit. From the
    // already-scored rows, so no extra LLM calls.
    const reachableAll = rows
      .filter(({ m }) => m.score >= 52 && m.score < 80)
      .map(({ job, m }) => ({ job, score: m.score, missing: (job.tags ?? []).filter((t: string) => !m.matched_skills.includes(t)) }))
      .filter((rr) => rr.missing.length >= 1 && rr.missing.length <= 3)
    const reachable = reachableAll
      .sort((a, b) => a.missing.length - b.missing.length || b.score - a.score)
      .slice(0, 6)
      .map((rr) => ({ job_id: rr.job.id, title: rr.job.title, company_id: rr.job.company_id, listing_type: rr.job.listing_type, location: rr.job.location, score: rr.score, missing: rr.missing, bridge: `Add ${rr.missing.join(' & ')} to qualify.` }))
    // Highest-leverage skills: which single skill unlocks the most reachable roles.
    const unlockMap = new Map<string, string[]>()
    for (const rr of reachableAll) for (const s of rr.missing) (unlockMap.get(s) ?? unlockMap.set(s, []).get(s)!).push(rr.job.title)
    const unlocks = Array.from(unlockMap.entries())
      .map(([skill, titles]) => ({ skill, count: titles.length, roles: titles.slice(0, 4) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)

    // Honest template fallback (also the no-key path).
    const noCv = !(viewer?.cv_text ?? '').trim()
    const fallbackDoNext: string[] = []
    if (noCv) fallbackDoNext.push('Upload your CV — without it every match is capped at 60.')
    if (gaps[0]) fallbackDoNext.push(`Learn ${gaps[0].name} — it’s asked for in ${gaps[0].count} of your matched roles.`)
    if (gaps[1]) fallbackDoNext.push(`Build a small project using ${gaps[1].name} to close your second-biggest gap.`)
    if (topMatches[0]) fallbackDoNext.push(`Apply to your strongest match: ${topMatches[0].title} (${topMatches[0].score}% fit).`)
    if ((j.parse<string[]>(viewer?.skills, []) ?? []).length < 4) fallbackDoNext.push('Add a few more skills to your profile so the matcher can find more roles for you.')

    // AI-generated, personalised next steps grounded in the student's REAL match data.
    let doNext = fallbackDoNext
    if (hasClaude() && rows.length) {
      const name = firstNameOf(viewer?.full_name)
      const ai = await claudeText({
        model: MODELS.score,
        maxTokens: 400,
        system:
          `You are ${name ? `${name}'s ` : 'a '}honest, encouraging career coach. From the student's REAL match data below, write 3-5 specific, motivating next actions — each short, imperative, and concrete (reference their actual gaps/roles, not generic advice). ${noCv ? 'They have NOT uploaded a CV — make the first action uploading it. ' : ''}Reply ONLY a JSON array of strings.`,
        user:
          `Readiness: ${readiness}/100 across ${rows.length} roles.\n` +
          `Top skill gaps (skill : #roles wanting it): ${gaps.slice(0, 5).map((g) => `${g.name}:${g.count}`).join(', ') || '—'}.\n` +
          `Evident strengths: ${strengths.slice(0, 5).map((s) => s.name).join(', ') || '—'}.\n` +
          `Strongest matches: ${topMatches.slice(0, 3).map((t) => `${t.title} (${t.score}%)`).join('; ') || '—'}.\n` +
          `Post-application signals (from tracking their real outcomes — reference if present): ${nudges.map((n) => n.message).join(' | ') || '—'}.\n` +
          `Roles within reach (a few skills away — great for "do next"): ${reachable.slice(0, 3).map((rr) => `${rr.title} (needs ${rr.missing.join(', ')})`).join('; ') || '—'}.\n` +
          `Highest-leverage skill to learn (unlocks the most reachable roles): ${unlocks[0] ? `${unlocks[0].skill} → ${unlocks[0].count} roles` : '—'}.\n` +
          `Résumé summary: ${rp?.summary ?? '—'}.`,
      })
      const list = (parseJsonArray<string>(ai)?.filter((x) => typeof x === 'string' && x.trim())) ?? parseList(ai)
      if (list.length) doNext = list.slice(0, 5)
    }

    const payload = { readiness, total: rows.length, distribution, gaps, strengths, demand, topMatches, doNext, outcomeNudges: nudges, reachable, unlocks }
    cacheSet(cacheKey, payload, 60_000)
    res.json(payload)
  })
}
