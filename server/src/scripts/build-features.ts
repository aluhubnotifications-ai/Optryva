// Materialize the learning-to-rank training set (roadmap Phase 2).
//
// For every scored (student, job) pair we already have, compute the shared feature
// vector (lib/features.ts) and attach a graded relevance LABEL from real behavior:
//   2 = hired · 1 = opened/applied · 0 = surfaced but ignored.
// Writes to match_features (migration 0015). No Claude calls — reads the cached LLM
// score and the stored résumé profile, so it's cheap to re-run nightly.
//
//   npm run build-features
//
// When positives accumulate (~50+), this table is the one input a ranker needs.

import '@/loadenv' // override so project .env wins over a stale shell ANTHROPIC_API_KEY
import { sb, must, j } from '@/db'
import { now } from '@/lib/util'
import { asResumeProfile, semanticSimilarities } from '@/lib/enrich'
import { extractFeatures, type FeatureInput } from '@/lib/features'

export async function buildFeatures() {
  const probe = await sb.from('match_features').select('student_id').limit(1)
  if (probe.error) { console.log('match_features table missing — run migration 0015_match_features.sql first.'); return }

  const cache = (must(await sb.from('ai_match_cache').select('student_id, job_id, payload')) as any[]) ?? []
  if (!cache.length) { console.log('No scored pairs yet — drive some matching first.'); return }

  // Graded labels from engagement (max wins across sources).
  const apps = (must(await sb.from('applications').select('student_id, job_id, status')) as any[]) ?? []
  let opens: any[] = []
  try { opens = (must(await sb.from('job_opens').select('user_id, job_id')) as any[]) ?? [] } catch { /* 0012 not run */ }
  let outcomes: any[] = []
  try { outcomes = (must(await sb.from('match_outcomes').select('student_id, job_id, status')) as any[]) ?? [] } catch { /* 0014 not run */ }
  const labelOf = new Map<string, number>()
  const bump = (k: string, v: number) => labelOf.set(k, Math.max(labelOf.get(k) ?? 0, v))
  for (const o of opens) bump(`${o.user_id}::${o.job_id}`, 1)
  for (const a of apps) bump(`${a.student_id}::${a.job_id}`, a.status === 'hired' ? 2 : 1)
  for (const o of outcomes) bump(`${o.student_id}::${o.job_id}`, o.status === 'likely_hired' ? 2 : o.status === 'profile_updated' ? 1 : 0)

  // Load every referenced job once.
  const jobIds = [...new Set(cache.map((c) => c.job_id))]
  const jobRows = (must(await sb.from('job_listings').select('id, title, type, listing_type, tags, country, remote, created_at').in('id', jobIds)) as any[]) ?? []
  const jobOf = new Map(jobRows.map((r) => [r.id, r]))

  // Group by student so the profile + similarity map load once each.
  const byStudent = new Map<string, any[]>()
  for (const c of cache) (byStudent.get(c.student_id) ?? byStudent.set(c.student_id, []).get(c.student_id)!).push(c)

  let built = 0
  for (const [studentId, rows] of byStudent) {
    const prof = (await sb.from('profiles').select('skills, desired_roles, location, cv_text, resume_profile').eq('id', studentId).maybeSingle()).data as any
    if (!prof) continue
    const rp = asResumeProfile(prof.resume_profile)
    const sims = await semanticSimilarities(studentId)
    const studentSkills = j.parse<string[]>(prof.skills, [])
    const desiredRoles = j.parse<string[]>(prof.desired_roles, [])
    const cvLen = (prof.cv_text ?? '').length

    const upserts: any[] = []
    for (const c of rows) {
      const jr = jobOf.get(c.job_id)
      if (!jr) continue
      let pred: number | null = null
      let bd: any = null
      try { const p = JSON.parse(c.payload); pred = p.score ?? null; bd = p.breakdown ?? null } catch { /* bad cache row */ }
      const fi: FeatureInput = {
        predScore: pred,
        breakdown: bd,
        cosine: sims.get(c.job_id) ?? null,
        student: { skills: studentSkills, seniority: rp?.seniority ?? null, totalYears: rp?.total_years ?? 0, country: prof.location, cvLen, desiredRoles },
        job: { tags: j.parse<string[]>(jr.tags, []), listing_type: jr.listing_type, country: jr.country, remote: jr.remote === 1, createdAt: jr.created_at, title: jr.title, type: jr.type },
      }
      upserts.push({
        student_id: studentId, job_id: c.job_id, features: extractFeatures(fi),
        label: labelOf.get(`${studentId}::${c.job_id}`) ?? 0, pred_score: pred, built_at: now(),
      })
    }
    if (upserts.length) {
      must(await sb.from('match_features').upsert(upserts, { onConflict: 'student_id,job_id' }))
      built += upserts.length
    }
  }

  const labels = (must(await sb.from('match_features').select('label')) as any[]) ?? []
  const pos = labels.filter((l) => l.label >= 1).length
  console.log(`Built ${built} feature rows · positives (label>=1): ${pos} / ${labels.length}.`)
  console.log(pos < 50 ? 'Keep gathering engagement before training a ranker (~50+ positives).' : 'Enough signal to train a first ranker.')
}

const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) && !!process.argv[1]?.includes('build-features')
if (isCli) buildFeatures().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
