import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles,
  Activity,
  Search,
  ChevronRight,
  ChevronLeft,
  MessageSquare,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAiActivity } from '@/lib/aiActivity'
import { useCurrentUser } from '@/lib/store'
import { useToast } from '@/components/ui/toast'
import { useTransitionNavigate } from '@/lib/useTransitionNavigate'
import { AssistantChat } from '@/components/AssistantChat'
import type { AssistantAction } from '@/lib/api'

type TabKey = 'assistant' | 'activity' | 'research'

interface RightSidebarProps {
  mode: 'student' | 'employer' | 'university'
}

const TABS: Record<TabKey, { label: string; icon: React.ComponentType<any> }> = {
  assistant: { label: 'Assistant', icon: MessageSquare },
  activity: { label: 'Activity', icon: Activity },
  research: { label: 'Research', icon: Search },
}

const STORAGE_KEY = 'optryva-sidebar-open'

export function RightSidebar({ mode }: RightSidebarProps) {
  const [open, setOpen] = useState(() => {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(STORAGE_KEY) !== 'closed'
    }
    return true
  })
  const [activeTab, setActiveTab] = useState<TabKey>('assistant')
  const { toast } = useToast()
  const navigate = useTransitionNavigate()
  const currentUser = useCurrentUser()

  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, open ? 'open' : 'closed')
    }
  }, [open])

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
                toast({ title: 'Update failed', description: 'Could not update skills.', tone: 'error' })
              }
            }
          }
          if (action.target === 'job_editor') {
            window.dispatchEvent(new CustomEvent('optryva:inject_job', { detail }))
            toast({ title: 'Job data injected', description: 'Job Editor form has been auto-filled.', tone: 'success' })
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
              toast({ title: 'Update failed', description: 'Could not update profile.', tone: 'error' })
            }
          }
          break
        case 'navigate':
          navigate(action.target.startsWith('/') ? action.target : `/${action.target}`, { replace: true })
          break
        case 'add_evidence':
          window.dispatchEvent(new CustomEvent('optryva:add_evidence', { detail }))
          toast({ title: 'Evidence added', description: 'Verified evidence injected.', tone: 'success' })
          break
      }
    },
    [currentUser?.id, navigate, toast],
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
      setActiveTab('activity')
    } catch (e: any) {
      toast({ title: 'Job creation failed', description: e?.message ?? 'Try the editor instead.', tone: 'error' })
    }
  }

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex">
      {/* Collapse toggle */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="flex w-1.5 cursor-pointer items-center justify-center border-l border-border hover:bg-muted"
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
            className="flex w-[380px] flex-col border-l border-border bg-card/30 backdrop-blur-md"
          >
            {/* Tab navigation */}
            <div className="flex items-center justify-between border-b border-border px-3">
              <div className="flex gap-1">
                {(Object.keys(TABS) as TabKey[]).map((key) => {
                  const Icon = TABS[key].icon
                  const active = activeTab === key
                  return (
                    <button
                      key={key}
                      onClick={() => setActiveTab(key)}
                      className={cn(
                        'flex items-center gap-2 rounded-t-lg px-3 py-2 text-xs font-medium transition-colors',
                        active
                          ? 'border-b-2 border-primary text-primary'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                      aria-label={TABS[key].label}
                    >
                      <Icon className="h-3 w-3" />
                      {TABS[key].label}
                    </button>
                  )
                })}
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-full p-1 text-muted-foreground hover:bg-muted"
                aria-label="Close sidebar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-hidden">
              <TabPanel active={activeTab === 'assistant'}>
                <AssistantChat
                  mode={mode}
                  pageContext={undefined}
                  onAction={handleAction}
                />
              </TabPanel>

              <TabPanel active={activeTab === 'activity'}>
                <div className="h-full overflow-y-auto p-4">
                  <ActivityPanelCompact />
                </div>
              </TabPanel>

              <TabPanel active={activeTab === 'research'}>
                <div className="h-full overflow-y-auto p-4">
                  <ResearchPanel mode={mode} />
                </div>
              </TabPanel>
            </div>

            {/* Mini status bar */}
            <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                AI ready
              </span>
              <span className="font-mono text-xs text-muted-foreground/60">{mode} mode</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Collapsed state — icon strip */}
      {!open && (
        <div className="flex w-12 flex-col items-center gap-2 border-l border-border bg-card/30 py-3">
          {(Object.keys(TABS) as TabKey[]).map((key) => {
            const Icon = TABS[key].icon
            return (
              <button
                key={key}
                onClick={() => {
                  setOpen(true)
                  setActiveTab(key)
                }}
                className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                title={TABS[key].label}
                aria-label={TABS[key].label}
              >
                <Icon className="h-5 w-5" />
              </button>
            )
          })}
          <div className="mt-2 border-t border-border pt-2">
            <button
              onClick={() => setOpen(true)}
              className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
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
  return (
    <div className={cn('h-full', active ? 'block' : 'hidden')}>
      {children}
    </div>
  )
}

/** Compact AI activity panel for the sidebar. */
function ActivityPanelCompact() {
  const { tasks, clear } = useAiActivity()
  const running = tasks.filter((t) => t.state === 'running')

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <Activity className="h-6 w-6 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No AI activity yet. Everything will show up here as the assistant works.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground">Recent activity</h3>
        {tasks.length > 0 && (
          <button
            onClick={clear}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
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
    <div className="flex items-start gap-2.5 rounded-lg border border-border/20 bg-background/30 px-3 py-2">
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

/** Compact research panel — quick suggestions + navigate to full research page. */
function ResearchPanel({ mode }: { mode: string }) {
  return (
    <div className="space-y-4">
      <h3 className="text-xs font-semibold text-muted-foreground">AI Research</h3>
      <p className="text-xs text-muted-foreground">Find internships, research companies, and get career advice.</p>
      {mode === 'student' && (
        <p className="text-xs text-muted-foreground">
          Visit <span className="font-medium">/app/research</span> for full search + AI-powered opportunity discovery.
        </p>
      )}
      {mode !== 'student' && (
        <p className="text-xs text-muted-foreground">
          Visit <span className="font-medium">/app/insights</span> for your smart shortlist and applicant pipeline.
        </p>
      )}
    </div>
  )
}