import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Send, MessageSquare, ArrowLeft, Smile, Trash2, Briefcase } from 'lucide-react'
import { useCurrentUser } from '@/lib/store'
import { messagesApi, profilesApi, type Conversation } from '@/lib/api'
import type { Message, Profile } from '@/types'
import { Avatar, Badge } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { cn, timeAgo } from '@/lib/utils'

const REACTIONS = ['👍', '🎉', '❤️', '🙏', '🔥']

export default function Messages() {
  const user = useCurrentUser()!
  const [params, setParams] = useSearchParams()
  const toId = params.get('to') // counterpart for a freshly-opened DM (no messages yet)
  const [convos, setConvos] = useState<Conversation[]>([])
  const [people, setPeople] = useState<Record<string, Profile>>({})
  const peopleRef = useRef<Record<string, Profile>>({})
  const [activeId, setActiveId] = useState<string | null>(params.get('thread'))
  const [loading, setLoading] = useState(true)
  const inFlightRef = useRef(false) // don't let polls stack up
  const convosSigRef = useRef('') // only re-render when something actually changed

  async function loadConvos() {
    if (inFlightRef.current) return
    inFlightRef.current = true
    try {
      const cs = await messagesApi.conversations(user.id)
      const ids = new Set(cs.map((c) => c.counterpartId))
      if (toId) ids.add(toId)
      const missing = [...ids].filter((id) => id && !peopleRef.current[id])
      if (missing.length) {
        const profs = await Promise.all(missing.map((id) => profilesApi.get(id)))
        const merged = { ...peopleRef.current }
        profs.forEach((p) => p && (merged[p.id] = p))
        peopleRef.current = merged
        setPeople(merged)
      }
      const sig = cs.map((c) => `${c.thread_id}:${c.lastAt ?? ''}:${c.unread}`).join('|')
      if (sig !== convosSigRef.current) {
        convosSigRef.current = sig
        setConvos(cs)
      }
      setLoading(false)
      setActiveId((prev) => prev ?? (cs.length ? cs[0].thread_id : prev))
    } catch {
      setLoading(false) // surface the empty/“no conversations” state instead of a stuck spinner
    } finally {
      inFlightRef.current = false
    }
  }

  // Keep a ref to the latest loader so the poll interval always calls fresh state.
  const loadRef = useRef(loadConvos)
  loadRef.current = loadConvos

  useEffect(() => {
    loadRef.current()
    const t = setInterval(() => loadRef.current(), 4000) // live: refresh conversation list
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // The active conversation: a real one, or a synthesized DM for a brand-new thread.
  const active: Conversation | null =
    convos.find((c) => c.thread_id === activeId) ??
    (activeId && toId ? { thread_id: activeId, scope: 'dm', counterpartId: toId, unread: 0 } : null)

  function selectThread(id: string) {
    setActiveId(id)
    params.delete('thread')
    params.delete('scope')
    params.delete('to')
    setParams(params, { replace: true })
  }

  return (
    <div>
      <h1 className="mb-3 flex items-center gap-2 text-2xl font-bold tracking-tight">
        <MessageSquare className="h-6 w-6 text-primary" /> Messages
      </h1>

      <div className="grid h-[calc(100dvh-11rem)] min-h-[420px] grid-cols-1 overflow-hidden rounded-2xl border border-border lg:grid-cols-[320px_1fr]">
        {/* Conversation list */}
        <aside className={cn('flex flex-col border-r border-border bg-card', active && 'hidden lg:flex')}>
          <div className="border-b border-border p-3 text-sm font-semibold">Conversations</div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <p className="p-4 text-sm text-muted-foreground">Loading…</p>
            ) : convos.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No conversations yet.</p>
            ) : (
              convos.map((c) => {
                const person = people[c.counterpartId]
                const name = person?.company_name || person?.full_name || 'Unknown'
                return (
                  <button
                    key={c.thread_id}
                    onClick={() => selectThread(c.thread_id)}
                    className={cn(
                      'flex w-full items-start gap-3 border-b border-border/60 p-3 text-left transition-colors hover:bg-muted/50',
                      activeId === c.thread_id && 'bg-primary/5',
                    )}
                  >
                    <Avatar name={name} src={person?.avatar_url} size={42} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold">{name}</p>
                        {c.lastAt && <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(c.lastAt)}</span>}
                      </div>
                      {c.scope === 'application' ? (
                        <span className="inline-flex max-w-full items-center gap-1 truncate text-[11px] text-muted-foreground"><Briefcase className="h-3 w-3 shrink-0" /> {c.jobTitle ? `Application · ${c.jobTitle}` : 'Application'}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><MessageSquare className="h-3 w-3 shrink-0" /> Direct message</span>
                      )}
                      <p className="truncate text-xs text-muted-foreground">{c.lastBody ?? 'No messages yet'}</p>
                    </div>
                    {c.unread > 0 && <span className="mt-1 h-5 min-w-5 rounded-full bg-primary px-1 text-center text-[11px] font-bold leading-5 text-primary-foreground">{c.unread}</span>}
                  </button>
                )
              })
            )}
          </div>
        </aside>

        {/* Thread */}
        <section className={cn('flex flex-col bg-background', !active && 'hidden lg:flex')}>
          {active ? (
            <Thread
              key={active.thread_id}
              convo={active}
              person={people[active.counterpartId]}
              userId={user.id}
              onBack={() => setActiveId(null)}
              onChanged={loadConvos}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Select a conversation</div>
          )}
        </section>
      </div>
    </div>
  )
}

function Thread({
  convo,
  person,
  userId,
  onBack,
  onChanged,
}: {
  convo: Conversation
  person?: Profile
  userId: string
  onBack: () => void
  onChanged: () => void
}) {
  const [msgs, setMsgs] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [reactFor, setReactFor] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const sigRef = useRef('')
  const pollingRef = useRef(false)
  const name = person?.company_name || person?.full_name || 'Unknown'

  // A cheap signature so polling only re-renders when something actually changed.
  function signature(m: Message[]) {
    return m.map((x) => `${x.id}:${Object.keys(x.reactions).length}`).join('|') + `#${m.length}`
  }

  async function load(markRead = true) {
    const m = await messagesApi.thread(convo.thread_id)
    sigRef.current = signature(m)
    setMsgs(m)
    if (markRead) {
      await messagesApi.markThreadRead(convo.thread_id, userId)
      onChanged()
    }
  }

  useEffect(() => {
    load(true)
    // live: poll the open thread; mark read + refresh list when new content arrives
    const t = setInterval(async () => {
      if (pollingRef.current) return
      pollingRef.current = true
      try {
        const m = await messagesApi.thread(convo.thread_id)
        const sig = signature(m)
        if (sig !== sigRef.current) {
          sigRef.current = sig
          setMsgs(m)
          await messagesApi.markThreadRead(convo.thread_id, userId)
          onChanged()
        }
      } catch {
        /* ignore transient poll errors */
      } finally {
        pollingRef.current = false
      }
    }, 2500)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convo.thread_id])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  async function send() {
    const body = input.trim()
    if (!body) return
    setInput('')
    await messagesApi.send({ thread_id: convo.thread_id, scope: convo.scope, sender_id: userId, kind: 'text', body })
    await load()
  }

  async function react(id: string, emoji: string) {
    await messagesApi.react(id, emoji, userId)
    setReactFor(null)
    load()
  }

  async function remove(id: string) {
    await messagesApi.remove(id)
    await load()
  }

  const grouped = useMemo(() => msgs, [msgs])

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border bg-card p-3">
        <button onClick={onBack} className="rounded-lg p-1.5 hover:bg-muted lg:hidden"><ArrowLeft className="h-5 w-5" /></button>
        <Avatar name={name} src={person?.avatar_url} size={38} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{name}</p>
          {convo.scope === 'application' && convo.jobTitle ? (
            <span className="text-xs text-muted-foreground">Re: {convo.jobTitle}</span>
          ) : (
            <Badge tone="outline" className="text-[10px]">Direct message</Badge>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
        {grouped.map((m) => {
          const mine = m.sender_id === userId
          return (
            <div key={m.id} className={cn('group flex items-end gap-2', mine ? 'justify-end' : 'justify-start')}>
              {!mine && <Avatar name={name} src={person?.avatar_url} size={28} />}
              <div className="relative max-w-[75%]">
                <div className={cn('whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm', mine ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm border border-border bg-card')}>
                  {m.body}
                </div>
                {Object.keys(m.reactions).length > 0 && (
                  <div className={cn('mt-1 flex gap-1', mine ? 'justify-end' : 'justify-start')}>
                    {Object.entries(m.reactions).map(([emoji, users]) => (
                      <span key={emoji} className="rounded-full border border-border bg-card px-1.5 py-0.5 text-xs">{emoji} {users.length}</span>
                    ))}
                  </div>
                )}
                <span className={cn('mt-0.5 block text-[10px] text-muted-foreground', mine ? 'text-right' : 'text-left')}>{timeAgo(m.created_at)}</span>

                {/* hover actions */}
                <div className={cn('absolute -top-2 hidden gap-1 group-hover:flex', mine ? 'right-0' : 'left-0')}>
                  <button onClick={() => setReactFor(reactFor === m.id ? null : m.id)} className="rounded-full border border-border bg-card p-1 shadow-soft hover:bg-muted"><Smile className="h-3.5 w-3.5" /></button>
                  {mine && <button onClick={() => remove(m.id)} className="rounded-full border border-border bg-card p-1 shadow-soft hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>}
                </div>
                {reactFor === m.id && (
                  <div className={cn('absolute z-10 mt-1 flex gap-1 rounded-full border border-border bg-card p-1 shadow-card', mine ? 'right-0' : 'left-0')}>
                    {REACTIONS.map((e) => <button key={e} onClick={() => react(m.id, e)} className="rounded-full px-1 text-base hover:bg-muted">{e}</button>)}
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {msgs.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Say hello 👋</p>}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <form onSubmit={(e) => { e.preventDefault(); send() }} className="flex items-center gap-2 border-t border-border bg-card p-3">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type a message…" className="h-11 flex-1 rounded-full border border-input bg-background px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        <Button type="submit" size="icon" className="h-11 w-11 rounded-full" disabled={!input.trim()}><Send className="h-4 w-4" /></Button>
      </form>
    </>
  )
}
