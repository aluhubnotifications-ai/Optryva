import { useEffect, useRef, useState } from 'react'
import { Sparkles, Send } from 'lucide-react'
import { aiApi } from '@/lib/api'
import { Card, CardBody } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { Markdown } from '@/components/Markdown'

type Msg = { role: 'user' | 'ai'; text: string }
const PROMPTS = [
  'How can I improve my CV?',
  'Build me a 30-day job-search plan',
  'What skills should I learn next?',
  'Draft a career roadmap',
]

export function ChatTab() {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])

  // Append a streamed token to the last AI bubble (or start one).
  const pushToken = (t: string) =>
    setMsgs((m) => {
      const last = m[m.length - 1]
      if (last?.role === 'ai') return [...m.slice(0, -1), { role: 'ai', text: last.text + t }]
      return [...m, { role: 'ai', text: t }]
    })

  async function send(text: string) {
    const q = text.trim()
    if (!q || busy) return
    setInput('')
    setMsgs((m) => [...m, { role: 'user', text: q }])
    setBusy(true)
    setStreaming(false)
    // Stream the answer live; fall back to the non-streaming call if nothing streamed.
    const streamed = await aiApi.chatStream(q, (t) => { setStreaming(true); pushToken(t) })
    if (!streamed) {
      const res = await aiApi.chat(q)
      setMsgs((m) => [...m, { role: 'ai', text: res }])
    }
    setBusy(false)
    setStreaming(false)
  }

  return (
    <Card>
      <CardBody className="flex h-[calc(100dvh-15rem)] flex-col">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {msgs.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/12 text-primary"><Sparkles className="h-6 w-6" /></div>
              <p className="font-medium">Ask me anything about your career</p>
              <p className="mb-4 text-sm text-muted-foreground">CV feedback, job strategy, interview prep, and more.</p>
              <div className="flex flex-wrap justify-center gap-2">
                {PROMPTS.map((p) => (
                  <button key={p} onClick={() => send(p)} className="rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground">{p}</button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground">{m.text}</div>
              </div>
            ) : (
              <div key={i} className="flex gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary"><Sparkles className="h-4 w-4" /></div>
                <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-2"><Markdown content={m.text} /></div>
              </div>
            ),
          )}
          {busy && !streaming && (
            <div className="flex gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary"><Sparkles className="h-4 w-4 animate-pulse" /></div>
              <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3 text-sm text-muted-foreground">Thinking…</div>
            </div>
          )}
          <div ref={endRef} />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(input) }} className="mt-3 flex items-center gap-2 border-t border-border pt-3">
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask anything…" className="h-11 flex-1 rounded-full border border-input bg-background px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <Button type="submit" size="icon" className="h-11 w-11 rounded-full" disabled={busy || !input.trim()}><Send className="h-4 w-4" /></Button>
        </form>
      </CardBody>
    </Card>
  )
}
