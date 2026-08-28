import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles,
  Activity,
  Search,
  ChevronRight,
  ChevronLeft,
  MessageSquare,
  X,
  Clock,
  Plus,
  Trash2,
  Briefcase,
  ClipboardCheck,
  Users,
  BarChart3,
  Check,
  User,
  FileText,
} from 'lucide-react'
import { useUiStore } from '@/lib/store'
import { cn, formatDate } from '@/lib/utils'
import { useAiActivity } from '@/lib/aiActivity'
import { useCurrentUser } from '@/lib/store'
import { useToast } from '@/components/ui/toast'
import { useTransitionNavigate } from '@/lib/useTransitionNavigate'
import { AssistantChat, type ChatMessage } from '@/components/AssistantChat'
import type { AssistantAction } from '@/lib/api'

type AssistantView = 'chat' | 'history'

interface RightSidebarProps {
  mode: 'student' | 'employer' | 'university'
}

interface TabDef {
  key: string
  label: string
  icon: React.ComponentType<any>
}

const STUDENT_TABS: TabDef[] = [
  { key: 'assistant', label: 'Assistant', icon: MessageSquare },
  { key: 'activity', label: 'Activity', icon: Activity },
  { key: 'research', label: 'Research', icon: Search },
]

const EMPLOYER_TABS: TabDef[] = [
  { key: 'assistant', label: 'Assistant', icon: MessageSquare },
  { key: 'evidence', label: 'Evidence', icon: FileText },
  { key: 'assessments', label: 'Assessments', icon: ClipboardCheck },
  { key: 'candidates', label: 'Candidates', icon: Users },
  { key: 'decisions', label: 'Decisions', icon: BarChart3 },
]

const STORAGE_KEY = 'optryva-sidebar-open'
const SESSION_KEY = 'optryva-assistant-session'
const TAB_KEY = 'optryva-sidebar-tab'

interface HistorySession {
  id: string
  mode: string
  updated_at: string
  last_message?: string
}

export function RightSidebar({ mode }: RightSidebarProps) {
  const tabs = mode === 'employer' ? EMPLOYER_TABS : STUDENT_TABS
  const setSidebarOpen = useUiStore((s) => s.setRightSidebarOpen)

  const [open, setOpen] = useState(() => {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(STORAGE_KEY) !== 'closed'
    }
    return true
  })

  useEffect(() => {
    setSidebarOpen(open)
  }, [open, setSidebarOpen])
  const [activeTab, setActiveTab] = useState<string>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(TAB_KEY)
      if (saved && tabs.find((t) => t.key === saved)) return saved
    }
    return 'assistant'
  })
  const [assistantView, setAssistantView] = useState<AssistantView>('chat')
  const [sessionId, setSessionId] = useState<string | undefined>(() => {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(SESSION_KEY) ?? undefined : undefined
  })
  const [sessions, setSessions] = useState<HistorySession[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [pendingMessage, setPendingMessage] = useState<string | null>(null)
  const [pendingContext, setPendingContext] = useState<Record<string, unknown> | null>(null)
  const [chatOrigin, setChatOrigin] = useState<string | null>(null)
  const { toast } = useToast()
  const navigate = useTransitionNavigate()
  const currentUser = useCurrentUser()

  // Extract job_id / candidate_id from the current URL so the assistant knows
  // what the user is looking at even when they open the chat directly.
  const urlContext = useMemo(() => {
    if (typeof window === 'undefined') return null
    const path = window.location.pathname
    const jobMatch = path.match(/^\/app\/listings\/([^/]+)/)
    const appMatch = path.match(/^\/app\/applicants\/([^/]+)/)
    const ctx: Record<string, unknown> = {}
    if (jobMatch) ctx.job_id = jobMatch[1]
    if (appMatch) ctx.application_id = appMatch[1]
    return Object.keys(ctx).length ? ctx : null
  }, [])

  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, open ? 'open' : 'closed')
      localStorage.setItem(TAB_KEY, activeTab)
      if (sessionId) localStorage.setItem(SESSION_KEY, sessionId)
    }
  }, [open, activeTab, sessionId])

  // Listen for global "open chat" requests from other pages.
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      setOpen(true)
      setAssistantView('chat')
      if (e.detail?.origin === 'evidence') {
        // Open the Evidence tab instead of the Assistant tab when triggered from evidence view.
        setActiveTab('evidence')
      } else {
        setActiveTab('assistant')
      }
      if (e.detail?.message) setPendingMessage(e.detail.message)
      if (e.detail?.job_id || e.detail?.candidate_id) {
        setPendingContext({
          job_id: e.detail.job_id,
          candidate_id: e.detail.candidate_id,
        })
      }
      if (e.detail?.origin) setChatOrigin(e.detail.origin)
    }
    window.addEventListener('optryva:open_chat', handler as EventListener)
    return () => window.removeEventListener('optryva:open_chat', handler as EventListener)
  }, [])

  const loadSessions = useCallback(async () => {
    if (!currentUser?.id) return
    try {
      const { assistantApi } = await import('@/lib/api')
      const list = await assistantApi.sessions()
      const enriched = await Promise.all(
        list.map(async (s: any) => {
          if (!s.id || !s.updated_at) return s
          try {
            const { messages: msgs } = await assistantApi.messages(s.id)
            const last = msgs[msgs.length - 1]
            return { ...s, last_message: last?.content?.slice(0, 80) || '' }
          } catch {
            return s
          }
        }),
      )
      setSessions(enriched.filter((s) => s.id))
    } catch {
      /* ignore */
    }
  }, [currentUser?.id])

  const loadMessages = useCallback(async (sid: string): Promise<ChatMessage[]> => {
    try {
      const { assistantApi } = await import('@/lib/api')
      const { messages: msgs } = await assistantApi.messages(sid)
      const mapped: ChatMessage[] = msgs.map((m: any) => ({
        id: m.id || `msg_${Math.random().toString(36).slice(2)}`,
        role: m.role === 'user' ? 'user' : 'assistant',
        content: String(m.content || ''),
        actions: m.actions ?? [],
        isStreaming: false,
      }))
      setMessages(mapped)
      return mapped
    } catch {
      setMessages([])
      return []
    }
  }, [])

  useEffect(() => {
    if (open && currentUser?.id) {
      loadSessions()
      if (sessionId) loadMessages(sessionId)
    }
  }, [open, currentUser?.id, sessionId, loadSessions, loadMessages])

  const handleAction = useCallback(
    async (action: AssistantAction) => {
      const detail = action.data
      switch (action.type) {
        case 'inject_data':
          if (action.target === 'profile_skills' && currentUser?.id) {
            const skills = detail.skills
              ? Array.isArray(detail.skills)
                ? detail.skills as string[]
                : [String(detail.skills)]
              : []
            if (skills.length > 0) {
              try {
                const { profilesApi } = await import('@/lib/api')
                await profilesApi.updateSkills(currentUser.id, skills)
                toast({ title: 'Skills updated', description: `${skills.length} skill(s) added.`, tone: 'success' })
              } catch {
                toast({ title: 'Update failed', tone: 'error' })
              }
            }
          }
          if (action.target === 'job_editor') {
            window.dispatchEvent(new CustomEvent('optryva:inject_job', { detail }))
            toast({ title: 'Job data injected', description: 'Job Editor auto-filled.', tone: 'success' })
          }
          break
        case 'create_job':
          await handleCreateJob(detail)
          break
        case 'update_profile':
          if (currentUser?.id) {
            const { profilesApi } = await import('@/lib/api')
            const patch: Record<string, unknown> = {}
            for (const key of ['full_name', 'school', 'major', 'linkedin', 'github', 'twitter', 'website', 'skills']) {
              if (key in detail) patch[key] = detail[key]
            }
            try {
              await profilesApi.update(currentUser.id, patch as any)
              toast({ title: 'Profile updated', tone: 'success' })
            } catch {
              toast({ title: 'Update failed', tone: 'error' })
            }
          }
          break
        case 'navigate':
          // When chat was opened from the evidence summary, stay on the current
          // page so the user keeps their context. Only allow sidebar tab switches.
          if (chatOrigin === 'evidence') {
            // Allow candidate_id / job_id routes that are already in the URL —
            // just ignore the navigate action entirely.
            break
          }
          // Prevent AI from sending users to pages meant for a different role.
          // /app/insights is a student page — employers should go to /app/listings.
          if (mode === 'employer' && action.target === '/app/insights') {
            navigate('/app/listings', { replace: true })
            setActiveTab(mode === 'employer' ? 'candidates' : 'activity')
            break
          }
          navigate(action.target.startsWith('/') ? action.target : `/${action.target}`, { replace: true })
          break
        case 'start_shortlist': {
          const jobId = (detail as any)?.job_id || action.target
          // When opened from evidence, suppress main-page navigation but still
          // switch the sidebar tab to candidates.
          if (chatOrigin === 'evidence') {
            setActiveTab(mode === 'employer' ? 'candidates' : 'activity')
            toast({
              title: 'Shortlist started',
              description: `Analyzing candidates for job ${(jobId as string)?.slice(0, 8) ?? 'this role'}…`,
              tone: 'info',
            })
            break
          }
          const shortlistPath = mode === 'employer' ? '/app/listings' : '/app/insights'
          if (jobId && typeof jobId === 'string') {
            navigate(shortlistPath, { replace: true })
            setActiveTab(mode === 'employer' ? 'candidates' : 'activity')
            toast({
              title: 'Shortlist started',
              description: `Analyzing candidates for job ${jobId.slice(0, 8)}…`,
              tone: 'info',
            })
          } else {
            navigate(shortlistPath, { replace: true })
            toast({ title: 'Shortlist', description: 'Open the Smart Shortlist on this page.', tone: 'info' })
          }
          break
        }
        case 'add_evidence':
          window.dispatchEvent(new CustomEvent('optryva:add_evidence', { detail }))
          toast({ title: 'Evidence added', description: 'Verified evidence injected.', tone: 'success' })
          break
      }
    },
    [currentUser?.id, navigate, toast, chatOrigin],
  )

  async function handleCreateJob(detail: Record<string, unknown>) {
    if (!currentUser?.id) return
    const { jobsApi } = await import('@/lib/api')
    const job: any = {
      company_id: currentUser.id,
      title: detail.title ?? 'Untitled Job',
      description: detail.description ?? '',
      location: detail.location ?? '',
      listing_type: detail.listing_type ?? detail.type ?? 'Internship',
      type: detail.listing_type ?? detail.type ?? 'Internship',
      tags: Array.isArray(detail.tags) ? (detail.tags as string[]).join(',') : detail.tags ?? '[]',
      qualifications: Array.isArray(detail.qualifications) ? (detail.qualifications as string[]).join(',') : '[]',
      responsibilities: Array.isArray(detail.responsibilities) ? (detail.responsibilities as string[]).join(',') : '[]',
      benefits: Array.isArray(detail.benefits) ? (detail.benefits as string[]).join(',') : '[]',
      pay: detail.pay ?? '',
      status: 'draft',
    }
    try {
      const created = await jobsApi.create(job)
      toast({ title: 'Job created', description: `${created.title} created as draft.`, tone: 'success' })
      navigate('/app/listings', { replace: true })
      setActiveTab(mode === 'employer' ? 'candidates' : 'activity')
    } catch (e: any) {
      toast({ title: 'Job creation failed', description: e?.message ?? 'Try the editor instead.', tone: 'error' })
    }
  }

  const startNewConversation = () => {
    setSessionId(undefined)
    localStorage.removeItem(SESSION_KEY)
    setMessages([])
    setAssistantView('chat')
  }

  const switchToSession = async (sid: string) => {
    await loadMessages(sid)
    setSessionId(sid)
    setAssistantView('chat')
  }

  const deleteSession = async (sid: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const { assistantApi } = await import('@/lib/api')
      await assistantApi.deleteSession(sid)
      setSessions((prev) => prev.filter((x) => x.id !== sid))
      if (sessionId === sid) startNewConversation()
      toast({ title: 'Session deleted', tone: 'info' })
    } catch {
      toast({ title: 'Could not delete', tone: 'error' })
    }
  }

  const isAssistantTab = activeTab === 'assistant'

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex">
      {/* Collapse toggle */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="flex w-1.5 flex-shrink-0 cursor-pointer items-center justify-center border-l border-border hover:bg-muted"
          title="Collapse sidebar"
        >
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      )}

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="sidebar"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.2 }}
            className="flex w-[420px] flex-shrink-0 flex-col border-l border-border bg-card/80 shadow-xl"
          >
            {/* Header with gradient */}
            <div className="flex items-center justify-between border-b border-border bg-gradient-to-r from-primary/10 via-accent/5 to-primary/10 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent">
                  <Sparkles className="h-3 w-3 text-white" />
                </div>
                <span className="font-semibold text-sm">
                  Optryva AI
                  <span className="ml-1 text-muted-foreground/60">
                    {mode === 'employer' ? ' (Employer)' : mode === 'student' ? ' (Student)' : ''}
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-1">
                {isAssistantTab && (
                  <button
                    onClick={() => setAssistantView(assistantView === 'chat' ? 'history' : 'chat')}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title={assistantView === 'chat' ? 'View history' : 'Back to chat'}
                  >
                    {assistantView === 'chat' ? <Clock className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-full p-1 text-muted-foreground hover:bg-muted"
                  aria-label="Close sidebar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Tab navigation */}
            <div className="flex border-b border-border bg-muted/60 px-3">
              {tabs.map((tab) => {
                const Icon = tab.icon
                const active = activeTab === tab.key
                return (
                  <button
                    key={tab.key}
                    onClick={() => {
                      setActiveTab(tab.key)
                      if (tab.key === 'assistant') setAssistantView('chat')
                    }}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-1.5 rounded-t-lg py-2.5 text-xs font-medium transition-all',
                      active
                        ? 'border-b-2 border-primary text-primary'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                )
              })}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-hidden">
              <TabPanel active={activeTab === 'assistant'}>
                {assistantView === 'history' ? (
                  <HistoryView
                    sessions={sessions}
                    onSwitch={switchToSession}
                    onDelete={deleteSession}
                    onNew={startNewConversation}
                    currentSessionId={sessionId}
                  />
                ) : (
                   <AssistantChat
                     key={sessionId ?? 'new'}
                     mode={mode}
                     sessionId={sessionId}
                     pageContext={typeof window !== 'undefined' ? window.location.pathname : undefined}
                     onAction={handleAction}
                     onSessionId={setSessionId}
                     onNew={startNewConversation}
                     initialMessages={messages}
                     pendingMessage={pendingMessage}
                     pendingContext={pendingContext ?? urlContext}
                     onPendingConsumed={() => {
                       setPendingMessage(null)
                       setPendingContext(null)
                       setChatOrigin(null)
                     }}
                  />
                )}
              </TabPanel>

               {/* Student tabs */}
              <TabPanel active={activeTab === 'activity' && mode !== 'employer'}>
                <div className="h-full overflow-y-auto p-4">
                  <ActivityPanelCompact />
                </div>
              </TabPanel>

              <TabPanel active={activeTab === 'research' && mode !== 'employer'}>
                <div className="h-full overflow-y-auto p-4">
                  <StudentResearchPanel />
                </div>
              </TabPanel>

              {/* Evidence tab — same AssistantChat, scoped to candidate evidence */}
              <TabPanel active={activeTab === 'evidence' && mode === 'employer'}>
                <AssistantChat
                  key={sessionId ?? 'evidence-new'}
                  mode={mode}
                  sessionId={sessionId}
                  pageContext={typeof window !== 'undefined' ? window.location.pathname : undefined}
                  onAction={handleAction}
                  onSessionId={setSessionId}
                  onNew={startNewConversation}
                  initialMessages={messages}
                  pendingMessage={pendingMessage}
                  pendingContext={pendingContext ?? urlContext}
                  onPendingConsumed={() => {
                    setPendingMessage(null)
                    setPendingContext(null)
                    setChatOrigin(null)
                  }}
                />
              </TabPanel>

              {/* Employer tabs */}
              <TabPanel active={activeTab === 'assessments' && mode === 'employer'}>
                <div className="h-full overflow-y-auto p-4">
                  <EmployerAssessmentsPanel />
                </div>
              </TabPanel>

              <TabPanel active={activeTab === 'candidates' && mode === 'employer'}>
                <div className="h-full overflow-y-auto p-4">
                  <EmployerCandidatesPanel />
                </div>
              </TabPanel>

              <TabPanel active={activeTab === 'decisions' && mode === 'employer'}>
                <div className="h-full overflow-y-auto p-4">
                  <EmployerDecisionsPanel />
                </div>
              </TabPanel>
            </div>

            {/* Status bar */}
            <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-success" />
                AI ready
              </span>
              <span className="font-mono text-xs text-muted-foreground/60">{mode} mode</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Collapsed state — icon strip */}
      {!open && (
        <div className="flex w-12 flex-shrink-0 flex-col items-center gap-2 border-l border-border bg-card/80 py-3 shadow-xl">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.key}
                onClick={() => {
                  setOpen(true)
                  setActiveTab(tab.key)
                }}
                className="rounded-lg p-2.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                title={tab.label}
                aria-label={tab.label}
              >
                <Icon className="h-5 w-5" />
              </button>
            )
          })}
          <div className="mt-2 border-t border-border pt-2">
            <button
              onClick={() => setOpen(true)}
              className="rounded-lg p-2.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function TabPanel({ active, children }: { active: boolean; children: React.ReactNode }) {
  if (!active) return null
  return <div className="h-full w-full">{children}</div>
}

/** Conversation history list. */
function HistoryView({
  sessions,
  onSwitch,
  onDelete,
  onNew,
  currentSessionId,
}: {
  sessions: HistorySession[]
  onSwitch: (sid: string) => void | Promise<void>
  onDelete: (sid: string, e: React.MouseEvent) => void
  onNew: () => void
  currentSessionId?: string
}) {
  return (
    <div className="flex h-full flex-col p-3">
      <div className="flex items-center justify-between border-b border-border pb-2 mb-3">
        <h3 className="text-xs font-semibold text-muted-foreground">Recent conversations</h3>
        <button
          onClick={onNew}
          className="flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/20"
        >
          <Plus className="h-3 w-3" />
          New
        </button>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <MessageSquare className="mx-auto h-8 w-8 opacity-30 mb-2" />
            <p className="text-sm">No conversation history yet.</p>
            <p className="text-xs mt-1">Start chatting and your conversations will be saved here.</p>
          </div>
        ) : (
          sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => onSwitch(s.id)}
              className={cn(
                'group cursor-pointer rounded-lg border border-border/20 px-3 py-2 text-sm transition-colors hover:bg-muted',
                s.id === currentSessionId && 'bg-primary/5 border-primary/30',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {s.last_message || 'New conversation'}
                  </p>
                  <p className="truncate text-xs text-muted-foreground mt-0.5">
                    {formatDate(s.updated_at)} · {s.mode}
                  </p>
                </div>
                <button
                  onClick={(e) => onDelete(s.id, e)}
                  className="rounded p-0.5 opacity-0 text-muted-foreground hover:bg-muted hover:text-foreground group-hover:opacity-100"
                  title="Delete"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/** Compact AI activity panel for the sidebar. */
function ActivityPanelCompact() {
  const { tasks, clear } = useAiActivity()

  if (tasks.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <Activity className="h-8 w-8 text-muted-foreground/30" />
        <div>
          <p className="text-sm font-medium">No AI activity yet</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-[320px]">
            Matching, company research, and the career compass will show up here as they work.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <h3 className="text-xs font-semibold text-muted-foreground">Recent activity</h3>
        <button
          onClick={clear}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Clear
        </button>
      </div>
      {tasks.slice(0, 15).map((t) => (
        <ActivityRow key={t.id} task={t} />
      ))}
    </div>
  )
}


function ActivityRow({ task }: { task: any }) {
  const icon =
    task.state === 'running' ? (
      <Sparkles className="h-4 w-4 animate-pulse text-accent" />
    ) : task.state === 'error' ? (
      <X className="h-4 w-4 text-danger" />
    ) : (
      <Activity className="h-4 w-4 text-success" />
    )
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border/30 bg-background/80 px-3 py-2">
      <span className="mt-0.5">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{task.label}</p>
        <p className="text-xs text-muted-foreground">
          {task.state === 'error'
            ? `Error: ${task.error}`
            : task.state === 'running'
              ? 'In progress…'
              : 'Completed'}
        </p>
      </div>
    </div>
  )
}

/** Research panel for students — quick navigation shortcuts. */
function StudentResearchPanel() {
  const navigate = useTransitionNavigate()
  return (
    <div className="space-y-4">
      <h3 className="text-xs font-semibold text-muted-foreground">AI Research & Insights</h3>
      <>
        <p className="text-xs text-muted-foreground">
          Use the assistant to find internships, research companies, and get career advice.
        </p>
        <div className="space-y-2">
          <QuickLink label="Browse opportunities" target="/app/jobs" icon={Search} />
          <QuickLink label="My applications" target="/app/applications" icon={MessageSquare} />
          <QuickLink label="Career compass" target="/app/compass" icon={Sparkles} />
          <QuickLink label="AI insights" target="/app/insights" icon={Activity} />
        </div>
      </>
    </div>
  )
}

function QuickLink({ label, target, icon: Icon }: { label: string; target: string; icon: React.ComponentType<any> }) {
  const navigate = useTransitionNavigate()
  return (
    <button
      onClick={() => navigate(target)}
      className="flex w-full items-center gap-2 rounded-lg border border-border/20 bg-background/50 px-3 py-2 text-left text-xs hover:bg-muted transition-colors"
    >
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span>{label}</span>
    </button>
  )
}

/** Employer Assessments panel — quick links for assessment setup. */
function EmployerAssessmentsPanel() {
  const navigate = useTransitionNavigate()
  return (
    <div className="space-y-4">
      <h3 className="text-xs font-semibold text-muted-foreground">Assessments</h3>
      <p className="text-xs text-muted-foreground">
        Set up skill assessments for your job postings to evaluate candidates fairly.
      </p>
      <div className="space-y-2">
        <QuickLink label="All postings" target="/app/listings" icon={Briefcase} />
        <QuickLink label="Create new job" target="/app/listings/new" icon={Plus} />
        <QuickLink label="Application pipeline" target="/app/insights" icon={BarChart3} />
      </div>
      <div className="rounded-lg border border-border/20 bg-background/30 p-3">
        <p className="text-xs text-muted-foreground">
          Tip: Ask the assistant to generate an assessment question for a role, or to review
          a candidate's submission for skill alignment.
        </p>
      </div>
    </div>
  )
}

/** Employer Candidates panel — pipeline overview. */
function EmployerCandidatesPanel() {
  const navigate = useTransitionNavigate()
  return (
    <div className="space-y-4">
      <h3 className="text-xs font-semibold text-muted-foreground">Candidate Pipeline</h3>
      <p className="text-xs text-muted-foreground">
        Track applicants across your job postings and identify top talent.
      </p>
      <div className="space-y-2">
        <QuickLink label="All job postings" target="/app/listings" icon={Briefcase} />
        <QuickLink label="Create new job" target="/app/listings/new" icon={Plus} />
        <QuickLink label="Application analytics" target="/app/insights" icon={BarChart3} />
      </div>
    </div>
  )
}

/** Employer Decisions panel — hiring decisions overview. */
function EmployerDecisionsPanel() {
  const navigate = useTransitionNavigate()
  return (
    <div className="space-y-4">
      <h3 className="text-xs font-semibold text-muted-foreground">Hiring Decisions</h3>
      <p className="text-xs text-muted-foreground">
        Review your shortlisted candidates and make hiring decisions.
      </p>
      <div className="space-y-2">
        <QuickLink label="All job postings" target="/app/listings" icon={Briefcase} />
        <QuickLink label="Application analytics" target="/app/insights" icon={BarChart3} />
      </div>
      <div className="rounded-lg border border-border/20 bg-background/30 p-3">
        <p className="text-xs text-muted-foreground">
          Ask the assistant: "Who are my strongest candidates for [role]?" or
          "Summarize the top differences between my top 3 shortlisted candidates."
        </p>
      </div>
    </div>
  )
}
