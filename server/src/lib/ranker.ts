// Serve the learned ranker (roadmap Phase 2).
//
// Loads the trained logistic model from ranker_model (cached 5 min) and scores a
// pre-LLM feature vector. The funnel uses this to order candidates before spending
// LLM calls. Returns null when no ACTIVE model exists, so the caller transparently
// falls back to Voyage rerank — there's never a hard dependency on the model.

import { sb } from '@/db'
import type { FeatureName } from '@/lib/features'

export interface RankerModel {
  featureNames: FeatureName[]
  bias: number
  w: number[]
  mean: number[]
  std: number[]
  nPos: number
  auc: number | null
}

let cache: { at: number; model: RankerModel | null } | null = null

/** The current ACTIVE ranker, or null. Cached 5 min; null result also cached so a
 *  missing table / no model doesn't re-query every request. */
export async function loadRanker(): Promise<RankerModel | null> {
  if (cache && Date.now() - cache.at < 300_000) return cache.model
  let model: RankerModel | null = null
  try {
    const r = (await sb.from('ranker_model').select('*').eq('id', 'singleton').maybeSingle()).data as any
    const wts = r?.weights
    if (r && r.active === 1 && Array.isArray(wts?.w) && wts.w.length) {
      model = { featureNames: r.feature_names, bias: wts.bias, w: wts.w, mean: wts.mean, std: wts.std, nPos: r.n_pos, auc: r.auc }
    }
  } catch { /* table not migrated yet */ }
  cache = { at: Date.now(), model }
  return model
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z))

/** P(engage) for one candidate, from its feature map. Standardizes with the model's
 *  stored mean/std so it matches training exactly. */
export function rankerProb(model: RankerModel, feats: Record<string, number>): number {
  let z = model.bias
  for (let i = 0; i < model.featureNames.length; i++) {
    const raw = feats[model.featureNames[i]] ?? 0
    z += model.w[i] * ((raw - model.mean[i]) / (model.std[i] || 1))
  }
  return sigmoid(z)
}
