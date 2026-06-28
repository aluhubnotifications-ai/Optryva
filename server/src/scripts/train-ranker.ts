// Train the learning-to-rank model (roadmap Phase 2).
//
// Fits a class-weighted logistic regression on match_features (pre-LLM features →
// engaged?), standardizes inputs, reports train AUC, and saves the model to
// ranker_model. Pure TypeScript so it runs anywhere the app runs (incl. the Worker
// cron) with no Python / native deps. It activates the model for live serving ONLY
// when there are enough positives — otherwise it saves it INACTIVE so a noise model
// learned from a handful of clicks can never degrade real matches.
//
//   npm run train-ranker

import 'dotenv/config'
import { sb, must } from '@/db'
import { now } from '@/lib/util'
import { PRELLM_FEATURES } from '@/lib/features'

const MIN_SERVE_POS = Number(process.env.RANKER_MIN_POS ?? 30)
const EPOCHS = 500
const LR = 0.1
const L2 = 1e-3

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z))

/** AUC via Mann–Whitney: P(score(pos) > score(neg)). 0.5 = random. */
function aucScore(scores: number[], y: number[]): number {
  const pos: number[] = []
  const neg: number[] = []
  scores.forEach((s, i) => (y[i] ? pos : neg).push(s))
  if (!pos.length || !neg.length) return 0.5
  let wins = 0
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0
  return wins / (pos.length * neg.length)
}

export async function trainRanker() {
  const probe = await sb.from('ranker_model').select('id').limit(1)
  if (probe.error) { console.log('ranker_model missing — run migration 0016_ranker_model.sql first.'); return }
  const feat = await sb.from('match_features').select('features, label')
  if (feat.error) { console.log('match_features missing — run migration 0015 + npm run build-features first.'); return }
  const rows = (feat.data as any[]) ?? []
  if (rows.length < 10) { console.log(`Only ${rows.length} feature rows — gather more before training.`); return }

  const F = PRELLM_FEATURES
  const cols = F.length
  const X = rows.map((r) => F.map((name) => Number(r.features?.[name]) || 0))
  const y = rows.map((r) => (Number(r.label) >= 1 ? 1 : 0))
  const nPos = y.filter((v) => v === 1).length
  const nNeg = y.length - nPos
  if (nPos === 0 || nNeg === 0) { console.log(`Need BOTH classes to train (have ${nPos} positive / ${nNeg} negative). Gather more engagement.`); return }

  // Standardize each column (zero mean, unit variance) for stable gradients.
  const mean = new Array(cols).fill(0)
  const std = new Array(cols).fill(0)
  for (const row of X) for (let i = 0; i < cols; i++) mean[i] += row[i]
  for (let i = 0; i < cols; i++) mean[i] /= X.length
  for (const row of X) for (let i = 0; i < cols; i++) std[i] += (row[i] - mean[i]) ** 2
  for (let i = 0; i < cols; i++) std[i] = Math.sqrt(std[i] / X.length) || 1
  const Z = X.map((row) => row.map((v, i) => (v - mean[i]) / std[i]))

  // Class weights — positives (engagement) are rare, so weight them up.
  const wPos = y.length / (2 * nPos)
  const wNeg = y.length / (2 * nNeg)

  const w = new Array(cols).fill(0)
  let b = 0
  for (let e = 0; e < EPOCHS; e++) {
    const gw = new Array(cols).fill(0)
    let gb = 0
    for (let n = 0; n < Z.length; n++) {
      let z = b
      for (let i = 0; i < cols; i++) z += w[i] * Z[n][i]
      const err = (sigmoid(z) - y[n]) * (y[n] ? wPos : wNeg)
      gb += err
      for (let i = 0; i < cols; i++) gw[i] += err * Z[n][i]
    }
    b -= (LR * gb) / Z.length
    for (let i = 0; i < cols; i++) w[i] -= LR * (gw[i] / Z.length + L2 * w[i])
  }

  const probs = Z.map((z) => sigmoid(b + z.reduce((a, zi, i) => a + w[i] * zi, 0)))
  const auc = aucScore(probs, y)
  const active = nPos >= MIN_SERVE_POS ? 1 : 0

  must(await sb.from('ranker_model').upsert(
    { id: 'singleton', feature_names: F, weights: { bias: b, w, mean, std }, n: y.length, n_pos: nPos, auc, active, trained_at: now() },
    { onConflict: 'id' },
  ))

  console.log(`Trained on ${y.length} rows (${nPos} positive / ${nNeg} negative). Train AUC=${auc.toFixed(3)} (overfit-prone on small n).`)
  console.log(active
    ? `Model ACTIVE — now ranking candidates before the LLM.`
    : `Model saved but INACTIVE — need ${MIN_SERVE_POS}+ positives to serve (have ${nPos}). The funnel keeps using Voyage rerank until then.`)
}

const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) && !!process.argv[1]?.includes('train-ranker')
if (isCli) trainRanker().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
