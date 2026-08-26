import { Router } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { getUsageSummary } from '@/lib/usage'
import { hasClaude } from '@/lib/claude'
import { registerMatches } from './ai/matches'
import { registerInsights } from './ai/insights'
import { registerResearch } from './ai/research'
import { registerChat } from './ai/chat'
import { registerCompass } from './ai/compass'
import { registerSource } from './ai/source'
import { registerAssignment } from './ai/assignment'
import { registerJob } from './ai/job'

export const ai = Router()
ai.use(requireAuth)

// AI usage metering — per-model token totals + estimated credits for the caller.
ai.get('/usage', async (req, res) => {
  res.json(await getUsageSummary(req.user!.id))
})

ai.get('/_status', (_req, res) => res.json({ claude: hasClaude() }))

registerMatches(ai)
registerInsights(ai)
registerResearch(ai)
registerChat(ai)
registerCompass(ai)
registerSource(ai)
registerAssignment(ai)
registerJob(ai)
