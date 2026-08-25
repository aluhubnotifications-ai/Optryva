import { useEffect, useRef, useState } from 'react'
import { Send, Bot, User } from 'lucide-react'
import { evidenceApi } from '@/lib/api'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

type ChatMsg = { id: string; role: 'employer' | 'ai'; content: string; created_at: string }

/**
 * Evidence chatbot for employers: ask plain-English questions about a candidate's
 * evidence ("What exactly did they do?", "Where's the proof?") and get grounded,
 * honest answers. No comments — this is the only evidence discussion surface.
 */
export function EvidenceChat({ studentId }: { studentId: string }) {
  const { toast } = useToast()
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    evidenceApi
      .listChat(studentId)
      .then(setMessages)
      .catch(() => undefined)
  }, [studentId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, busy])

  async function send() {
    const q = input.trim()
    if (!q || busy) return
    setInput('')
    setBusy(true)
    const optimistic: ChatMsg = { id: 'tmp', role: 'employer', content: q, created_at: new Date().toISOString() }
    setMessages((m) => [...m, optimistic])
    try {
      const res = await evidenceApi.askChat(studentId, q)
      if (Array.isArray(res)) {
        setMessages((m) => [...m.filter((x) => x.id !== 'tmp'), ...res])
      } else {
        setMessages((m) => m.filter((x) => x.id !== 'tmp'))
        toast({ title: "Couldn't get an answer", tone: 'error' })
      }
    } catch {
      setMessages((m) => m.filter((x) => x.id !== 'tmp'))
      toast({ title: "Couldn't reach the evidence assistant", tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-[360px] flex-col">
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto pr-1">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <Bot className="h-7 w-7 text-primary/70" />
            <p className="max-w-xs text-sm">Ask anything about this candidate's evidence — what they did, where the proof is, or what's missing.</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={cn('flex gap-2', m.role === 'employer' ? 'flex-row-reverse' : 'flex-row')}>
            <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full', m.role === 'employer' ? 'bg-primary/15 text-primary' : 'bg-accent/15 text-accent')}>
              {m.role === 'employer' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
            </div>
            <div className={cn('max-w-[80%] rounded-2xl px-3 py-2 text-sm', m.role === 'employer' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground')}>
              <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent"><Bot className="h-4 w-4" /></div>
            <div className="rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground">Thinking…</div>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
        className="mt-3 flex items-center gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about this evidence…"
          className="h-10 flex-1 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          aria-label="Send"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  )
}
