import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Bot, User, Trash2, Eraser } from 'lucide-react'
import { evidenceApi } from '@/lib/api'
import { useToast } from '@/components/ui/toast'
import { Markdown } from '@/components/Markdown'
import { cn } from '@/lib/utils'

type ChatMsg = { id: string; role: 'employer' | 'ai'; content: string; created_at: string }

/**
 * Evidence chatbot for employers: ask plain-English questions about a candidate's
 * evidence ("What exactly did they do?", "Where's the proof?") and get grounded,
 * honest answers. Messages can be deleted individually or cleared entirely.
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
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
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

  async function removeMessage(id: string) {
    if (id === 'tmp') return
    const prev = messages
    setMessages((m) => m.filter((x) => x.id !== id))
    try {
      await evidenceApi.deleteChat(studentId, id)
    } catch {
      setMessages(prev)
      toast({ title: "Couldn't delete that message", tone: 'error' })
    }
  }

  async function clearAll() {
    if (messages.length === 0) return
    const prev = messages
    setMessages([])
    try {
      await evidenceApi.clearChat(studentId)
      toast({ title: 'Conversation cleared', tone: 'success' })
    } catch {
      setMessages(prev)
      toast({ title: "Couldn't clear the conversation", tone: 'error' })
    }
  }

  return (
    <div className="flex h-full min-h-[360px] flex-col">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {messages.length > 0 ? `${messages.length} message${messages.length === 1 ? '' : 's'}` : 'No messages yet'}
        </span>
        <button
          type="button"
          onClick={clearAll}
          disabled={messages.length === 0}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Eraser className="h-3.5 w-3.5" /> Clear
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto pr-1">
        {messages.length === 0 && !busy && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground"
          >
            <div className="rounded-2xl bg-primary/10 p-3.5">
              <Bot className="h-6 w-6 text-primary" />
            </div>
            <p className="max-w-xs text-sm">
              Ask anything about this candidate's evidence — what they did, where the proof is, or what's missing.
            </p>
          </motion.div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((m) => {
            const isAI = m.role === 'ai'
            return (
              <motion.div
                key={m.id}
                layout
                initial={{ opacity: 0, y: 12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                className={cn('group flex items-end gap-2', isAI ? 'flex-row' : 'flex-row-reverse')}
              >
                <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full', isAI ? 'bg-accent/15 text-accent' : 'bg-primary/15 text-primary')}>
                  {isAI ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
                </div>
                <div className="relative max-w-[85%]">
                  <div
                    className={cn(
                      'rounded-2xl px-3.5 py-2.5 text-sm shadow-sm',
                      isAI ? 'rounded-bl-sm bg-muted text-foreground' : 'rounded-br-sm bg-primary text-primary-foreground',
                    )}
                  >
                    {isAI ? <Markdown content={m.content} /> : <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeMessage(m.id)}
                    aria-label="Delete message"
                    className="absolute -right-2 -top-2 hidden rounded-full bg-background p-1 text-muted-foreground opacity-0 shadow-sm ring-1 ring-border transition hover:text-destructive group-hover:block group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>

        {busy && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-end gap-2"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
              <Bot className="h-4 w-4" />
            </div>
            <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-muted px-3.5 py-3 shadow-sm">
              {[0, 1, 2].map((d) => (
                <motion.span
                  key={d}
                  className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1, repeat: Infinity, delay: d * 0.2 }}
                />
              ))}
            </div>
          </motion.div>
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
          className="h-11 flex-1 rounded-xl border border-input bg-background px-3.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <motion.button
          type="submit"
          disabled={busy || !input.trim()}
          whileTap={{ scale: 0.92 }}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          aria-label="Send"
        >
          <Send className="h-4 w-4" />
        </motion.button>
      </form>
    </div>
  )
}
