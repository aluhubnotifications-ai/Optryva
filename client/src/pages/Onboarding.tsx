import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/toast'
import { useCurrentUser, useSession } from '@/lib/store'
import { useMatchRun } from '@/lib/matchRun'
import { authApi, onboardingApi } from '@/lib/api'
import { Stepper } from './onboarding/shared'
import { StepDirection } from './onboarding/StepDirection'
import { StepResume } from './onboarding/StepResume'
import { StepEvidence } from './onboarding/StepEvidence'
import { StepPreferences } from './onboarding/StepPreferences'
import { StepPrivacy } from './onboarding/StepPrivacy'

const STEP_NAMES = ['Career direction', 'Résumé', 'Evidence', 'Preferences', 'Privacy & AI']

export default function Onboarding() {
  const navigate = useNavigate()
  const user = useCurrentUser()
  const userId = useSession((s) => s.userId)
  const { toast } = useToast()
  const invalidate = useMatchRun((s) => s.invalidate)

  const [step, setStep] = useState(1)
  const [loaded, setLoaded] = useState(false)
  const [direction, setDirection] = useState('')
  const [custom, setCustom] = useState('')

  // Not logged in → login. Only students onboard here; companies/schools skip.
  if (!userId) return <Navigate to="/login" replace />
  if (user && user.user_type !== 'student') return <Navigate to="/app" replace />

  // Resume progress so the user can leave and pick up where they left off.
  useEffect(() => {
    let active = true
    onboardingApi
      .getProgress()
      .then((p: any) => {
        if (!active) return
        const completed = Number(p?.completed_steps ?? 0)
        if (completed >= 5) {
          navigate('/app', { replace: true })
          return
        }
        const current = Math.min(5, Math.max(1, Number(p?.current_step ?? 1)))
        setStep(current)
        setLoaded(true)
      })
      .catch(() => {
        if (active) setLoaded(true)
      })
    return () => {
      active = false
    }
  }, [navigate])

  // Autosave the current step position (fire-and-forget).
  function markStep(n: number) {
    onboardingApi
      .saveProgress({ current_step: n })
      .catch(() => undefined)
  }

  function goTo(next: number) {
    setStep(next)
    markStep(next)
  }

  async function finishOnboarding() {
    try {
      const fresh = await authApi.me()
      if (fresh) useSession.getState().setProfile(fresh)
    } catch {
      /* ignore — navigation still proceeds */
    }
    if (userId) invalidate(userId)
    navigate('/app', { replace: true })
  }

  if (!loaded) {
    return (
      <div className="mesh-bg flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  const resumeName = custom.trim() || direction

  return (
    <div className="mesh-bg min-h-screen px-4 py-10">
      <div className="mx-auto w-full max-w-xl">
        <div className="mb-6 flex items-center justify-center gap-2">
          <Logo className="h-9 w-9" />
          <span className="text-xl font-bold tracking-tight">Optryva</span>
        </div>

        <Stepper steps={STEP_NAMES} current={step} />

        <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
          {step === 1 && (
            <StepDirection
              direction={direction}
              setDirection={setDirection}
              custom={custom}
              setCustom={setCustom}
              onNext={() => goTo(2)}
            />
          )}

          {step === 2 && (
            <StepResume
              initial={{
                cv_text: user?.cv_text,
                cv_filename: user?.cv_filename,
                cv_url: user?.cv_url,
              }}
              onNext={() => goTo(3)}
            />
          )}

          {step === 3 && (
            <StepEvidence
              onNext={() => goTo(4)}
              onSkip={() => {
                onboardingApi.skipStep(3).catch(() => undefined)
                goTo(4)
              }}
            />
          )}

          {step === 4 && (
            <StepPreferences resumeName={resumeName} onNext={() => goTo(5)} />
          )}

          {step === 5 && <StepPrivacy onComplete={finishOnboarding} />}
        </div>

        {/* Back navigation (not on the first step). */}
        {step > 1 && (
          <div className="mt-4 flex justify-center">
            <Button variant="ghost" className="gap-1.5 text-muted-foreground" onClick={() => goTo(step - 1)}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
