import { useState } from 'react'
import { ShieldCheck, ArrowRight, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/toast'
import { onboardingApi } from '@/lib/api'
import { Toggle } from './shared'

// Step 5 — simple privacy & AI choices (not a long form). All changeable later.
export function StepPrivacy({ onComplete }: { onComplete: () => void }) {
  const { toast } = useToast()
  const [profilePrivate, setProfilePrivate] = useState(false)
  const [discoverable, setDiscoverable] = useState(true)
  const [aiRecommendations, setAiRecommendations] = useState(true)
  const [evidenceReuse, setEvidenceReuse] = useState(true)
  const [universityAccess, setUniversityAccess] = useState(false)
  const [notifications, setNotifications] = useState(true)
  const [saving, setSaving] = useState(false)

  async function finish() {
    setSaving(true)
    try {
      await onboardingApi.savePrivacy({
        profile_private: profilePrivate,
        discoverable,
        ai_recommendations: aiRecommendations,
        evidence_reuse: evidenceReuse,
        university_access: universityAccess,
        notifications,
      })
      toast({ title: "You're all set ✨", description: 'Showing your first matches…', tone: 'success' })
      onComplete()
    } catch (e) {
      toast({ title: "Couldn't save", description: e instanceof Error ? e.message : 'Is the server running?', tone: 'error' })
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold tracking-tight">Privacy &amp; AI controls</h1>
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        A few simple choices. You can change any of these anytime from your profile.
      </p>

      <div className="space-y-2.5">
        <Toggle label="Keep my profile private" description="Only you can see your profile and matches." checked={profilePrivate} onChange={setProfilePrivate} />
        <Toggle label="Make my profile discoverable to verified employers" description="Verified employers can find you for relevant roles." checked={discoverable && !profilePrivate} onChange={(v) => { setDiscoverable(v); if (v) setProfilePrivate(false) }} />
        <Toggle label="Let Optryva recommend my profile for opportunities" description="We'll surface you for roles that fit." checked={aiRecommendations} onChange={setAiRecommendations} />
        <Toggle label="Allow approved evidence to be reused across applications" description="Use the same evidence for multiple applications." checked={evidenceReuse} onChange={setEvidenceReuse} />
        <Toggle label="Allow my university to view my career progress" description="Your career office can see your progress (optional)." checked={universityAccess} onChange={setUniversityAccess} />
        <Toggle label="Receive opportunity and application notifications" description="Get updates on matches, deadlines, and applications." checked={notifications} onChange={setNotifications} />
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-lg bg-primary/5 p-3 text-xs text-muted-foreground">
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <span>AI extracts and explains; you confirm; humans decide. Nothing is shared without your choices above.</span>
      </div>

      <div className="mt-6 flex justify-end">
        <Button onClick={finish} loading={saving} className="gap-1.5">
          See my matches <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
