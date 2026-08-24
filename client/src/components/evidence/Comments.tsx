import { useCallback, useEffect, useState } from 'react'
import { evidenceApi } from '@/lib/api'

type Comment = {
  id: string
  user_id: string | null
  content: string
  created_at: string
}

/** Discussion thread under an evidence item. Reviewers can ask for links,
 *  clarification, or context; everyone viewing the evidence sees the thread. */
export function EvidenceComments({ evidenceId }: { evidenceId: string }) {
  const [comments, setComments] = useState<Comment[]>([])
  const [newContent, setNewContent] = useState('')
  const [posting, setPosting] = useState(false)

  const load = useCallback(async () => {
    try {
      setComments(await evidenceApi.listComments(evidenceId))
    } catch {
      /* unauthenticated viewers just see an empty thread */
    }
  }, [evidenceId])

  useEffect(() => {
    load()
  }, [load])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const content = newContent.trim()
    if (!content || posting) return
    setPosting(true)
    try {
      await evidenceApi.addComment(evidenceId, content)
      setNewContent('')
      await load()
    } catch {
      /* keep the text so the user can retry after logging in */
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3">
      <h4 className="text-sm font-medium text-foreground">Discussion</h4>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Ask this candidate for links to anything above so you can check it yourself.
      </p>

      {comments.length === 0 ? (
        <p className="mt-2 text-sm text-foreground/60">No comments yet.</p>
      ) : (
        <div className="mt-2 max-h-44 space-y-2 overflow-y-auto">
          {comments.map((c) => (
            <div key={c.id} className="rounded bg-background p-2">
              <p className="text-sm leading-relaxed text-foreground/90">{c.content}</p>
              <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                {new Date(c.created_at).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
        <input
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          placeholder="Ask for a link or clarification…"
          className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
        />
        <button
          type="submit"
          disabled={!newContent.trim() || posting}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          {posting ? '…' : 'Post'}
        </button>
      </form>
    </div>
  )
}
