// Train the score-distillation model (roadmap Phase 3).
//
// Fits a linear regression that predicts Claude's honest 0-99 score from the cheap
// pre-LLM features — i.e. it learns to imitate the expensive judge. The teacher
// labels are the scores already in match_features.pred_score (every one a real
// Claude judgment), so this needs NO engagement data and trains immediately. Pure
// TypeScript; saves to distill_model. Reports MAE + R² so you can see how closely it
// tracks Claude before trusting it.
//
//   npm run train-distill

import 'dotenv/config'
import { sb, must } from '@/db'
import { now } from '@/lib/util'
import { PRELLM_FEATURES } from '@/lib/features'

const MIN_ROWS = Number(process.env.DISTILL_MIN_ROWS ?? 50)
const EPOCHS = 800
const LR = 0.1
const L2 = 1e-3

export async function trainDistill() {
  const probe = await sb.from('distill_model').select('id').limit(1)
  if (probe.error) { console.log('distill_model missing — run migration 0017_distill_model.sql first.'); return }
  const feat = await sb.from('match_features').select('features, pred_score')
  if (feat.error) { console.log('match_features missing — run migration 0015 + npm run build-features first.'); return }
  const rows = ((feat.data as any[]) ?? []).filter((r) => typeof r.pred_score === 'number')
  if (rows.length < 10) { console.log(`Only ${rows.length} teacher-labeled rows — score some jobs (and run build-features) first.`); return }

  const F = PRELLM_FEATURES
  const cols = F.length
  const X = rows.map((r) => F.map((name) => Number(r.features?.[name]) || 0))
  const y = rows.map((r) => Number(r.pred_score))

  // Standardize X and y for stable gradients; de-standardize at predict time.
  const mean = new Array(cols).fill(0)
  const std = new Array(cols).fill(0)
  for (const row of X) for (let i = 0; i < cols; i++) mean[i] += row[i]
  for (let i = 0; i < cols; i++) mean[i] /= X.length
  for (const row of X) for (let i = 0; i < cols; i++) std[i] += (row[i] - mean[i]) ** 2
  for (let i = 0; i < cols; i++) std[i] = Math.sqrt(std[i] / X.length) || 1
  const Z = X.map((row) => row.map((v, i) => (v - mean[i]) / std[i]))
  const ymean = y.reduce((a, b) => a + b, 0) / y.length
  const ystd = Math.sqrt(y.reduce((a, b) => a + (b - ymean) ** 2, 0) / y.length) || 1
  const yz = y.map((v) => (v - ymean) / ystd)

  // Linear regression by gradient descent (MSE + L2).
  const w = new Array(cols).fill(0)
  let b = 0
  for (let e = 0; e < EPOCHS; e++) {
    const gw = new Array(cols).fill(0)
    let gb = 0
    for (let n = 0; n < Z.length; n++) {
      let pred = b
      for (let i = 0; i < cols; i++) pred += w[i] * Z[n][i]
      const err = pred - yz[n]
      gb += err
      for (let i = 0; i < cols; i++) gw[i] += err * Z[n][i]
    }
    b -= (LR * gb) / Z.length
    for (let i = 0; i < cols; i++) w[i] -= LR * (gw[i] / Z.length + L2 * w[i])
  }

  // Metrics on the original 0-99 scale. agree = the intuitive fidelity number:
  // how often the model lands within ±10 points of Claude.
  let sse = 0
  let sae = 0
  let sst = 0
  let within10 = 0
  for (let n = 0; n < Z.length; n++) {
    let pz = b
    for (let i = 0; i < cols; i++) pz += w[i] * Z[n][i]
    const pred = pz * ystd + ymean
    sse += (pred - y[n]) ** 2
    sae += Math.abs(pred - y[n])
    sst += (y[n] - ymean) ** 2
    if (Math.abs(pred - y[n]) <= 10) within10++
  }
  const mae = sae / y.length
  const rmse = Math.sqrt(sse / y.length)
  const r2 = sst > 0 ? 1 - sse / sst : 0
  const agreePm10 = (100 * within10) / y.length
  const active = y.length >= MIN_ROWS ? 1 : 0

  must(await sb.from('distill_model').upsert(
    { id: 'singleton', feature_names: F, weights: { bias: b, w, mean, std, ymean, ystd }, n: y.length, mae, r2, agree_pm10: agreePm10, active, trained_at: now() },
    { onConflict: 'id' },
  ))

  console.log(`Distilled on ${y.length} Claude-scored rows. Agrees with Claude within ±10 on ${agreePm10.toFixed(0)}% of cases. MAE=${mae.toFixed(1)} RMSE=${rmse.toFixed(1)} R²=${r2.toFixed(3)} (train-set, optimistic).`)
  console.log(active ? 'Model ACTIVE — usable as a Claude-free fallback estimate.' : `Saved but INACTIVE (need ${MIN_ROWS}+ teacher rows; have ${y.length}).`)
}

const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) && !!process.argv[1]?.includes('train-distill')
if (isCli) trainDistill().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
