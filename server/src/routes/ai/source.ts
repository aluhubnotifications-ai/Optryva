import { Router } from '@/lib/http'
import { sb, must, j } from '@/db'
import { ensureResumeProfile, retrieveJobsByVector } from '@/lib/enrich'
import { rerank, jobEmbedText, embedOne } from '@/lib/embeddings'
import { schoolGates, jobVisibleTo } from '@/lib/visibility'
import {
  studentRow,
  cacheMap,
  rowToMatchJob,
  getMatch,
  rowJobLite,
  SOURCE_RERANK_K,
  SOURCE_SHOW,
} from './helpers'

export function registerSource(r: Router) {
  /* ---------- AI Sourcing (describe → find) ---------- */
  // Natural-language job search ("remote Python internship in Kenya"). A QUERY-driven
  // funnel: embed the query → ANN-retrieve the closest jobs (hard filters in SQL) →
  // Voyage-rerank by the query → Claude-score a bounded set for the honest fit %.
  // Never scans/scores the whole catalog. Falls back to a keyword-bounded scan when
  // embeddings are off, so it stays bounded regardless.
  r.post('/source', async (req, res) => {
    const query: string = (req.body?.query ?? '').trim()
    const qLower = query.toLowerCase()
    const uid = req.user!.id
    const viewer = await studentRow(uid)
    const rp = await ensureResumeProfile(viewer)
    const cm = await cacheMap(uid)

    // Parse the query into hard filters (these also become the "why" chips).
    const wantRemote = /\bremote\b|anywhere/.test(qLower)
    let wantType: string | null = null
    if (/intern/.test(qLower)) wantType = 'Internship'
    else if (/full[- ]?time|new grad|permanent/.test(qLower)) wantType = 'Full-time'
    else if (/fellow/.test(qLower)) wantType = 'Fellowship'

    // Stage 1 — retrieve a bounded candidate set. Query-driven via embeddings when
    // available; otherwise a filtered scan.
    const qVec = query ? await embedOne(query, 'query') : null
    let rows: any[]
    const ann = qVec ? await retrieveJobsByVector(qVec, wantType ? [wantType] : [], [], wantRemote, 200) : null
    if (ann) {
      const ids = ann.map((a) => a.job_id)
      rows = ids.length ? (must(await sb.from('job_listings').select('*').in('id', ids)) as any[]) : []
    } else {
      rows = must(await sb.from('job_listings').select('*').eq('status', 'active')) as any[]
    }

    // Visibility gates (same as /jobs — never source a restricted listing).
    const srcGates = await schoolGates(rows.map((rr) => rr.company_id))
    rows = rows.filter((rr) => jobVisibleTo(rr, viewer, srcGates))
    const countries = Array.from(new Set(rows.map((rr) => rr.country)))
    const wantCountry = countries.find((c) => c !== 'Remote' && qLower.includes(c.toLowerCase())) ?? null

    // Stage 2 — narrow to the LLM set. Voyage rerank by the query when we can;
    // otherwise a cheap keyword overlap, so the scored set is always bounded.
    if (rows.length > SOURCE_RERANK_K) {
      const docs = rows.map((rr) => jobEmbedText({ title: rr.title, type: rr.type, listing_type: rr.listing_type, tags: j.parse(rr.tags, []), description: rr.description, responsibilities: j.parse(rr.responsibilities, []), qualifications: j.parse(rr.qualifications, []), benefits: j.parse(rr.benefits, []) }))
      const order = query ? await rerank(query, docs, SOURCE_RERANK_K) : null
      if (order) {
        rows = order.map((i) => rows[i])
      } else if (query) {
        const terms = qLower.split(/\W+/).filter((t) => t.length > 2)
        const kw = (rr: any) => { const hay = `${rr.title} ${j.parse<string[]>(rr.tags, []).join(' ')} ${rr.description ?? ''}`.toLowerCase(); return terms.filter((t) => hay.includes(t)).length }
        rows = [...rows].sort((a, b) => kw(b) - kw(a)).slice(0, SOURCE_RERANK_K)
      } else {
        rows = rows.slice(0, SOURCE_RERANK_K)
      }
    }

    // Stage 3 — honest Claude score + relevance chips. The shown fit % is the real
    // match score; the query constraints only RANK and surface "why".
    const scoredAll = await Promise.all(rows.map(async (rr) => {
      const why: string[] = []
      const m = await getMatch(uid, rowToMatchJob(rr), {}, { row: viewer, rp, cached: cm.get(rr.id) ?? null })
      if (!m) return null
      let relevance = m.score
      let fail = false
      if (wantRemote) { if (rr.remote === 1) { relevance += 18; why.push('Remote ✓') } else fail = true }
      if (wantType) { if (rr.listing_type === wantType) { relevance += 16; why.push(`${wantType} ✓`) } else fail = true }
      if (wantCountry) { if (rr.country === wantCountry) { relevance += 16; why.push(`${wantCountry} ✓`) } else fail = true }
      if (m.matched_skills.length) { relevance += m.matched_skills.length * 4; why.push(`Uses your ${m.matched_skills.slice(0, 2).join(' & ')}`) }
      return { job: rowJobLite(rr), why, score: m.score, relevance, fail }
    }))
    const scored = scoredAll
      .filter((item): item is NonNullable<typeof item> => !!item && !item.fail)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, SOURCE_SHOW)

    res.json({ summary: scored.length ? `I found ${scored.length} matching opportunities for you, ranked by fit.` : 'No strong matches — try relaxing a constraint.', results: scored })
  })
}
