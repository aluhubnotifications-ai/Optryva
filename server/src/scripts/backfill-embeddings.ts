// One-shot backfill: parse résumés + compute embeddings for every existing job
// and student so semantic search works on current data.
//   npm run backfill   (from server/)
// Safe to re-run. No-ops gracefully if migrations 0008/0009 aren't applied or
// VOYAGE_API_KEY isn't set (it just reports 0 embeddings written).

import '@/loadenv' // override so project .env wins over a stale shell ANTHROPIC_API_KEY
import { sb, must } from '@/db'
import { hasEmbeddings } from '@/lib/embeddings'
import { hasProfileEmbedding, hasJobEmbedding, embedJob, ensureResumeProfile, embedStudent } from '@/lib/enrich'

async function main() {
  if (!hasEmbeddings()) {
    console.warn('⚠️  VOYAGE_API_KEY not set — résumés will be parsed, but no embeddings will be written.')
  }
  const jobsOk = await hasJobEmbedding()
  const profOk = await hasProfileEmbedding()
  if (!jobsOk || !profOk) {
    console.warn('⚠️  embedding columns missing — run migration 0009 in the Supabase SQL Editor first.')
  }

  const jobs = (must(await sb.from('job_listings').select('*')) as any[]) ?? []
  let jobN = 0
  for (const jrow of jobs) { await embedJob(jrow); jobN++ }
  console.log(`Jobs processed: ${jobN}`)

  const students = (must(await sb.from('profiles').select('*').eq('user_type', 'student')) as any[]) ?? []
  let stuN = 0
  for (const srow of students) {
    const rp = await ensureResumeProfile(srow)
    await embedStudent(srow, rp)
    stuN++
  }
  console.log(`Students processed: ${stuN}`)
  console.log('Done. Run ANALYZE on the embedding tables in Supabase for best index performance.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
