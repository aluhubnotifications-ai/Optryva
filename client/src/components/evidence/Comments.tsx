import { useEffect, useState } from 'react'

type Comment = {
  id: string
  user_id: string | null
  content: string
  created_at: string
}

type Props = {
  evidenceId: string
  // Bearer token for auth; obtained from your auth flow (e.g. useAuthToken()).
  // If omitted, comments are shown in read‑only mode.
  token?: string
}

// Fetch comments from the API (shared by effect and submit handler).
async function fetchCommentsApi(evidenceId: string, token: string | undefined) {
  if (!token) return []
  const r = await fetch(`/api/evidence/${evidenceId}/comments`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await r.json()
  return data
}

export function EvidenceComments({ evidenceId, token }: Props) {
  const [comments, setComments] = useState<Comment[]>([])
  const [newContent, setNewContent] = useState('')

  useEffect(() => {
    ;(async () => {
      setComments(await fetchCommentsApi(evidenceId, token))
    })()
  }, [evidenceId, token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!newContent.trim()) return
    await fetch(`/api/evidence/${evidenceId}/comments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: newContent }),
    })
    setNewContent('')
    ;(async () => {
      setComments(await fetchCommentsApi(evidenceId, token))
    })()
  }

  return (
    <div className="space-y-4">
      <h3 className="font-medium text-sm text-foreground">Discussion</h3>

      {/* Comments list */}
      {comments.length === 0 ? (
        <p className="text-sm text-foreground/60">No comments yet.</p>
      ) : (
        <div className="space-y-2 max-h-40 overflow-y-auto">
          {comments.map((c) => (
            <div key={c.id} className="p-2 rounded bg-muted/30">
              <p className="font-small text-foreground/90">{c.content}</p>
              <p className="text-xs text-foreground/60 mt-1">
                {c.user_id ? `by user ${c.user_id}` : 'anonymous'} · {c.created_at}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Add new comment */}
      <form onSubmit={handleSubmit} className="mt-3">
        <div className="flex">
          <input
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Add a comment or question…"
            className="flex-1 border rounded p-1 text-sm"
            disabled={!newContent.trim()}
          />
          <button type="submit" className="ml-2 border rounded px-2 px-3 text-sm">
            Post
          </button>
        </div>
      </form>
    </div>
  )
}