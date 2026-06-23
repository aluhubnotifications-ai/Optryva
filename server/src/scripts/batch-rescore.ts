// Nightly batch re-score: score every student against every active job via the
// Anthropic Batch API (50% cost, async), using the same honest rubric as the
// live path, and write the results into ai_match_cache. The interactive path
// only re-scores on profile/job change — this sweep keeps the whole grid warm.
//   npm run rescore
// No-ops gracefully without ANTHROPIC_API_KEY. Bound the grid with BATCH_LIMIT.

import 'dotenv/config'
import { sb, must, j } from '@/db'
import { anthropic, hasClaude, MODELS } from '@/lib/claude'
import { buildScoringSystem, SCORE_SCHEMA, type LlmScore } from '@/lib/rubric'
import { type MatchJob, type MatchStudent, type AiMatch } from '@/lib/matching'
import { asResumeProfile } from '@/lib/enrich'
import { now } from '@/lib/util'

const LIMIT = Number(process.env.BATCH_LIMIT ?? 5000)

function toStudent(r: any): MatchStudent {
  return {
    id: r.id, cv_text: r.cv_text, skills: j.parse(r.skills, []), desired_roles: j.parse(r.desired_roles, []),
    preferred_industries: j.parse(r.preferred_industries, []), work_type: r.work_type, location_pref: r.location_pref,
    location: r.location, major: r.major, resume_profile: asResumeProfile(r.resume_profile),
  }
}
function toJob(r: any): MatchJob & { description: string } {
  return { id: r.id, title: r.title, description: r.description, type: r.type, listing_type: r.listing_type, tags: j.parse(r.tags, []), country: r.country, remote: r.remote === 1, pay: r.pay }
}
function userText(s: MatchStudent): string {
  const rp = s.resume_profile
  const evidence = rp
    ? `PARSED RÉSUMÉ — seniority: ${rp.seniority}, ~${rp.total_years}y. Skills: ${(rp.skills ?? []).map((x) => x.name).join(', ') || '—'}. Projects: ${(rp.projects ?? []).map((p) => p.name).join('; ') || '—'}.`
    : s.cv_text ? `RÉSUMÉ TEXT:\n${s.cv_text}` : 'NO RÉSUMÉ ON FILE — treat competence as UNVERIFIED.'
  return `CANDIDATE\nField: ${s.major ?? '—'}\nTarget roles: ${(s.desired_roles ?? []).join(', ') || '—'}\nSelf-reported skills (CLAIMS — credit only if evidenced): ${(s.skills ?? []).join(', ') || '—'}\n\n${evidence}`
}

function finalize(cs: LlmScore, s: MatchStudent, jb: MatchJob, cap: number): AiMatch {
  let score = cs.score
  if (cs.confidence === 'low') score = Math.min(score, 60)
  else if (cs.confidence === 'medium') score = Math.min(score, 88)
  score = Math.min(cap, Math.round(score))
  return {
    student_id: s.id, job_id: jb.id, score,
    breakdown: cs.breakdown ?? { skills: score, experience: score, location: score, compensation: score },
    matched_skills: cs.matched_skills ?? [], reasons: (cs.reasons ?? []).slice(0, 3),
    mismatch_flags: (cs.flags ?? []).slice(0, 3), tip: cs.tip ?? '', created_at: new Date().toISOString(),
  }
}

async function main() {
  if (!hasClaude() || !anthropic) { console.warn('ANTHROPIC_API_KEY not set — nothing to do.'); return }

  const cal = (await sb.from('ai_calibration').select('rubric_addendum').eq('id', 'singleton').maybeSingle()).data as any
  const addendum = cal?.rubric_addendum ?? null

  const students = (must(await sb.from('profiles').select('*').eq('user_type', 'student')) as any[]) ?? []
  const jobRows = (must(await sb.from('job_listings').select('*').eq('status', 'active')) as any[]) ?? []
  console.log(`Grid: ${students.length} students × ${jobRows.length} jobs`)

  const pairs: { id: string; s: MatchStudent; j: MatchJob & { description: string } }[] = []
  for (const sr of students) for (const jr of jobRows) {
    pairs.push({ id: `${sr.id}::${jr.id}`, s: toStudent(sr), j: toJob(jr) })
    if (pairs.length >= LIMIT) break
  }
  if (!pairs.length) { console.log('No pairs.'); return }

  const requests = pairs.map((p) => ({
    custom_id: p.id,
    params: {
      model: MODELS.score,
      max_tokens: 800,
      system: buildScoringSystem(`${p.j.title} (${p.j.type}, ${p.j.listing_type}). Core requirements: ${p.j.tags.join(', ') || '—'}.\n${p.j.description}`, addendum),
      output_config: { format: { type: 'json_schema', schema: SCORE_SCHEMA } },
      messages: [{ role: 'user', content: userText(p.s) }],
    },
  }))

  console.log(`Submitting batch of ${requests.length} scoring requests…`)
  const batch = await (anthropic as any).messages.batches.create({ requests })
  console.log(`Batch ${batch.id} — polling…`)

  // Poll until ended (most finish within the hour).
  let status = batch
  while (status.processing_status !== 'ended') {
    await new Promise((r) => setTimeout(r, 30_000))
    status = await (anthropic as any).messages.batches.retrieve(batch.id)
    process.stdout.write('.')
  }
  console.log('\nBatch ended. Writing results…')

  const byId = new Map(pairs.map((p) => [p.id, p]))
  let written = 0
  for await (const result of await (anthropic as any).messages.batches.results(batch.id)) {
    if (result.result?.type !== 'succeeded') continue
    const p = byId.get(result.custom_id)
    if (!p) continue
    const text = (result.result.message.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
    let cs: LlmScore | null = null
    try { cs = JSON.parse(text) } catch { cs = null }
    if (!cs || typeof cs.score !== 'number') continue
    const cvLen = (p.s.cv_text ?? '').length
    const cap = p.s.resume_profile && cvLen >= 300 ? 99 : cvLen === 0 ? 50 : cvLen < 300 ? 75 : 92
    const merged = finalize(cs, p.s, p.j, cap)
    const [studentId, jobId] = p.id.split('::')
    must(await sb.from('ai_match_cache').upsert(
      { student_id: studentId, job_id: jobId, payload: JSON.stringify(merged), stale: 0, created_at: now() },
      { onConflict: 'student_id,job_id' },
    ))
    written++
  }
  console.log(`Done. Wrote ${written} cached matches.`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
