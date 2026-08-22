import { Router } from '@/lib/http'
import { requireAuth } from '@/lib/auth'
import { authorizeAndSign, pathFromToken } from '@/lib/documents'

export const documents = Router()
documents.use(requireAuth)

documents.get('/:token', async (req, res) => {
  const path = pathFromToken(req.params.token)
  if (!path) return res.status(404).json({ error: 'not_found' })
  const signedUrl = await authorizeAndSign(path, req.user!)
  if (!signedUrl) return res.status(404).json({ error: 'not_found' })
  const document = await fetch(signedUrl)
  if (!document.ok) return res.status(502).json({ error: 'document_fetch_failed' })
  res.response(new Response(document.body, {
    status: 200,
    headers: {
      'Content-Type': document.headers.get('content-type') ?? 'application/octet-stream',
      'Content-Length': document.headers.get('content-length') ?? '',
      'Cache-Control': 'private, no-store',
      'Content-Disposition': document.headers.get('content-disposition') ?? 'inline',
    },
  }))
})
