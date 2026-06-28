// Serve the score-distillation model (roadmap Phase 3).
//
// Loads the trained linear model (cached 5 min) and predicts Claude's 0-99 score
// from pre-LLM features — a cheap, Claude-free ESTIMATE. Returns null when no ACTIVE
// model exists, so callers only use it when it's real. Never replaces a live Claude
// score; it's a fallback / cost lever.

import { sb } from '@/db'
import type { FeatureName } from '@/lib/features'

export interface DistillModel {
  featureNames: FeatureName[]
  bias: number
  w: number[]
  mean: number[]
  std: number[]
  ymean: number
  ystd: number
  mae: number | null
}

let cache: { at: number; model: DistillModel | null } | null = null

export async function loadDistill(): Promise<DistillModel | null> {
  if (cache && Date.now() - cache.at < 300_000) return cache.model
  let model: DistillModel | null = null
  try {
    const r = (await sb.from('distill_model').select('*').eq('id', 'singleton').maybeSingle()).data as any
    const wts = r?.weights
    if (r && r.active === 1 && Array.isArray(wts?.w) && wts.w.length) {
      model = { featureNames: r.feature_names, bias: wts.bias, w: wts.w, mean: wts.mean, std: wts.std, ymean: wts.ymean, ystd: wts.ystd, mae: r.mae }
    }
  } catch { /* table not migrated yet */ }
  cache = { at: Date.now(), model }
  return model
}

/** Predicted Claude-like score (1-99) from a feature map, de-standardized + clamped. */
export function distillScore(model: DistillModel, feats: Record<string, number>): number {
  let z = model.bias
  for (let i = 0; i < model.featureNames.length; i++) {
    const raw = feats[model.featureNames[i]] ?? 0
    z += model.w[i] * ((raw - model.mean[i]) / (model.std[i] || 1))
  }
  return Math.max(1, Math.min(99, Math.round(z * model.ystd + model.ymean)))
}
