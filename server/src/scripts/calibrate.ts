// Outcome calibration — the honesty feedback loop (and the real moat).
//
// Compares the engine's predicted scores against REAL application outcomes
// (shortlisted / hired = positive; rejected = negative) and asks Opus to judge
// whether the engine is systematically optimistic or pessimistic, then writes a
// rubric addendum (+ optional weight nudges) into ai_calibration. The live
// scorer reads that on its next refresh, so scores get more honest over time —
// trained on YOUR hiring data, which no competitor has.
//   npm run calibrate
// Needs a minimum number of terminal outcomes (MIN_SAMPLES, default 20).

import '@/loadenv' // override so project .env wins over a stale shell ANTHROPIC_API_KEY
import { sb, must } from '@/db'
import { claudeJson, hasClaude, MODELS } from '@/lib/claude'
import { now } from '@/lib/util'

const MIN_SAMPLES = Number(process.env.MIN_SAMPLES ?? 20)

const CAL_SCHEMA = {
  type: 'object',
  properties: {
    diagnosis: { type: 'string' },
    rubric_addendum: { type: 'string' },
  },
  required: ['diagnosis', 'rubric_addendum'],
  additionalProperties: false,
} as const

export async function runCalibration() {
  if (!hasClaude()) { console.warn('ANTHROPIC_API_KEY not set — cannot calibrate.'); return }

  const apps = (must(await sb.from('applications').select('student_id, job_id, status')) as any[]) ?? []
  const cache = (must(await sb.from('ai_match_cache').select('student_id, job_id, payload')) as any[]) ?? []
  let opens: any[] = []
  try { opens = (must(await sb.from('job_opens').select('user_id, job_id')) as any[]) ?? [] } catch { /* migration 0012 not run */ }

  const scoreOf = new Map<string, number>()
  for (const c of cache) {
    try { scoreOf.set(`${c.student_id}::${c.job_id}`, JSON.parse(c.payload).score) } catch { /* skip */ }
  }
  const appByKey = new Map<string, string>() // key -> status
  for (const a of apps) appByKey.set(`${a.student_id}::${a.job_id}`, a.status)
  const opened = new Set<string>(opens.map((o) => `${o.user_id}::${o.job_id}`))

  // Build calibration samples from BOTH terminal hiring outcomes (strong, scarce)
  // AND implicit engagement (abundant, noisier): an apply/open is a positive vote
  // for the score; a job we scored HIGH and surfaced that the student ignored is a
  // soft negative (the engine was likely over-optimistic). This is what lets the
  // loop fire long before we have 20 hires/rejections.
  type Signal = 'hired' | 'shortlisted' | 'applied' | 'opened' | 'rejected' | 'ignored_high'
  const samples: { score: number; outcome: 'positive' | 'negative'; signal: Signal }[] = []
  const softNeg: { score: number; outcome: 'negative'; signal: 'ignored_high' }[] = []

  for (const c of cache) {
    const key = `${c.student_id}::${c.job_id}`
    const s = scoreOf.get(key)
    if (typeof s !== 'number') continue
    const status = appByKey.get(key)
    if (status === 'hired' || status === 'shortlisted') samples.push({ score: s, outcome: 'positive', signal: status })
    else if (status === 'rejected') samples.push({ score: s, outcome: 'negative', signal: 'rejected' })
    else if (status) samples.push({ score: s, outcome: 'positive', signal: 'applied' }) // pending/reviewed = applied
    else if (opened.has(key)) samples.push({ score: s, outcome: 'positive', signal: 'opened' })
    else if (s >= 70) softNeg.push({ score: s, outcome: 'negative', signal: 'ignored_high' }) // surfaced strong, no action
  }

  // Worker-confirmed outcomes (migration 0014): a detected hire / profile-progress
  // after the student applied is the strongest positive vote on the score we gave.
  let outcomes: any[] = []
  try { outcomes = (must(await sb.from('match_outcomes').select('student_id, job_id, status, score_at_intent')) as any[]) ?? [] } catch { /* 0014 not run */ }
  for (const o of outcomes) {
    const s = typeof o.score_at_intent === 'number' ? o.score_at_intent : scoreOf.get(`${o.student_id}::${o.job_id}`)
    if (typeof s !== 'number') continue
    if (o.status === 'likely_hired') samples.push({ score: s, outcome: 'positive', signal: 'hired' })
    else if (o.status === 'profile_updated') samples.push({ score: s, outcome: 'positive', signal: 'applied' })
  }

  // Cap soft negatives so they don't drown the high-signal outcomes (keep the
  // highest-scored ignored jobs — those are the most damning of over-optimism).
  const posCount = samples.filter((x) => x.outcome === 'positive').length
  softNeg.sort((a, b) => b.score - a.score)
  samples.push(...softNeg.slice(0, Math.max(50, posCount * 2)))

  if (samples.length < MIN_SAMPLES) {
    console.log(`Only ${samples.length} usable samples (need ${MIN_SAMPLES}). Skipping — gather more engagement before calibrating.`)
    return
  }

  const pos = samples.filter((s) => s.outcome === 'positive')
  const neg = samples.filter((s) => s.outcome === 'negative')
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0)
  const bySignal = (sig: Signal) => samples.filter((s) => s.signal === sig).length
  const stats = {
    total: samples.length,
    positive: pos.length,
    negative: neg.length,
    avg_score_positive: avg(pos.map((s) => s.score)),
    avg_score_negative: avg(neg.map((s) => s.score)),
    signals: { hired: bySignal('hired'), shortlisted: bySignal('shortlisted'), applied: bySignal('applied'), opened: bySignal('opened'), rejected: bySignal('rejected'), ignored_high: bySignal('ignored_high') },
    high_score_rejected: neg.filter((s) => s.signal === 'rejected' && s.score >= 80).length, // engine said great, employer said no → optimistic
    high_score_ignored: neg.filter((s) => s.signal === 'ignored_high').length, // engine said strong, student didn't act → likely optimistic
    low_score_succeeded: pos.filter((s) => (s.signal === 'hired' || s.signal === 'shortlisted') && s.score < 50).length, // engine said weak, candidate won → pessimistic
  }
  console.log('Outcome stats:', stats)

  const result = await claudeJson<{ diagnosis: string; rubric_addendum: string }>({
    model: MODELS.coach,
    thinking: true,
    maxTokens: 1200,
    schema: CAL_SCHEMA,
    system:
      'You calibrate a job-match scoring engine (an LLM rubric) against real outcomes. The engine must be HONEST — never optimistic. ' +
      'Signal reliability, strongest to weakest: hired/shortlisted/rejected (terminal employer decisions — trust most); applied/opened (the student found the match worth pursuing — a positive vote on the score); ignored_high (we scored the role strong and surfaced it but the student took no action — a NOISY soft-negative that often means the engine was over-optimistic, but may just mean they have not looked yet — weight it gently). ' +
      'If high scores are getting rejected or consistently ignored, the engine is too generous and the addendum must tighten it (raise the evidence bar, lower bands). ' +
      'If genuinely strong candidates (hired/shortlisted) are scored low, loosen slightly — but bias toward conservatism; under-scoring is safer than misleading a candidate. ' +
      'Write a concise rubric_addendum (1-4 imperative sentences the scorer will follow).',
    user: `Observed outcomes (score is the engine's 0-99 prediction; signal is how we learned the outcome):\n${JSON.stringify(stats, null, 2)}\n\nRaw samples: ${JSON.stringify(samples)}`,
  })

  if (!result?.rubric_addendum) { console.warn('Calibration produced no addendum — leaving config unchanged.'); return }

  must(await sb.from('ai_calibration').upsert(
    { id: 'singleton', weights: null, rubric_addendum: result.rubric_addendum, sample_size: samples.length, updated_at: now() },
    { onConflict: 'id' },
  ))
  console.log('Calibration updated.')
  console.log('Diagnosis:', result.diagnosis)
  console.log('Addendum:', result.rubric_addendum)
}

// CLI entry: `npm run calibrate`. The Worker imports runCalibration() directly,
// so guard the auto-run to direct invocation (process.argv unset on Workers).
const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) && !!process.argv[1]?.includes('calibrate')
if (isCli) runCalibration().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
