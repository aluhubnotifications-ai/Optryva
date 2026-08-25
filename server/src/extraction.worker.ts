import { Router } from '@/lib/http'
import {
  fetchLinkText,
  describeImage,
  analyzeEvidence,
  pdfText,
  delegateFile,
  buildCandidateSummary,
  answerQuestion,
  type CandidateEvidenceItem,
} from '@/lib/extraction'

// Dedicated Extraction Worker. Owns all heavy AI/parsing compute (Mistral
// vision + text, unpdf, link crawling, Python-service delegation). The main API
// Worker authenticates with it via a shared bearer token and never runs this
// code itself, keeping its bundle small.

const app = Router()

// Public health check (no auth) — must be registered before the auth guard.
app.get('/', (_req, res) => {
  res.json({ ok: true, worker: 'extraction' })
})

// Guard: every request except the public health check must carry
// `Authorization: Bearer <EXTRACTION_WORKER_TOKEN>`.
app.use((req, res, next) => {
  const reqPath = (req.raw?.req?.path as string) || ''
  if (reqPath === '/') return next()
  const token = process.env.EXTRACTION_WORKER_TOKEN
  const auth = req.headers['authorization'] ?? req.headers['Authorization']
  if (!token || auth !== `Bearer ${token}`) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  next()
})

app.post('/url', async (req, res) => {
  const { url } = req.body ?? {}
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' })
  const text = await fetchLinkText(url)
  res.json({ text: text ?? null })
})

app.post('/image', async (req, res) => {
  const { dataUrl } = req.body ?? {}
  if (!dataUrl || typeof dataUrl !== 'string') return res.status(400).json({ error: 'dataUrl required' })
  const description = await describeImage(dataUrl)
  res.json({ description: description ?? null })
})

app.post('/pdf', async (req, res) => {
  const { data_base64 } = req.body ?? {}
  if (!data_base64 || typeof data_base64 !== 'string') return res.status(400).json({ error: 'data_base64 required' })
  const text = await pdfText(data_base64)
  res.json({ text: text ?? null })
})

app.post('/file', async (req, res) => {
  const { filename, data_base64, mime } = req.body ?? {}
  if (!data_base64 || typeof data_base64 !== 'string') return res.status(400).json({ error: 'data_base64 required' })
  const out = await delegateFile({ filename, data_base64, mime })
  res.json(out ?? { text: null })
})

app.post('/analyze', async (req, res) => {
  const { text } = req.body ?? {}
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'text required' })
  const result = await analyzeEvidence(text)
  res.json(result)
})

app.post('/candidate-summary', async (req, res) => {
  const { items, jobDescription } = req.body ?? {}
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' })
  const summary = await buildCandidateSummary(items as CandidateEvidenceItem[], typeof jobDescription === 'string' ? jobDescription : '')
  res.json({ summary: summary ?? null })
})

app.post('/ask', async (req, res) => {
  const { question, items } = req.body ?? {}
  if (!question || typeof question !== 'string') return res.status(400).json({ error: 'question required' })
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' })
  const answer = await answerQuestion(question, items as CandidateEvidenceItem[])
  res.json({ answer: answer ?? null })
})

export default {
  fetch: app.hono.fetch,
}
