// Match-quality eval harness — the measurement foundation for the roadmap.
//
// You can't improve what you don't measure. This reads ONLY data we already
// collect (predicted scores in ai_match_cache, real engagement in applications +
// job_opens) and answers one question: do our scores actually predict what
// students engage with? It needs no new schema and no Claude calls.
//
//   npm run eval-matching
//
// Reports:
//   • Engagement-rate by score band      — should rise monotonically with score.
//   • AUC (rank concordance)             — P(engaged pair scored > ignored pair);
//                                          0.5 = random, 1.0 = perfect ordering.
//   • Recall@K of applied jobs           — of the jobs a student applied to, what
//                                          fraction sit in their top-K by score.
//   • Coverage                           — how much signal we actually have yet.
// Re-run after every matcher change to see whether quality moved.

import 'dotenv/config'
import { sb, must } from '@/db'

type Pair = { student: string; job: string; score: number; engaged: boolean }

const BANDS: [string, number, number][] = [
  ['1-34   poor', 1, 34],
  ['35-54  weak', 35, 54],
  ['55-69  stretch', 55, 69],
  ['70-84  strong', 70, 84],
  ['85-99  exceptional', 85, 99],
]

function pct(n: number, d: number): string {
  return d ? `${((100 * n) / d).toFixed(1)}%` : '—'
}

/** AUC via the Mann–Whitney U rank statistic: the probability that a randomly
 *  chosen engaged pair has a higher score than a randomly chosen ignored one. */
function auc(pairs: Pair[]): number | null {
  const pos = pairs.filter((p) => p.engaged).map((p) => p.score)
  const neg = pairs.filter((p) => !p.engaged).map((p) => p.score)
  if (!pos.length || !neg.length) return null
  // Rank all scores (average ranks for ties), sum ranks of positives.
  const all = pairs.map((p) => p.score).sort((a, b) => a - b)
  const rankOf = new Map<number, number>()
  for (let i = 0; i < all.length; ) {
    let j = i
    while (j < all.length && all[j] === all[i]) j++
    const avgRank = (i + j + 1) / 2 // 1-based average rank for this tie group
    rankOf.set(all[i], avgRank)
    i = j
  }
  const sumPosRanks = pos.reduce((a, s) => a + (rankOf.get(s) ?? 0), 0)
  const u = sumPosRanks - (pos.length * (pos.length + 1)) / 2
  return u / (pos.length * neg.length)
}

export async function runEval() {
  const cache = (must(await sb.from('ai_match_cache').select('student_id, job_id, payload')) as any[]) ?? []
  const apps = (must(await sb.from('applications').select('student_id, job_id')) as any[]) ?? []
  let opens: any[] = []
  try { opens = (must(await sb.from('job_opens').select('user_id, job_id')) as any[]) ?? [] } catch { /* migration 0012 not run */ }

  // Engagement = applied OR clicked-through to an external apply link.
  const engaged = new Set<string>()
  for (const a of apps) engaged.add(`${a.student_id}::${a.job_id}`)
  for (const o of opens) engaged.add(`${o.user_id}::${o.job_id}`)

  const pairs: Pair[] = []
  for (const c of cache) {
    let score: number
    try { score = JSON.parse(c.payload).score } catch { continue }
    if (typeof score !== 'number') continue
    pairs.push({ student: c.student_id, job: c.job_id, score, engaged: engaged.has(`${c.student_id}::${c.job_id}`) })
  }

  console.log('\n=== Optryva match-quality eval ===')
  console.log(`Scored (student,job) pairs: ${pairs.length} · engaged: ${pairs.filter((p) => p.engaged).length} · students: ${new Set(pairs.map((p) => p.student)).size}`)
  if (pairs.length < 20) {
    console.log('\nNot enough scored pairs yet to evaluate. Drive some matching + applications first.')
    return
  }

  // 1) Engagement rate by score band — the headline calibration check.
  console.log('\n— Engagement rate by predicted-score band (want: rising) —')
  for (const [label, lo, hi] of BANDS) {
    const inBand = pairs.filter((p) => p.score >= lo && p.score <= hi)
    const eng = inBand.filter((p) => p.engaged).length
    console.log(`  ${label.padEnd(20)} n=${String(inBand.length).padStart(5)}  engaged=${pct(eng, inBand.length)}`)
  }

  // 2) AUC — overall ranking power.
  const a = auc(pairs)
  console.log(`\n— Ranking power — AUC=${a == null ? 'n/a (need both engaged & ignored pairs)' : a.toFixed(3)} (0.5=random, >0.7=useful, >0.8=strong)`)

  // 3) Recall@K — for students who engaged, are their engaged jobs ranked high?
  const byStudent = new Map<string, Pair[]>()
  for (const p of pairs) (byStudent.get(p.student) ?? byStudent.set(p.student, []).get(p.student)!).push(p)
  for (const K of [5, 10, 20]) {
    let hits = 0, total = 0, students = 0
    for (const [, ps] of byStudent) {
      const eng = ps.filter((p) => p.engaged)
      if (!eng.length || ps.length < 2) continue
      students++
      const topK = new Set([...ps].sort((x, y) => y.score - x.score).slice(0, K).map((p) => p.job))
      for (const e of eng) { total++; if (topK.has(e.job)) hits++ }
    }
    console.log(`  Recall@${String(K).padEnd(2)}  ${pct(hits, total)}  (over ${students} students with engagement)`)
  }
  console.log('')
}

const isCli = typeof process !== 'undefined' && Array.isArray(process.argv) && !!process.argv[1]?.includes('eval-matching')
if (isCli) runEval().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
