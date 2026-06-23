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

import 'dotenv/config'
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

async function main() {
  if (!hasClaude()) { console.warn('ANTHROPIC_API_KEY not set — cannot calibrate.'); return }

  const apps = (must(await sb.from('applications').select('student_id, job_id, status')) as any[]) ?? []
  const cache = (must(await sb.from('ai_match_cache').select('student_id, job_id, payload')) as any[]) ?? []
  const scoreOf = new Map<string, number>()
  for (const c of cache) {
    try { scoreOf.set(`${c.student_id}::${c.job_id}`, JSON.parse(c.payload).score) } catch { /* skip */ }
  }

  // Pair each terminal outcome with the score the engine gave at apply time.
  const samples: { score: number; outcome: 'positive' | 'negative' }[] = []
  for (const a of apps) {
    const s = scoreOf.get(`${a.student_id}::${a.job_id}`)
    if (typeof s !== 'number') continue
    if (a.status === 'hired' || a.status === 'shortlisted') samples.push({ score: s, outcome: 'positive' })
    else if (a.status === 'rejected') samples.push({ score: s, outcome: 'negative' })
  }

  if (samples.length < MIN_SAMPLES) {
    console.log(`Only ${samples.length} terminal outcomes (need ${MIN_SAMPLES}). Skipping — gather more before calibrating.`)
    return
  }

  const pos = samples.filter((s) => s.outcome === 'positive')
  const neg = samples.filter((s) => s.outcome === 'negative')
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0)
  const stats = {
    total: samples.length,
    positive: pos.length,
    negative: neg.length,
    avg_score_positive: avg(pos.map((s) => s.score)),
    avg_score_negative: avg(neg.map((s) => s.score)),
    high_score_rejected: neg.filter((s) => s.score >= 80).length, // engine said great, employer said no → optimistic
    low_score_succeeded: pos.filter((s) => s.score < 50).length, // engine said weak, candidate won → pessimistic
  }
  console.log('Outcome stats:', stats)

  const result = await claudeJson<{ diagnosis: string; rubric_addendum: string }>({
    model: MODELS.coach,
    thinking: true,
    maxTokens: 1200,
    schema: CAL_SCHEMA,
    system:
      'You calibrate a job-match scoring engine (an LLM rubric) against real hiring outcomes. The engine must be HONEST — never optimistic. ' +
      'If high scores are getting rejected, the engine is too generous and the addendum must tighten it (raise the evidence bar, lower bands). ' +
      'If genuinely strong candidates are scored low, loosen slightly — but bias toward conservatism; under-scoring is safer than misleading a candidate. ' +
      'Write a concise rubric_addendum (1-4 imperative sentences the scorer will follow).',
    user: `Observed outcomes (score is the engine's 0-99 prediction at apply time):\n${JSON.stringify(stats, null, 2)}\n\nRaw samples: ${JSON.stringify(samples)}`,
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

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
