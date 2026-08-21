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
  res.redirect(signedUrl)
})
