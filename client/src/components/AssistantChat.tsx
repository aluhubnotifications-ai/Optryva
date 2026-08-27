import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Sparkles, ExternalLink, Wrench, CheckCircle2, AlertCircle, X, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/toast'
import { trackAi } from '@/lib/aiActivity'
import type { AssistantAction } from '@/lib/api'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  actions?: AssistantAction[]
  isStreaming?: boolean
}

export interface AssistantChatProps {
  mode: 'student' | 'employer' | 'university'
  sessionId?: string
  pageContext?: string
  onAction?: (action: AssistantAction) => void
  onSessionId?: (id: string) => void
}

interface ToolEvent {
  id: string
  name: string
  input?: Record<string, unknown>
  result?: string
  status: 'calling' | 'done' | 'error'
}

export function AssistantChat({ mode, sessionId, pageContext, onAction, onSessionId }: AssistantChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>(sessionId)
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([])
  const [isAutonomous, setIsAutonomous] = useState(false)
  const [aborted, setAborted] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, toolEvents])

  const resetState = () => {
    setToolEvents([])
    setAborted(false)
    abortRef.current = null
  }

  const handleSend = async (opts?: { autonomous?: boolean }) => {
    const autonomous = opts?.autonomous ?? false
    if (!input.trim() || isSending) return
    const userText = input.trim()
    setInput('')
    setIsSending(true)
    setIsAutonomous(autonomous)
    resetState()

    // Optimistically show the user's message
    const userMsg: ChatMessage = { id: `u_${Date.now()}`, role: 'user', content: userText }
    setMessages((m) => [...m, userMsg])

    // Immediate acknowledgement — stream the first response right away
    const aiMsgId = `a_${Date.now()}`
    const ackText = autonomous
      ? 'I\'m working on this step by step…'
      : "I'm checking that now…"
    setMessages((m) => [...m, { id: aiMsgId, role: 'assistant', content: ackText, isStreaming: true }])

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const { assistantApi } = await import('@/lib/api')

      if (autonomous) {
        // Autonomous agentic task (streaming SSE)
        await trackAi('Autonomous agent running…', () =>
          assistantApi.runTask(
            userText,
            { sessionId: currentSessionId, mode, pageContext },
            (ev) => handleEvent(ev, aiMsgId),
            controller.signal,
          ),
        )
      } else {
        // Normal chat — single AI request, non-streaming
        const resp = await trackAi('Thinking…', () =>
          assistantApi.chat(
            userText,
            { sessionId: currentSessionId, mode, pageContext },
            controller.signal,
          ),
        )
        if (resp.session_id && !currentSessionId) {
          setCurrentSessionId(resp.session_id)
          onSessionId?.(resp.session_id)
        }
        // Replace ack text with the actual reply (treat as delta)
        setMessages((m) =>
          m.map((msg) =>
            msg.id === aiMsgId
              ? { id: msg.id, role: 'assistant', content: resp.text, actions: resp.actions, isStreaming: false }
              : msg,
          ),
        )
        resp.actions?.forEach((a) => onAction?.(a))
      }
    } catch (e: any) {
      if (aborted || e?.name === 'AbortError') {
        setMessages((m) =>
          m.map((msg) =>
            msg.id === aiMsgId ? { ...msg, content: msg.content + '\n\nCancelled.', isStreaming: false } : msg,
          ),
        )
      } else {
        setMessages((m) =>
          m.map((msg) =>
            msg.id === aiMsgId
              ? { ...msg, content: 'Sorry — I ran into an error. Please try again.', isStreaming: false }
              : msg,
          ),
        )
      }
    } finally {
      setIsSending(false)
      setIsAutonomous(false)
      resetState()
    }
  }

  function handleEvent(ev: any, aiMsgId: string) {
    switch (ev.event) {
      case 'text':
        // Treat as delta — replace not append to avoid duplication
        if (ev.text) {
          setMessages((m) =>
            m.map((msg) => (msg.id === aiMsgId ? { ...msg, content: ev.text, isStreaming: true } : msg)),
          )
        }
        break
      case 'tool_use':
        {
          const te: ToolEvent = {
            id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: ev.name,
            input: ev.input,
            status: 'calling',
          }
          setToolEvents((t) => [...t, te])
        }
        break
      case 'tool_result':
        setToolEvents((t) =>
          t.map((te) => (te.name === ev.name && te.status === 'calling' ? { ...te, result: ev.result, status: 'done' } : te)),
        )
        break
      case 'action':
        onAction?.(ev.action)
        break
      case 'done':
        setMessages((m) => m.map((msg) => (msg.id === aiMsgId ? { ...msg, isStreaming: false } : msg)))
        break
      case 'error':
        setMessages((m) =>
          m.map((msg) =>
            msg.id === aiMsgId
              ? { ...msg, content: `${msg.content}\n\nSorry — something went wrong: ${ev.message}`, isStreaming: false }
              : msg,
          ),
        )
        break
    }

    if (ev.event === 'end') {
      setMessages((m) => m.map((msg) => (msg.id === aiMsgId ? { ...msg, isStreaming: false } : msg)))
    }
  }

  const handleCancel = () => {
    if (abortRef.current) {
      setAborted(true)
      abortRef.current.abort()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleAutonomous = () => {
    handleSend({ autonomous: true })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Sparkles className="mx-auto h-8 w-8 mb-3 opacity-30" />
            <p className="text-sm">Ask me something — I can add skills, create jobs, inspect links, and more.</p>
            <p className="mt-2 text-xs">For multi-step tasks, use the "Run task" button.</p>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))
        )}
        {toolEvents.length > 0 && (
          <div className="ml-11 space-y-2">
            {toolEvents.map((te) => (
              <ToolEventBubble key={te.id} event={te} />
            ))}
          </div>
        )}
        {isSending && (
          <div className="flex items-start gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-4 w-4 animate-pulse text-primary" />
            </div>
            <div className="rounded-2xl bg-muted/50 px-4 py-3">
              <div className="flex gap-1">
                <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40 delay-75"></span>
                <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40 delay-150"></span>
                <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40 delay-300"></span>
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border p-3">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask the Optryva Assistant to do something…"
            className="flex-1 rounded-full"
            disabled={isSending}
          />
          {isSending ? (
            <Button onClick={handleCancel} size="sm" className="rounded-full" variant="outline" aria-label="Cancel">
              <X className="h-4 w-4" />
            </Button>
          ) : (
            <>
              <Button onClick={() => handleSend()} disabled={!input.trim()} size="sm" className="rounded-full" aria-label="Send">
                <Send className="h-4 w-4" />
              </Button>
              <Button onClick={() => handleSend({ autonomous: true })} disabled={!input.trim()} size="sm" className="rounded-full" variant="outline" aria-label="Run task (autonomous)">
                <Zap className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
        {isSending && <p className="mt-2 text-xs text-muted-foreground">{isAutonomous ? 'Autonomous agent is working…' : 'Thinking…'}</p>}
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className="flex items-start gap-3">
      <div
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary',
        )}
      >
        {isUser ? 'U' : <Sparkles className="h-4 w-4" />}
      </div>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted/50',
        )}
      >
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
        {message.isStreaming && <span className="animate-pulse">|</span>}
        {message.actions && message.actions.length > 0 && (
          <div className="mt-2 space-y-1 border-t border-border/20 pt-2">
            {message.actions.map((a, i) => (
              <ActionPreview key={i} action={a} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ToolEventBubble({ event }: { event: ToolEvent }) {
  const icon =
    event.status === 'calling' ? (
      <Wrench className="h-3 w-3 animate-spin text-accent" />
    ) : event.status === 'error' ? (
      <AlertCircle className="h-3 w-3 text-danger" />
    ) : (
      <CheckCircle2 className="h-3 w-3 text-success" />
    )

  return (
    <div className="flex items-start gap-2 rounded-lg border border-border/20 bg-background/50 px-3 py-2 text-xs">
      {icon}
      <div className="min-w-0 flex-1">
        <span className="font-medium">{event.name}</span>
        {event.input && (
          <pre className="mt-1 max-h-24 overflow-y-auto rounded bg-muted/50 p-1.5 text-[10px] text-muted-foreground">
            {JSON.stringify(event.input, null, 1)}
          </pre>
        )}
        {event.result && (
          <pre className="mt-1 max-h-32 overflow-y-auto rounded bg-muted/50 p-1.5 text-[10px] text-muted-foreground break-all">
            {event.result}
          </pre>
        )}
      </div>
    </div>
  )
}

function ActionPreview({ action }: { action: AssistantAction }) {
  const label = {
    inject_data: 'Injected into',
    create_job: 'Created job in',
    navigate: 'Navigated to',
    update_profile: 'Updated profile',
    add_evidence: 'Added evidence to',
  }[action.type] ?? action.type

  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-background/50 px-2 py-1.5 text-xs">
      <span className="font-medium text-muted-foreground">{label} </span>
      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground/80">{action.target}</span>
      {action.type === 'navigate' && <ExternalLink className="ml-auto h-3 w-3 text-muted-foreground" />}
    </div>
  )
}
