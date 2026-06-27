import { Router } from '@/lib/http'
import { sb, must, j } from '@/db'
import { requireAuth } from '@/lib/auth'
import { now } from '@/lib/util'
import { claudeText, claudeJson, claudeTextWithSearch, extractJson, hasClaude, MODELS } from '@/lib/claude'
import { type MatchJob, type MatchStudent, type AiMatch } from '@/lib/matching'
import type { ResumeProfile } from '@/lib/resume'
import { ensureResumeProfile, asResumeProfile } from '@/lib/enrich'
import { buildScoringSystem, SCORE_SCHEMA, type LlmScore } from '@/lib/rubric'
import { jobVisibleTo, schoolGates } from '@/lib/visibility'

/* ---------- calibration (the honesty feedback loop, cached 5 min) ---------- */
// Just the rubric addendum now — there is no deterministic engine to re-weight.
let calCache: { at: number; addendum: string | null } | null = null
async function calibration(): Promise<{ addendum: string | null }> {
  if (calCache && Date.now() - calCache.at < 300_000) return calCache
  let addendum: string | null = null
  try {
    const r = (await sb.from('ai_calibration').select('rubric_addendum').eq('id', 'singleton').maybeSingle()).data as any
    if (r) addendum = r.rubric_addendum ?? null
  } catch { /* table not migrated yet — run on defaults */ }
  calCache = { at: Date.now(), addendum }
  return calCache
}
const clampInt = (n: any, lo = 0, hi = 99) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)))

export const ai = Router()
ai.use(requireAuth)

/* ---------- loaders ---------- */
async function studentRow(id: string): Promise<any | null> {
  return must(await sb.from('profiles').select('*').eq('id', id).maybeSingle()) as any
}
function toMatchStudent(r: any, rp: ResumeProfile | null): MatchStudent {
  return {
    id: r.id, cv_text: r.cv_text, skills: j.parse(r.skills, []), desired_roles: j.parse(r.desired_roles, []),
    preferred_industries: j.parse(r.preferred_industries, []), work_type: r.work_type, location_pref: r.location_pref,
    location: r.location, major: r.major, resume_profile: rp ?? asResumeProfile(r.resume_profile),
  }
}
async function loadStudent(id: string): Promise<MatchStudent | null> {
  const r = await studentRow(id)
  return r ? toMatchStudent(r, null) : null
}
async function loadJob(id: string): Promise<(MatchJob & { company_id: string; description: string; location: string }) | null> {
  const r = must(await sb.from('job_listings').select('*').eq('id', id).maybeSingle()) as any
  if (!r) return null
  return { id: r.id, title: r.title, description: r.description, type: r.type, listing_type: r.listing_type, tags: j.parse(r.tags, []), country: r.country, remote: r.remote === 1, pay: r.pay, company_id: r.company_id, location: r.location, duration: r.duration, responsibilities: j.parse(r.responsibilities, []), qualifications: j.parse(r.qualifications, []), benefits: j.parse(r.benefits, []) }
}
async function companyName(companyId: string): Promise<string> {
  const r = must(await sb.from('profiles').select('company_name, full_name').eq('id', companyId).maybeSingle()) as any
  return r?.company_name || r?.full_name || 'this company'
}

/* ---------- §8.1 AI Job Matcher (honest rubric, structured + cached) ---------- */
async function claudeScore(student: MatchStudent, job: MatchJob, rp: ResumeProfile | null): Promise<LlmScore | null> {
  // Structured evidence (cited) when parsed; otherwise the raw CV, or an explicit
  // "unverified" marker so the model can't reward a candidate it can't see.
  const evidence = rp
    ? `PARSED RÉSUMÉ (evidence) — seniority: ${rp.seniority}, ~${rp.total_years}y experience.\n` +
      `Skills with evidence: ${(rp.skills ?? []).map((s) => `${s.name}${s.level ? ` (${s.level})` : ''}${s.evidence ? ` ["${s.evidence}"]` : ''}`).join('; ') || '—'}\n` +
      `Projects: ${(rp.projects ?? []).map((p) => p.name + (p.impact ? ` — ${p.impact}` : '')).join('; ') || '—'}\n` +
      `Domains: ${(rp.domains ?? []).join(', ') || '—'}. Likely gaps noted at parse time: ${(rp.gaps ?? []).join(', ') || '—'}.`
    : student.cv_text
      ? `RÉSUMÉ TEXT:\n${student.cv_text}`
      : 'NO RÉSUMÉ ON FILE — treat competence as UNVERIFIED and cap the score accordingly.'

  // Give the model the FULL posting — description, responsibilities, qualifications,
  // benefits, plus the logistics (location/remote/pay/duration) — so the score
  // reflects everything on the job form, not just title + tags.
  const bullets = (label: string, items?: string[]) =>
    items && items.length ? `\n${label}:\n${items.map((x) => `• ${x}`).join('\n')}` : ''
  const jobBlock =
    `${job.title} (${job.type}, ${job.listing_type}${job.duration ? `, ${job.duration}` : ''}).\n` +
    `Location: ${job.location ?? '—'}${job.remote ? ' · remote OK' : ''}. Compensation: ${job.pay || '—'}.\n` +
    `Core requirements / skills: ${job.tags.join(', ') || '—'}.\n` +
    `Description: ${job.description || '—'}` +
    bullets('Responsibilities', job.responsibilities) +
    bullets('Qualifications', job.qualifications) +
    bullets('Benefits', job.benefits)
  const { addendum } = await calibration()

  const parsed = await claudeJson<LlmScore>({
    model: MODELS.score,
    maxTokens: 800,
    system: buildScoringSystem(jobBlock, addendum),
    schema: SCORE_SCHEMA,
    user:
      `CANDIDATE\nField of study: ${student.major ?? '—'}\nStated target roles: ${(student.desired_roles ?? []).join(', ') || '—'}\n` +
      `Self-reported skills (these are CLAIMS — credit only where the résumé evidences them): ${(student.skills ?? []).join(', ') || '—'}\n\n${evidence}`,
  })
  if (!parsed || typeof parsed.score !== 'number') return null
  return {
    score: Math.max(1, Math.min(99, Math.round(parsed.score))),
    confidence: (['low', 'medium', 'high'] as const).includes(parsed.confidence) ? parsed.confidence : 'low',
    breakdown: {
      skills: clampInt(parsed.breakdown?.skills),
      experience: clampInt(parsed.breakdown?.experience),
      location: clampInt(parsed.breakdown?.location),
      compensation: clampInt(parsed.breakdown?.compensation),
    },
    matched_skills: parsed.matched_skills ?? [],
    reasons: parsed.reasons ?? [],
    flags: parsed.flags ?? [],
    tip: parsed.tip ?? '',
  }
}

interface MatchOpts { cache?: boolean }
// Per-request preloaded context so loops over many jobs don't re-fetch the same
// student row / résumé / cache row N times. `cached` of `null` means "known
// miss, don't query"; `undefined` means "look it up yourself".
interface MatchCtx { row?: any; rp?: ResumeProfile | null; cached?: any | null }

/** Apply the honest caps to a raw LLM score → final AiMatch. Claude is the only
 *  source of the number; no deterministic component. */
function finalize(cs: LlmScore, student: MatchStudent, job: MatchJob, rp: ResumeProfile | null): AiMatch {
  const cvLen = (student.cv_text ?? '').length
  const cap = rp && cvLen >= 300 ? 99 : cvLen === 0 ? 50 : cvLen < 300 ? 75 : 92
  let score = cs.score
  if (cs.confidence === 'low') score = Math.min(score, 60)
  else if (cs.confidence === 'medium') score = Math.min(score, 88)
  score = Math.min(cap, Math.round(score))
  return {
    student_id: student.id,
    job_id: job.id,
    score,
    breakdown: cs.breakdown,
    matched_skills: cs.matched_skills,
    reasons: cs.reasons.slice(0, 3),
    mismatch_flags: cs.flags.slice(0, 3),
    tip: cs.tip,
    created_at: new Date().toISOString(),
  }
}

/** Claude-only score for one (student, job). Returns null when Claude is
 *  unavailable (no key / error) — there is no deterministic fallback. */
async function getMatch(studentId: string, job: MatchJob, opts: MatchOpts = {}, ctx: MatchCtx = {}): Promise<AiMatch | null> {
  const useCache = opts.cache !== false
  if (useCache) {
    let cached = ctx.cached
    if (cached === undefined) {
      cached = (await sb.from('ai_match_cache').select('payload, stale').eq('student_id', studentId).eq('job_id', job.id).maybeSingle()).data as any
    }
    if (cached && cached.stale === 0) return JSON.parse(cached.payload)
  }

  const row = ctx.row ?? (await studentRow(studentId))
  const rp = ctx.row ? (ctx.rp ?? null) : await ensureResumeProfile(row)
  const student = toMatchStudent(row, rp)
  const cs = await claudeScore(student, job, rp)
  if (!cs) return null
  const result = finalize(cs, student, job, rp)

  if (useCache) {
    must(await sb.from('ai_match_cache').upsert(
      { student_id: studentId, job_id: job.id, payload: JSON.stringify(result), stale: 0, created_at: now() },
      { onConflict: 'student_id,job_id' },
    ))
  }
  return result
}

/** Active jobs visible to a student — same gates as /jobs (year/school +
 *  school-domain/privacy), so restricted listings are never scored or surfaced. */
async function visibleJobs(viewer: any): Promise<any[]> {
  const rows = must(await sb.from('job_listings').select('*').eq('status', 'active')) as any[]
  const gates = await schoolGates(rows.map((r) => r.company_id))
  return rows.filter((r) => jobVisibleTo(r, viewer, gates))
}

/** Build a MatchJob from an already-loaded job row (avoids a per-job re-query). */
function rowToMatchJob(r: any): MatchJob & { company_id: string; description: string; location: string } {
  return { id: r.id, title: r.title, description: r.description, type: r.type, listing_type: r.listing_type, tags: j.parse(r.tags, []), country: r.country, remote: r.remote === 1, pay: r.pay, company_id: r.company_id, location: r.location, duration: r.duration, responsibilities: j.parse(r.responsibilities, []), qualifications: j.parse(r.qualifications, []), benefits: j.parse(r.benefits, []) }
}

/** All cached match rows for a student in ONE query → job_id -> {payload,stale}. */
async function cacheMap(studentId: string): Promise<Map<string, any>> {
  const rows = (must(await sb.from('ai_match_cache').select('job_id, payload, stale').eq('student_id', studentId)) as any[]) ?? []
  return new Map(rows.map((r) => [r.job_id, r]))
}

ai.get('/match/:jobId', async (req, res) => {
  const r = must(await sb.from('job_listings').select('*').eq('id', req.params.jobId).maybeSingle()) as any
  if (!r) return res.status(404).json({ error: 'not_found' })
  // Don't score (or even reveal a match for) a job the viewer can't see.
  const viewer = await studentRow(req.user!.id)
  const gates = await schoolGates([r.company_id])
  if (!jobVisibleTo(r, viewer, gates)) return res.status(404).json({ error: 'not_found' })
  const m = await getMatch(req.user!.id, rowToMatchJob(r))
  if (!m) return res.status(503).json({ error: 'ai_unavailable' })
  res.json(m)
})

ai.get('/matches', async (req, res) => {
  const uid = req.user!.id
  const viewer = await studentRow(uid)
  const rp = await ensureResumeProfile(viewer)
  const [visible, cm] = await Promise.all([visibleJobs(viewer), cacheMap(uid)])
  // Parallel: cached jobs return instantly; uncached ones score concurrently.
  // Jobs Claude couldn't score (no key / error) are simply omitted.
  const out = await Promise.all(
    visible.map((r) => getMatch(uid, rowToMatchJob(r), {}, { row: viewer, rp, cached: cm.get(r.id) ?? null })),
  )
  res.json(out.filter(Boolean))
})

/* ---------- §8.2 Insights — one engine, aggregated (skill gaps, demand, do-next) ---------- */
ai.get('/insights', async (req, res) => {
  const uid = req.user!.id
  const viewer = await studentRow(uid)
  const rp = await ensureResumeProfile(viewer)
  const [visible, cm] = await Promise.all([visibleJobs(viewer), cacheMap(uid)])
  const scoredRows = await Promise.all(
    visible.map(async (r) => {
      const job = rowToMatchJob(r)
      const m = await getMatch(uid, job, {}, { row: viewer, rp, cached: cm.get(r.id) ?? null })
      return m ? { job, m } : null
    }),
  )
  const rows = scoredRows.filter((x): x is { job: any; m: AiMatch } => !!x)
  rows.sort((a, b) => b.m.score - a.m.score)

  const scores = rows.map((r) => r.m.score)
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

  const doNext: string[] = []
  if (!(viewer?.cv_text ?? '').trim()) doNext.push('Upload your CV — without it every match is capped at 60.')
  if (gaps[0]) doNext.push(`Learn ${gaps[0].name} — it’s asked for in ${gaps[0].count} of your matched roles.`)
  if (gaps[1]) doNext.push(`Build a small project using ${gaps[1].name} to close your second-biggest gap.`)
  if (topMatches[0]) doNext.push(`Apply to your strongest match: ${topMatches[0].title} (${topMatches[0].score}% fit).`)
  if ((j.parse<string[]>(viewer?.skills, []) ?? []).length < 4) doNext.push('Add a few more skills to your profile so the matcher can find more roles for you.')

  res.json({ readiness, total: rows.length, distribution, gaps, strengths, demand, topMatches, doNext })
})

/* ---------- §8.3 Company research ---------- */
ai.post('/company', async (req, res) => {
  const { company, role } = req.body ?? {}
  const text = await claudeTextWithSearch({
    model: MODELS.research,
    maxTokens: 900,
    system:
      'You research a company for an early-career African/global student, using current web results. Be honest and balanced — surface REAL risks (layoffs, funding trouble, poor reviews, visa limits) when the evidence shows them; do not write a brochure. ' +
      'Reply ONLY with JSON: {"overview","culture","opportunity","red_flags","questions":["..","..",".."],"verdict"}.',
    user: `Company: ${company}. Role: ${role ?? 'an early-career role'}. Search for recent, specific information before answering.`,
  })
  const parsed = extractJson<any>(text)
  if (parsed) return res.json(parsed)
  res.json({
    overview: `${company} is a fast-growing company building products with real traction. It invests in early-career talent.`,
    culture: `Interns report genuine ownership and supportive mentorship in an outcomes-focused environment.`,
    opportunity: `For an ambitious early-career candidate, ${company} offers strong learning velocity and a global team.`,
    red_flags: `As with any high-growth company, scope shifts quickly and processes are still maturing — clarify expectations up front.`,
    questions: [`What does success look like in the first 90 days of ${role ?? 'this role'}?`, 'How is mentorship structured for early-career hires?', "What's the team's approach to work-life balance?"],
    verdict: `A strong fit for a self-driven learner who wants real impact early — go for it.`,
  })
})

/* ---------- §8.4 Chat ---------- */
ai.post('/chat', async (req, res) => {
  const { message } = req.body ?? {}
  const student = await loadStudent(req.user!.id)
  const text = await claudeText({
    model: MODELS.chat,
    maxTokens: 1200,
    thinking: true,
    system: `You are a friendly, expert, and HONEST career assistant for ${student?.major ?? 'a student'}. Help with CV, jobs, skills, interviews. Give direct, truthful advice — don't flatter or over-promise. You may use markdown tables, lists, and code blocks.`,
    user: message ?? '',
  })
  res.json({ text: text ?? canChat(message ?? '') })
})

/* ---------- §8.5 Application Coach ---------- */
ai.post('/coach', async (req, res) => {
  const job = await loadJob(req.body?.job_id)
  const row = await studentRow(req.user!.id)
  if (!job || !row) return res.status(404).json({ error: 'not_found' })
  const rp = asResumeProfile(row.resume_profile)
  const student = toMatchStudent(row, rp)
  const evidence = rp ? `Parsed skills: ${(rp.skills ?? []).map((s) => s.name).join(', ')}. Projects: ${(rp.projects ?? []).map((p) => p.name).join(', ')}.` : student.cv_text ?? ''
  const text = await claudeText({
    model: MODELS.coach,
    maxTokens: 1100,
    thinking: true,
    system:
      'You are an honest application coach. Produce JSON: {"draft":"<180-word first-person paragraph","critique":{"strengths":[],"weaknesses":[],"missing":[],"verdict":"ship as-is|refine|rewrite"},"final":"refined paragraph"}. Never invent qualifications the candidate does not have; give a candid critique (real weaknesses, not token ones); ban clichés ("passionate about","leverage").',
    user: `STUDENT: ${student.major ?? ''}, skills ${(student.skills ?? []).join(', ')}. ${evidence}\nJOB: ${job.title} — ${job.description}`,
  })
  const parsed = extractJson<any>(text)
  if (parsed?.draft && parsed?.final) return res.json(parsed)
  res.json(canCoach(student, job))
})

/* ---------- CV Tips ---------- */
ai.post('/cv-tips', async (req, res) => {
  const row = await studentRow(req.user!.id)
  const rp = asResumeProfile(row?.resume_profile)
  const ctx = rp ? `Their résumé shows seniority ${rp.seniority}, skills ${(rp.skills ?? []).map((s) => s.name).join(', ')}, gaps ${(rp.gaps ?? []).join(', ')}.` : 'No parsed résumé yet.'
  const text = await claudeText({ model: MODELS.chat, maxTokens: 500, system: 'Give 5-6 concise, personalized CV improvement tips. Reply ONLY JSON array of strings.', user: ctx })
  const parsed = extractJson<string[]>(text ? `{"x":${text}}` : null) as any
  const tips = Array.isArray(parsed) ? parsed : parseList(text)
  res.json(tips.length ? tips : [
    'Lead each bullet with a strong verb and a measurable result.',
    'Move your most relevant project to the top of the page.',
    'Add the specific tools/frameworks recruiters search for.',
    'Cut anything older than your most recent, most relevant work.',
    'Keep it to one page — every line should earn its place.',
    'Add links: GitHub, portfolio, and LinkedIn in the header.',
  ])
})

/* ---------- §8.6 Career Compass ---------- */
const COMPASS_Q = [
  'To start: what kind of problem or impact do you most want to work on?',
  'What environment helps you do your best work — big team, small startup, remote, on-site?',
  "Tell me about a project or moment you're genuinely proud of.",
  'Which skills do you most want to build over the next year?',
  'Any real-life constraints I should factor in — location, language, schedule?',
]
ai.post('/compass/interview', async (req, res) => {
  const answers: string[] = req.body?.answers ?? []
  const idx = answers.length
  if (idx >= COMPASS_Q.length) return res.json({ done: true, message: "Perfect — I have enough to suggest some directions. Let me pull together your matches." })
  // Hardcoded conversational fallback (used when Claude is unavailable / errors).
  const reacts = ['That gives me a strong signal.', 'Love that.', 'Great, noted.', 'Helpful, thank you.']
  const lead = idx === 0 ? "Let's find a path that fits you. " : `${reacts[(idx - 1) % reacts.length]} `
  const fallback = { done: false as const, message: lead + COMPASS_Q[idx], question: COMPASS_Q[idx] }

  // When Claude is available and we have a prior answer to react to, generate a
  // warm, contextual follow-up. Cheap (Haiku) — this fires once per answer.
  if (hasClaude() && idx > 0) {
    const convo = answers.map((a, i) => `Q${i + 1}: ${COMPASS_Q[i]}\nA: ${a}`).join('\n\n')
    const text = await claudeText({
      model: MODELS.score,
      maxTokens: 120,
      system:
        'You are a warm, sharp Career Compass interviewer. In ONE short message (max ~25 words): briefly acknowledge the student\'s most recent answer, then naturally ask the next question. ' +
        `The next question MUST cover this exact topic: "${COMPASS_Q[idx]}". Reply with ONLY that message — no preamble, no quotes.`,
      user: convo,
    })
    if (text?.trim()) return res.json({ done: false, message: text.trim(), question: COMPASS_Q[idx] })
  }
  res.json(fallback)
})

/** Label what the student told us they care about (shown as chips). Purely
 *  descriptive now — there's no deterministic engine to re-weight. */
function deriveSignals(answers: string[]): string[] {
  const t = answers.join(' \n ').toLowerCase()
  const signals: string[] = []
  if (/remote|anywhere|relocat|\blocation\b|visa|from home|hybrid|on[- ]?site/.test(t)) signals.push('work-style / location')
  if (/learn|grow|develop|build my|improve|master|upskill|new skill/.test(t)) signals.push('skill growth')
  if (/impact|mission|purpose|social|climate|health|education|community|sustainab|africa/.test(t)) signals.push('mission / impact')
  if (/startup|small team|fast[- ]?paced|ownership|autonomy/.test(t)) signals.push('startup ownership')
  if (/pay|salary|money|compensation|stipend|well[- ]?paid/.test(t)) signals.push('compensation')
  return signals
}

ai.post('/compass/recommend', async (req, res) => {
  const answers: string[] = req.body?.answers ?? []
  const uid = req.user!.id
  const viewer = await studentRow(uid)
  const rp = await ensureResumeProfile(viewer)
  const [visible, cm] = await Promise.all([visibleJobs(viewer), cacheMap(uid)])
  const signals = deriveSignals(answers)

  // Rank by the honest Claude score: cached when present, else score now.
  // Jobs Claude can't score are skipped.
  const scoredAll = await Promise.all(visible.map(async (r) => {
    const job = rowToMatchJob(r)
    const m = await getMatch(uid, job, {}, { row: viewer, rp, cached: cm.get(r.id) ?? null })
    return m ? { job, m } : null
  }))
  const top = scoredAll
    .filter((x): x is { job: ReturnType<typeof rowToMatchJob>; m: AiMatch } => !!x)
    .sort((a, b) => b.m.score - a.m.score)
    .slice(0, 3)
  const recs = top.map(({ job, m }) => {
    const missing = job.tags.filter((t) => !m.matched_skills.includes(t))
    return {
      job: { id: job.id, title: job.title, location: job.location, company_id: job.company_id, listing_type: job.listing_type },
      score: m.score,
      why: `This fits your profile${m.matched_skills.length ? ` in ${m.matched_skills.slice(0, 2).join(', ')}` : ''}${signals.length ? `, weighted toward your priorities (${signals.slice(0, 2).join(', ')})` : ''} — a strong ${job.listing_type.toLowerCase()} match.`,
      stretch: missing.length ? `You'd stretch into ${missing.slice(0, 2).join(' and ')}.` : 'You would deepen your existing strengths here.',
      actions: [`Tailor your CV to highlight ${m.matched_skills[0] ?? job.type}.`, `Build a small project using ${missing[0] ?? job.tags[0] ?? 'a core skill'}.`, 'Use AI Research, then message someone on the team.'],
    }
  })
  res.json({
    intro: recs.length
      ? `Based on our conversation, here are my top ${recs.length} recommendations, ranked by fit${signals.length ? ` and weighted toward ${signals.join(', ')}` : ''}.`
      : "I couldn't find strong matches — broaden your profile.",
    signals,
    recs,
  })
})

ai.post('/compass/prep', async (req, res) => {
  const job = await loadJob(req.body?.job_id)
  const row = await studentRow(req.user!.id)
  if (!job || !row) return res.status(404).json({ error: 'not_found' })
  const rp = asResumeProfile(row.resume_profile)
  const student = toMatchStudent(row, rp)
  const matched = job.tags.filter((t) => (student.skills ?? []).some((s) => s.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(s.toLowerCase())))
  const missing = job.tags.filter((t) => !matched.includes(t))
  // Hardcoded fallback — used verbatim when Claude is unavailable / errors, and
  // merged under any partial Claude response so every field is always present.
  const fallback = {
    fit: `You're a solid candidate for ${job.title}${matched.length ? `: your strengths in ${matched.join(', ')} are directly relevant.` : '.'}`,
    gap: missing.length ? `The main gap is ${missing.slice(0, 2).join(' and ')} — address it head-on.` : 'No major gaps — focus on storytelling.',
    skills: (missing.length ? missing : job.tags).slice(0, 4).map((t) => `Brush up on ${t}`),
    talkingPoints: [`I've worked hands-on with ${(student.skills ?? [job.type]).slice(0, 2).join(' and ')}.`, `I'm drawn to this role because it combines ${job.tags.slice(0, 2).join(' and ')}.`, `As a ${student.major ?? 'student'}, I learn fast and take ownership.`],
    questions: [`What does success look like in the first 90 days of ${job.title}?`, 'How is feedback and mentorship structured here?', `What's the team's tooling for ${job.type}?`, 'What are the biggest challenges the team faces right now?'],
    actions: [`Do a 2-hour refresher on ${missing[0] ?? job.tags[0] ?? job.type}.`, 'Rewrite your top CV bullet to show impact.', 'Prepare 2 STAR stories about ownership.'],
  }

  // Real, candid prep grounded in this candidate's actual résumé when Claude is up.
  const evidence = rp
    ? `Parsed skills: ${(rp.skills ?? []).map((s) => s.name).join(', ') || '—'}. Projects: ${(rp.projects ?? []).map((p) => p.name).join(', ') || '—'}. Seniority: ${rp.seniority}.`
    : student.cv_text ?? 'No résumé on file.'
  const text = await claudeText({
    model: MODELS.coach,
    maxTokens: 1000,
    thinking: true,
    system:
      'You are an HONEST interview-prep coach for an early-career candidate. Reply with ONLY JSON: ' +
      '{"fit":"1-2 candid sentences on how well they actually fit","gap":"the real gap stated plainly","skills":["3-4 specific things to brush up"],"talkingPoints":["3 first-person points grounded in their REAL experience"],"questions":["4 sharp questions to ask the interviewer"],"actions":["3 concrete prep actions"]}. ' +
      'Be specific to THIS candidate and role; never invent qualifications they lack; no clichés ("passionate","leverage").',
    user: `STUDENT: ${student.major ?? '—'}, self-reported skills ${(student.skills ?? []).join(', ') || '—'}. ${evidence}\nJOB: ${job.title} (${job.type}) — ${job.description}\nRequired skills: ${job.tags.join(', ') || '—'}`,
  })
  const parsed = extractJson<typeof fallback>(text)
  res.json(parsed?.fit && Array.isArray(parsed.skills) ? { ...fallback, ...parsed } : fallback)
})

ai.post('/research/ask', async (req, res) => {
  const { company, role, question } = req.body ?? {}
  const text = await claudeTextWithSearch({
    model: MODELS.research,
    maxTokens: 600,
    system: `You answer a student's question about a specific company/role honestly and practically in 2-4 sentences, using current web results. Don't sugar-coat — if the honest answer is unfavourable, say so.`,
    user: `Company: ${company}. Role: ${role ?? 'a role'}. Question: ${question}`,
  })
  res.json({ answer: text ?? `Here's what I found on "${question}" for ${role ?? 'this role'} at ${company}: it's a fast-moving environment where early-career talent gets real responsibility. Raise this exact question with the hiring manager and tie your follow-up to your own goals.` })
})

/* ---------- AI Sourcing (describe → find) ---------- */
ai.post('/source', async (req, res) => {
  const query: string = (req.body?.query ?? '').toLowerCase()
  const uid = req.user!.id
  const viewer = await studentRow(uid)
  const rp = await ensureResumeProfile(viewer)
  const cm = await cacheMap(uid)
  const allRows = must(await sb.from('job_listings').select('*').eq('status', 'active')) as any[]
  // Respect the same visibility gates as /jobs — never source a restricted listing.
  const srcGates = await schoolGates(allRows.map((r) => r.company_id))
  const rows = allRows.filter((r) => jobVisibleTo(r, viewer, srcGates))
  const wantRemote = /\bremote\b|anywhere/.test(query)
  let wantType: string | null = null
  if (/intern/.test(query)) wantType = 'Internship'
  else if (/full[- ]?time|new grad|permanent/.test(query)) wantType = 'Full-time'
  else if (/fellow/.test(query)) wantType = 'Fellowship'
  const countries = Array.from(new Set(rows.map((r) => r.country)))
  const wantCountry = countries.find((c) => c !== 'Remote' && query.includes(c.toLowerCase())) ?? null

  const scoredAll = await Promise.all(rows.map(async (r) => {
    const why: string[] = []
    // Honest Claude score (cached or scored now). Jobs Claude can't score are dropped.
    const m = await getMatch(uid, rowToMatchJob(r), {}, { row: viewer, rp, cached: cm.get(r.id) ?? null })
    if (!m) return null
    let score = m.score / 2
    let fail = false
    if (wantRemote) { if (r.remote === 1) { score += 18; why.push('Remote ✓') } else fail = true }
    if (wantType) { if (r.listing_type === wantType) { score += 16; why.push(`${wantType} ✓`) } else fail = true }
    if (wantCountry) { if (r.country === wantCountry) { score += 16; why.push(`${wantCountry} ✓`) } else fail = true }
    if (m.matched_skills.length) { score += m.matched_skills.length * 4; why.push(`Uses your ${m.matched_skills.slice(0, 2).join(' & ')}`) }
    return { job: rowJobLite(r), why, score: Math.min(99, Math.round(score)), fail }
  }))
  const scored = scoredAll.filter((r): r is NonNullable<typeof r> => !!r && !r.fail).sort((a, b) => b.score - a.score).slice(0, 8)

  res.json({ summary: scored.length ? `I found ${scored.length} matching opportunities for you, ranked by fit.` : 'No strong matches — try relaxing a constraint.', results: scored })
})

/* ---------- fallbacks ---------- */
function rowJobLite(r: any) {
  return { id: r.id, title: r.title, location: r.location, listing_type: r.listing_type, pay: r.pay, company_id: r.company_id, apply_url: r.apply_url, original_company_name: r.original_company_name, original_company_logo_url: r.original_company_logo_url, country: r.country, remote: r.remote === 1, tags: j.parse(r.tags, []) }
}
function parseList(text: string | null): string[] {
  if (!text) return []
  return text.split('\n').map((l) => l.replace(/^[-*\d.\s]+/, '').trim()).filter((l) => l.length > 4).slice(0, 6)
}
function canChat(_m: string) {
  return "Here's how I'd approach that:\n\n1. **Sharpen your résumé** around measurable outcomes.\n2. **Target roles** that match your top skills.\n3. **Prepare stories** using the STAR format.\n\nWant me to draft a 30-day prep plan?"
}
function canCoach(student: MatchStudent, job: MatchJob) {
  const skills = (student.skills ?? []).slice(0, 3).join(', ')
  return {
    draft: `As a ${student.major ?? 'student'}, I'm excited to apply for ${job.title}. My hands-on work with ${skills} maps to what you're building, and I bring real ownership.`,
    critique: { strengths: ['Concrete skills named', 'Clear motivation'], weaknesses: ['Opening is slightly generic'], missing: ['A metric from a project'], verdict: 'refine' },
    final: `I'm a ${student.major ?? 'student'} who ships. ${job.title} pairs ${job.tags.slice(0, 2).join(' and ')} with real ownership — my favourite combination. I recently shipped a production feature used by thousands, working across ${skills}. I'd love to bring that energy to your team.`,
  }
}

ai.get('/_status', (_req, res) => res.json({ claude: hasClaude() }))
