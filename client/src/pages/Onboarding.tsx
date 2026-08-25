import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, FileText, Loader2, Upload } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/Button'
import { Input, Label, Textarea } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/toast'
import { useCurrentUser, useSession } from '@/lib/store'
import { profilesApi, onboardingApi, authApi } from '@/lib/api'
import { fileToDataUrl } from '@/lib/utils'
import { requiresProfileCompletion, ROLE_OPTIONS, GOAL_OPTIONS } from '@/lib/onboarding'
import type { UserType } from '@/types'

const WORK_OPTIONS = [
  { value: 'remote', label: 'Remote' },
  { value: 'onsite', label: 'On-site' },
  { value: 'hybrid', label: 'Hybrid' },
]

const STEP_LABELS = ['Who you are', 'About you', 'Location & work', 'Résumé']

export default function Onboarding() {
  const navigate = useNavigate()
  const user = useCurrentUser()
  const { toast } = useToast()

  const userId = useSession((s) => s.userId)
  if (!userId) return <Navigate to="/login" replace />
  // Already finished the required steps → go straight to the app.
  if (user && !requiresProfileCompletion(user)) return <Navigate to="/app/profile" replace />

  const [step, setStep] = useState(1)
  const [userType, setUserType] = useState<UserType | ''>(user?.user_type ?? '')
  const [name, setName] = useState(user?.full_name ?? '')
  const [goal, setGoal] = useState(user?.onboarding_goal ?? '')
  const [location, setLocation] = useState(user?.location ?? '')
  const [workType, setWorkType] = useState(user?.work_type ?? '')
  const [cvUrl, setCvUrl] = useState<string | undefined>(user?.cv_url ?? undefined)
  const [cvText, setCvText] = useState(user?.cv_text ?? '')
  const [cvFilename, setCvFilename] = useState<string | null>(user?.cv_filename ?? null)
  const [saving, setSaving] = useState(false)

  const hasResume = !!(cvUrl || cvText.trim())

  async function patchProfile(patch: Record<string, unknown>) {
    if (!user) return
    const updated = await profilesApi.update(user.id, patch)
    if (updated) useSession.getState().setProfile(updated)
  }

  function goNext() {
    setStep((s) => Math.min(4, s + 1))
  }
  function goBack() {
    setStep((s) => Math.max(1, s - 1))
  }

  async function handleNext() {
    try {
      if (step === 1) {
        if (!userType) return toast({ title: 'Pick who you are', tone: 'error' })
        await patchProfile({ user_type: userType })
        goNext()
      } else if (step === 2) {
        if (!name.trim()) return toast({ title: 'Add your name', tone: 'error' })
        if (!goal) return toast({ title: 'Choose a goal', tone: 'error' })
        await patchProfile({ full_name: name.trim(), onboarding_goal: goal })
        goNext()
      } else if (step === 3) {
        if (!location.trim()) return toast({ title: 'Add your country or location', tone: 'error' })
        if (!workType) return toast({ title: 'Choose a work preference', tone: 'error' })
        await patchProfile({ location: location.trim(), work_type: workType })
        goNext()
      }
    } catch (e) {
      toast({ title: "Couldn't save", description: e instanceof Error ? e.message : undefined, tone: 'error' })
    }
  }

  async function attachCv(file?: File | null) {
    if (!file) return
    try {
      const url = await fileToDataUrl(file)
      setCvUrl(url)
      setCvFilename(file.name)
      setCvText('')
      toast({ title: 'Attached', description: file.name, tone: 'success' })
    } catch (e) {
      toast({ title: "Couldn't read file", description: e instanceof Error ? e.message : undefined, tone: 'error' })
    }
  }

  async function finish() {
    if (!hasResume) return toast({ title: 'Add a résumé or paste your experience', tone: 'error' })
    setSaving(true)
    try {
      await patchProfile({
        user_type: userType,
        full_name: name.trim(),
        onboarding_goal: goal,
        location: location.trim(),
        work_type: workType,
      })
      await onboardingApi.saveResume(cvText.trim() || undefined, cvUrl, cvFilename ?? undefined)
      // Refresh the cached profile so the completion gate sees the résumé and
      // doesn't bounce us straight back to onboarding.
      const refreshed = await authApi.me()
      if (refreshed) useSession.getState().setProfile(refreshed)
      toast({ title: "You're all set", description: 'Finish the rest anytime from your profile.', tone: 'success' })
      navigate('/app/profile', { replace: true })
    } catch (e) {
      toast({ title: "Couldn't finish", description: e instanceof Error ? e.message : undefined, tone: 'error' })
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/40">
      <header className="mx-auto flex max-w-2xl items-center justify-between px-6 py-6">
        <Logo />
        <span className="text-xs font-medium text-muted-foreground">Step {step} of 4</span>
      </header>

      <div className="mx-auto max-w-2xl px-6">
        <div className="mb-8 flex items-center gap-2">
          {STEP_LABELS.map((label, i) => {
            const n = i + 1
            const active = n === step
            const done = n < step
            return (
              <div key={label} className="flex flex-1 items-center gap-2">
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    done ? 'bg-primary text-primary-foreground' : active ? 'bg-primary/15 text-primary ring-2 ring-primary' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {done ? <Check className="h-4 w-4" /> : n}
                </div>
                <span className={`hidden text-xs font-medium sm:block ${active ? 'text-foreground' : 'text-muted-foreground'}`}>{label}</span>
                {n < STEP_LABELS.length && <div className={`h-0.5 flex-1 rounded ${done ? 'bg-primary' : 'bg-muted'}`} />}
              </div>
            )
          })}
        </div>

        <div className="rounded-3xl border border-border bg-card p-6 sm:p-8">
          {step === 1 && (
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Welcome to Optryva</h1>
              <p className="mt-1 text-sm text-muted-foreground">First, tell us who you are. This shapes your experience.</p>
              <div className="mt-6 grid gap-3">
                {ROLE_OPTIONS.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setUserType(r.value)}
                    className={`flex flex-col items-start gap-1 rounded-2xl border p-5 text-left transition-colors ${
                      userType === r.value ? 'border-primary bg-primary/5 ring-2 ring-primary/30' : 'border-border hover:border-primary/40'
                    }`}
                  >
                    <span className="font-semibold">{r.label}</span>
                    <span className="text-sm text-muted-foreground">{r.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h1 className="text-2xl font-bold tracking-tight">A few quick details</h1>
              <p className="mt-1 text-sm text-muted-foreground">Just the basics — you can refine everything later.</p>
              <div className="mt-6 space-y-5">
                <div>
                  <Label htmlFor="name">Your name</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alex Rivera" className="mt-1.5" />
                </div>
                <div>
                  <Label>What brings you here?</Label>
                  <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
                    {GOAL_OPTIONS.map((g) => (
                      <button
                        key={g.value}
                        type="button"
                        onClick={() => setGoal(g.value)}
                        className={`rounded-xl border p-3 text-left text-sm transition-colors ${
                          goal === g.value ? 'border-primary bg-primary/5 ring-2 ring-primary/30' : 'border-border hover:border-primary/40'
                        }`}
                      >
                        <span className="block font-semibold">{g.label}</span>
                        <span className="text-xs text-muted-foreground">{g.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Where are you based?</h1>
              <p className="mt-1 text-sm text-muted-foreground">We use this to match you to relevant opportunities.</p>
              <div className="mt-6 space-y-5">
                <div>
                  <Label htmlFor="location">Country or location</Label>
                  <Input
                    id="location"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="e.g. Germany, or Berlin"
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label>Work preference</Label>
                  <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
                    {WORK_OPTIONS.map((w) => (
                      <button
                        key={w.value}
                        type="button"
                        onClick={() => setWorkType(w.value)}
                        className={`rounded-xl border p-3 text-sm font-medium transition-colors ${
                          workType === w.value ? 'border-primary bg-primary/5 ring-2 ring-primary/30' : 'border-border hover:border-primary/40'
                        }`}
                      >
                        {w.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Add your résumé</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Upload a PDF or Word file, or paste your experience. It stays editable from your profile.
              </p>
              <div className="mt-6 space-y-4">
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-input p-5 transition-colors hover:border-primary/50 hover:bg-primary/5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Upload className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Upload your résumé</p>
                    <p className="text-xs text-muted-foreground">PDF or Word</p>
                  </div>
                  <input type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => attachCv(e.target.files?.[0])} />
                </label>

                {cvFilename && cvUrl && (
                  <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/5 p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-success/15 text-success">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{cvFilename}</p>
                      <p className="text-xs text-muted-foreground">Attached</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => { setCvUrl(undefined); setCvFilename(null) }}>Remove</Button>
                  </div>
                )}

                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <div className="h-px flex-1 bg-border" />
                  or paste
                  <div className="h-px flex-1 bg-border" />
                </div>

                <Textarea
                  value={cvText}
                  onChange={(e) => { setCvText(e.target.value); if (e.target.value.trim()) { setCvUrl(undefined); setCvFilename(null) } }}
                  placeholder="Paste your experience, skills, and education…"
                  rows={6}
                />
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <Button variant="ghost" onClick={goBack} disabled={step === 1 || saving}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          {step < 4 ? (
            <Button onClick={handleNext}>
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={finish} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Finish & go to profile
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
