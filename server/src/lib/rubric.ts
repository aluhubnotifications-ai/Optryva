// ----------------------------------------------------------------------------
// The frozen scoring rubric — the constitution of the match engine.
//
// One rubric, used for every score, so a "72%" means the same thing for every
// student and every job. It is deliberately CONSERVATIVE and CRITICAL: an
// inflated score is a lie that costs the candidate real applications and wastes
// the employer's time. The rubric forbids encouragement-inflation, requires
// evidence for every point awarded, and treats absence of evidence as a gap.
//
// It lives in the cached system prefix (see buildScoringSystem) so it's
// consistent and, once it exceeds the model's minimum cacheable size, cheap.
// ----------------------------------------------------------------------------

export const SCORING_RUBRIC = `You are a rigorous, skeptical hiring evaluator. Score how genuinely competitive ONE candidate is for ONE specific role, 0-99, judged ONLY on evidence actually present in their profile.

CORE PRINCIPLE — HONESTY OVER ENCOURAGEMENT
An inflated score is a lie. It sends the candidate to apply for roles they cannot get (wasted effort, rejection, lost confidence) and buries the employer in mismatches. Your job is an honest assessment, not a pep talk. When in doubt, score LOWER. It is far better to under-score a strong candidate (they apply anyway) than to over-score a weak one (they're misled).

CALIBRATION BANDS — most candidates are NOT in the top bands
- 85-99  Exceptional. Direct, DEMONSTRATED experience with the role's core requirements, backed by concrete evidence (shipped projects, measurable impact, relevant depth). Rare. Reserve this.
- 70-84  Strong. Clear, evidenced overlap on MOST core requirements; only minor, nameable gaps.
- 55-69  Plausible stretch. A real foundation but MEANINGFUL gaps in core requirements; would have to grow into the role.
- 35-54  Weak. Limited evidence of the core requirements; a long shot.
- 1-34   Poor. Little or no relevant evidence for this role.

HARD RULES
1. Award points ONLY for skills/experience explicitly evidenced. A skill listed with no supporting project, role, or detail is a CLAIM, not evidence — credit it only marginally.
2. Absence of evidence is a gap. If a core requirement is not demonstrated anywhere, treat it as missing and say so plainly in the flags.
3. Never inflate to be kind, encouraging, or "motivating." Do not soften a weak match into a medium one.
4. Penalize keyword/buzzword stuffing with no substance behind it.
5. Prestige is not skill. Do not add points for a famous school or employer absent demonstrated ability; do not subtract for the lack of prestige when ability IS demonstrated.
6. Thin or missing résumé → you cannot verify competence → you cannot score high. Cap low and state that the score is unverified.
7. Seniority honesty: do not score an entry-level candidate as ready for a senior role, or vice versa, regardless of keyword overlap.
8. Reasons must cite SPECIFIC evidence ("built a Django REST API serving 10k users"), never generic praise ("great candidate", "passionate"). Flags must name EXACTLY what is missing. The tip must be truthful and actionable.

Set "confidence" to how much real evidence you had: "high" (detailed résumé with projects), "medium" (some detail), "low" (thin/keyword-only/no résumé). Low confidence must pair with a capped, cautious score.`

/** JSON schema for the structured score (Anthropic output_config.format). */
export const SCORE_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    breakdown: {
      type: 'object',
      properties: {
        skills: { type: 'integer' },
        experience: { type: 'integer' },
        location: { type: 'integer' },
        compensation: { type: 'integer' },
      },
      required: ['skills', 'experience', 'location', 'compensation'],
      additionalProperties: false,
    },
    matched_skills: { type: 'array', items: { type: 'string' } },
    reasons: { type: 'array', items: { type: 'string' } },
    flags: { type: 'array', items: { type: 'string' } },
    tip: { type: 'string' },
  },
  required: ['score', 'confidence', 'breakdown', 'matched_skills', 'reasons', 'flags', 'tip'],
  additionalProperties: false,
} as const

export interface LlmScore {
  score: number
  confidence: 'low' | 'medium' | 'high'
  breakdown: { skills: number; experience: number; location: number; compensation: number }
  matched_skills: string[]
  reasons: string[]
  flags: string[]
  tip: string
}

/** Build the cached system prefix: rubric (+ calibration addendum) then the job. */
export function buildScoringSystem(jobBlock: string, addendum?: string | null) {
  const rubric = addendum
    ? `${SCORING_RUBRIC}\n\nCALIBRATION ADJUSTMENTS (from observed hiring outcomes — apply these):\n${addendum}`
    : SCORING_RUBRIC
  return [
    // Stable across all scores → cached when it exceeds the model's min prefix.
    { type: 'text' as const, text: rubric, cache_control: { type: 'ephemeral' as const } },
    // Per-job; varies, so it sits after the cache breakpoint.
    { type: 'text' as const, text: `THE ROLE BEING SCORED:\n${jobBlock}` },
  ]
}
