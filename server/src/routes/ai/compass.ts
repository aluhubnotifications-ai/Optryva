import { Router } from '@/lib/http'
import { sb, must } from '@/db'
import { claudeText, streamClaude, extractJson, hasClaude, MODELS } from '@/lib/claude'
import { ensureResumeProfile, asResumeProfile, retrieveCandidateJobs, retrieveJobsByVector } from '@/lib/enrich'
import type { AiMatch } from '@/lib/matching'
import {
  studentRow,
  firstNameOf,
  candidateJobs,
  cacheMap,
  rowToMatchJob,
  getMatch,
  deriveSignals,
  COMPASS_Q,
  interviewSystem,
  toMatchStudent,
  loadJob,
  parseJsonArray,
} from './helpers'

export function registerCompass(r: Router) {
  /* ---------- §8.6 Career Compass ---------- */
  r.post('/compass/interview', async (req, res) => {
    const answers: string[] = req.body?.answers ?? []
    const idx = answers.length
    const row = await studentRow(req.user!.id)
    const name = firstNameOf(row?.full_name)
    if (idx >= COMPASS_Q.length) return res.json({ done: true, message: `Perfect${name ? `, ${name}` : ''} — I've got a clear picture of you now. Give me a moment to pull together the directions that fit you best…` })
    // Hardcoded conversational fallback (used when Claude is unavailable / errors).
    const reacts = ['That really helps me understand you.', 'Love that.', 'Great — noted.', 'Thanks for sharing that.']
    const lead = idx === 0
      ? `Hi${name ? ` ${name}` : ' there'}! I'm your Career Compass — think of me as a friend helping you figure out your next step, no pressure. `
      : `${reacts[(idx - 1) % reacts.length]} `
    const fallback = { done: false as const, message: lead + COMPASS_Q[idx], question: COMPASS_Q[idx] }

    // When Claude is available and we have a prior answer to react to, generate a
    // warm, contextual follow-up that uses their name. Cheap (Haiku) — once per answer.
    if (hasClaude() && idx > 0) {
      const convo = answers.map((a, i) => `Q${i + 1}: ${COMPASS_Q[i]}\nA: ${a}`).join('\n\n')
      const text = await claudeText({ model: MODELS.score, maxTokens: 150, system: interviewSystem(name, idx), user: convo })
      if (text?.trim()) return res.json({ done: false, message: text.trim(), question: COMPASS_Q[idx] })
    }
    res.json(fallback)
  })

  /* Streaming Career Compass question — the warm follow-up types out live. Only
   * mid-interview turns stream (the greeting + the closing line are fixed text);
   * 409 tells the client to use the plain endpoint for those. */
  r.post('/compass/interview/stream', async (req, res) => {
    if (!hasClaude()) return res.status(503).json({ error: 'ai_unavailable' })
    const answers: string[] = req.body?.answers ?? []
    const idx = answers.length
    if (idx === 0 || idx >= COMPASS_Q.length) return res.status(409).json({ error: 'no_stream' })
    const row = await studentRow(req.user!.id)
    const name = firstNameOf(row?.full_name)
    const convo = answers.map((a, i) => `Q${i + 1}: ${COMPASS_Q[i]}\nA: ${a}`).join('\n\n')
    const stream = streamClaude({
      model: MODELS.score,
      maxTokens: 150,
      meta: { done: false, question: COMPASS_Q[idx] },
      system: interviewSystem(name, idx),
      user: convo,
    })
    if (!stream) return res.status(503).json({ error: 'ai_unavailable' })
    res.sse(stream)
  })

  r.post('/compass/recommend', async (req, res) => {
    const answers: string[] = req.body?.answers ?? []
    const uid = req.user!.id
    const viewer = await studentRow(uid)
    const rp = await ensureResumeProfile(viewer)
    const [visible, cm] = await Promise.all([candidateJobs(viewer, rp), cacheMap(uid)])
    const signals = deriveSignals(answers)

    // Rank by the honest Claude score: cached when present, else score now.
    // Jobs Claude can't score are skipped.
    const scoredAll = await Promise.all(visible.map(async (rr) => {
      const job = rowToMatchJob(rr)
      const m = await getMatch(uid, job, {}, { row: viewer, rp, cached: cm.get(rr.id) ?? null })
      return m ? { job, m } : null
    }))
    const top = scoredAll
      .filter((x): x is { job: ReturnType<typeof rowToMatchJob>; m: AiMatch } => !!x)
      .sort((a, b) => b.m.score - a.m.score)
      .slice(0, 3)
    const name = firstNameOf(viewer?.full_name)
    // Templated narrative (also the no-key path / fallback).
    const tmplNarrative = (job: ReturnType<typeof rowToMatchJob>, m: AiMatch) => {
      const missing = job.tags.filter((t) => !m.matched_skills.includes(t))
      return {
        why: `This fits your profile${m.matched_skills.length ? ` in ${m.matched_skills.slice(0, 2).join(', ')}` : ''}${signals.length ? `, weighted toward your priorities (${signals.slice(0, 2).join(', ')})` : ''} — a strong ${job.listing_type.toLowerCase()} match.`,
        stretch: missing.length ? `You'd stretch into ${missing.slice(0, 2).join(' and ')}.` : 'You would deepen your existing strengths here.',
        actions: [`Tailor your CV to highlight ${m.matched_skills[0] ?? job.type}.`, `Build a small project using ${missing[0] ?? job.tags[0] ?? 'a core skill'}.`, 'Use AI Research, then message someone on the team.'],
      }
    }
    // AI-written, personal notes for all top picks in ONE call (grounded in the
    // real Claude scores + matched skills). Falls back to the template per field.
    let notes: any[] | null = null
    if (hasClaude() && top.length) {
      const ai = await claudeText({
        model: MODELS.score,
        maxTokens: 700,
        system:
          `You are ${name ? `${name}'s ` : 'a '}warm, honest career mentor. For each recommended role (in order), write a short personal note. ` +
          `Reply ONLY a JSON array of objects {"why":"1 warm sentence on why it genuinely fits THEM","stretch":"1 honest sentence on what they'd grow into","actions":["3 short, concrete prep actions"]}. Be specific to their skills and the role; no clichés ("passionate","leverage").`,
        user: top.map(({ job, m }, i) => `#${i + 1} ${job.title} (${job.listing_type}), fit ${m.score}%. Matches their skills: ${m.matched_skills.join(', ') || '—'}. Role wants: ${job.tags.join(', ') || '—'}.`).join('\n'),
      })
      notes = parseJsonArray(ai)
    }
    const recs = top.map(({ job, m }, i) => {
      const t = tmplNarrative(job, m)
      const n = notes?.[i]
      return {
        job: { id: job.id, title: job.title, location: job.location, company_id: job.company_id, listing_type: job.listing_type },
        score: m.score,
        why: typeof n?.why === 'string' && n.why.trim() ? n.why : t.why,
        stretch: typeof n?.stretch === 'string' && n.stretch.trim() ? n.stretch : t.stretch,
        actions: Array.isArray(n?.actions) && n.actions.length ? n.actions.slice(0, 3) : t.actions,
      }
    })
    res.json({
      intro: recs.length
        ? `Thanks for sharing all that${name ? `, ${name}` : ''} — based on our conversation, here are my top ${recs.length} directions for you, ranked by how well they fit${signals.length ? ` and weighted toward what matters to you (${signals.join(', ')})` : ''}.`
        : `I couldn't find strong matches just yet${name ? `, ${name}` : ''} — try adding a few more skills or broadening your profile, and I'll take another look.`,
      signals,
      recs,
    })
  })

  r.post('/compass/prep', async (req, res) => {
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
    if (hasClaude()) {
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
      if (parsed?.fit && Array.isArray(parsed.skills)) return res.json({ ...fallback, ...parsed })
      return res.status(503).json({ error: 'ai_unavailable' })
    }
    res.json(fallback) // no key: safety net
  })
}
