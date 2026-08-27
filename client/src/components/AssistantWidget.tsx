import { useState, useEffect, useCallback } from 'react'
import { MessageCircle, X, Sparkles } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/Button'
import { useCurrentUser } from '@/lib/store'
import { profilesApi, jobsApi } from '@/lib/api'
import { AssistantChat } from '@/components/AssistantChat'
import type { AssistantAction } from '@/lib/api'

const STORAGE_KEY = 'optryva-assistant-session'

export function AssistantWidget() {
  const [isOpen, setIsOpen] = useState(false)
  const { toast } = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const user = useCurrentUser()

  const [sessionId, setSessionId] = useState<string | undefined>(
    () => (typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) ?? undefined : undefined),
  )

  // Persist session ID so the conversation survives page navigations.
  useEffect(() => {
    if (sessionId) {
      try { localStorage.setItem(STORAGE_KEY, sessionId) } catch { /* ignore */ }
    }
  }, [sessionId])

  // Infer the assistant mode from the current user's role.
  const mode = user?.user_type === 'school' ? 'university' : user?.user_type === 'company' ? 'employer' : 'student'

  // Page context — tells the assistant which screen the user is on.
  const pageContext = `${location.pathname}${location.search ?? ''}`

  const handleAction = useCallback(
    async (action: AssistantAction) => {
      const detail = action.data

       switch (action.type) {
         case 'inject_data':
           await handleInjectData(action, detail)
           break
         case 'create_job':
           await handleCreateJob(detail)
           break
         case 'update_profile':
           await handleUpdateProfile(detail)
           break
         case 'navigate':
           navigate(action.target.startsWith('/') ? action.target : `/${action.target}`, { replace: true })
           // Keep widget open so user can continue the conversation
           break
        case 'add_evidence':
          window.dispatchEvent(new CustomEvent('optryva:add_evidence', { detail }))
          toast({ title: 'Evidence added', description: (detail.title as string) ?? 'Verified evidence injected.', tone: 'success' })
          break
      }
    },
    [navigate, toast],
  )

  async function handleInjectData(action: AssistantAction, detail: Record<string, unknown>) {
    if (action.target === 'profile_skills' && user?.id) {
      const skills = detail.skills
        ? Array.isArray(detail.skills)
          ? detail.skills as string[]
          : [String(detail.skills)]
        : []
      if (skills.length > 0) {
        try {
          await profilesApi.updateSkills(user.id, skills)
          toast({ title: 'Skills updated', description: `${skills.length} skill(s) added to your profile.`, tone: 'success' })
        } catch (e) {
          toast({ title: 'Update failed', description: 'Could not update skills. Check your connection.', tone: 'error' })
        }
      }
    }

    if (action.target === 'job_editor') {
      window.dispatchEvent(new CustomEvent('optryva:inject_job', { detail }))
      toast({ title: 'Job data injected', description: 'The Job Editor form has been auto-filled.', tone: 'success' })
    }

    if (action.target === 'resume') {
      window.dispatchEvent(new CustomEvent('optryva:inject_resume', { detail }))
      toast({ title: 'Resume data injected', description: 'Resume data has been applied.', tone: 'success' })
    }

    if (action.target === 'shortlist') {
      window.dispatchEvent(new CustomEvent('optryva:inject_shortlist', { detail }))
      toast({ title: 'Shortlist updated', description: 'Shortlist items have been added.', tone: 'success' })
    }
  }

  async function handleUpdateProfile(detail: Record<string, unknown>) {
    if (!user?.id) return
    const patch: Record<string, unknown> = {}
    for (const key of ['full_name', 'school', 'major', 'linkedin', 'github', 'twitter', 'website', 'skills']) {
      if (key in detail) patch[key] = detail[key]
    }
    if (Object.keys(patch).length === 0) return
    try {
      await profilesApi.update(user.id, patch as any)
      toast({ title: 'Profile updated', description: 'Your profile has been updated.', tone: 'success' })
    } catch (e) {
      toast({ title: 'Update failed', description: 'Could not update profile.', tone: 'error' })
    }
  }

  async function handleCreateJob(detail: Record<string, unknown>) {
    if (!user?.id) return
    const job: any = {
      company_id: user.id,
      title: detail.title ?? 'Untitled Job',
      description: detail.description ?? '',
      location: detail.location ?? '',
      listing_type: detail.listing_type ?? detail.type ?? 'Internship',
      type: detail.listing_type ?? detail.type ?? 'Internship',
      tags: Array.isArray(detail.tags) ? detail.tags : detail.tags ? JSON.stringify(detail.tags) : '[]',
      qualifications: Array.isArray(detail.qualifications) ? detail.qualifications : detail.qualifications ? JSON.stringify(detail.qualifications) : '[]',
      responsibilities: Array.isArray(detail.responsibilities) ? detail.responsibilities : detail.responsibilities ? JSON.stringify(detail.responsibilities) : '[]',
      benefits: Array.isArray(detail.benefits) ? detail.benefits : detail.benefits ? JSON.stringify(detail.benefits) : '[]',
      pay: detail.pay ?? '',
      status: 'draft',
    }
    try {
      const created = await jobsApi.create(job as any)
      toast({ title: 'Job created', description: `${created.title ?? 'Job'} created as draft.`, tone: 'success' })
      navigate('/app/listings', { replace: true })
    } catch (e: any) {
      toast({ title: 'Job creation failed', description: e?.message ?? 'Try editing the form manually.', tone: 'error' })
    }
  }

  return (
    <>
      <div className="fixed bottom-6 right-6 z-50">
        {isOpen ? (
          <div className="flex flex-col w-96 h-[600px] bg-background border border-border rounded-2xl shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-primary to-accent text-white p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                <span className="font-semibold text-sm">Optryva Assistant</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsOpen(false)}
                className="h-6 w-6 rounded-full p-0 text-white hover:bg-white/20"
                aria-label="Close assistant"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
            <AssistantChat
              mode={mode}
              sessionId={sessionId}
              pageContext={pageContext}
              onAction={handleAction}
              onSessionId={setSessionId}
            />
          </div>
        ) : (
          <button
            onClick={() => setIsOpen(true)}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-r from-primary to-accent text-white shadow-lg hover:shadow-xl transition-shadow"
            aria-label="Open Optryva Assistant"
          >
            <MessageCircle className="h-6 w-6" />
          </button>
        )}
      </div>
    </>
  )
}
