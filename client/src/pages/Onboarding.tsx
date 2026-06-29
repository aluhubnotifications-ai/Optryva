import { useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { FileText, Upload, Briefcase, Sparkles, Check, ArrowRight, ArrowLeft, X, Plus, MapPin } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/Button'
import { Input, Label, Textarea } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/toast'
import { useCurrentUser, useSession } from '@/lib/store'
import { useMatchRun } from '@/lib/matchRun'
import { needsOnboarding } from '@/lib/matchReady'
import { profilesApi } from '@/lib/api'
import { cn, fileToDataUrl } from '@/lib/utils'
import type { ListingType, Profile as ProfileT } from '@/types'

const ROLES = ['Software Engineering', 'Data Science', 'Product Management', 'Marketing', 'Operations', 'Finance', 'Design', 'Consulting']
const INDUSTRIES = ['Technology', 'Finance', 'Healthcare', 'Agriculture', 'Education', 'E-commerce', 'Consulting', 'Nonprofit']
const LISTING_TYPES: ListingType[] = ['Internship', 'Full-time', 'Part-time', 'Fellowship']
const COUNTRIES = ['Rwanda', 'Kenya', 'Nigeria', 'Ghana', 'Uganda', 'Tanzania', 'Ethiopia', 'South Africa', 'Egypt', 'Senegal', 'Morocco', "Côte d'Ivoire"]

export default function Onboarding() {
  const navigate = useNavigate()
  const user = useCurrentUser()
  const userId = useSession((s) => s.userId)
  const { toast } = useToast()
  const cvRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<0 | 1>(0)
  const [saving, setSaving] = useState(false)

  // Résumé — either an attached file (data URL) or pasted text. Either makes the
  // student match-ready.
  const [cvFile, setCvFile] = useState<{ filename: string; url: string } | null>(
    user?.cv_filename && user?.cv_url ? { filename: user.cv_filename, url: user.cv_url } : null,
  )
  const [cvText, setCvText] = useState(user?.cv_text ?? '')

  // Preferences.
  const [roles, setRoles] = useState<string[]>(user?.desired_roles ?? [])
  const [industries, setIndustries] = useState<string[]>(user?.preferred_industries ?? [])
  const [prefTypes, setPrefTypes] = useState<string[]>(user?.pref_listing_types ?? [])
  const [prefCountries, setPrefCountries] = useState<string[]>(user?.pref_countries ?? [])
  const [skills, setSkills] = useState<string[]>(user?.skills ?? [])
  const [skillInput, setSkillInput] = useState('')
  const [countryInput, setCountryInput] = useState('')

  // Not logged in → login. Companies / already-complete students don't belong
  // here — send them straight into the app so this is never a dead end.
  if (!userId) return <Navigate to="/login" replace />
  if (user && !needsOnboarding(user)) return <Navigate to="/app" replace />

  const hasResume = !!(cvFile || cvText.trim())
  const hasPreferences =
    prefTypes.length > 0 || prefCountries.length > 0 || skills.length > 0 || roles.length > 0 || industries.length > 0

  function toggle(list: string[], set: (v: string[]) => void, v: string) {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  }

  async function attachCv(file?: File | null) {
    if (!file) return
    try {
      const url = await fileToDataUrl(file)
      setCvFile({ filename: file.name, url })
      setCvText('') // a file supersedes pasted text
    } catch (e) {
      toast({ title: 'Could not read that file', description: e instanceof Error ? e.message : undefined, tone: 'error' })
    }
  }

  function addSkill() {
    const s = skillInput.trim()
    if (s && !skills.includes(s)) setSkills([...skills, s])
    setSkillInput('')
  }
  function addCountry() {
    const c = countryInput.trim()
    if (c && !prefCountries.includes(c)) setPrefCountries([...prefCountries, c])
    setCountryInput('')
  }

  async function finish() {
    if (!userId || !hasResume || !hasPreferences) return
    setSaving(true)
    const patch: Partial<ProfileT> = {
      desired_roles: roles,
      preferred_industries: industries,
      pref_listing_types: prefTypes as ListingType[],
      pref_countries: prefCountries,
      skills,
      // Keep the legacy flags in sync (empty = open to everything).
      open_to_internship: prefTypes.length === 0 || prefTypes.includes('Internship'),
      open_to_fulltime: prefTypes.length === 0 || prefTypes.some((t) => t !== 'Internship'),
    }
    if (cvFile) {
      patch.cv_filename = cvFile.filename
      patch.cv_url = cvFile.url
      patch.cv_uploaded_at = new Date().toISOString()
    } else if (cvText.trim()) {
      patch.cv_text = cvText.trim()
    }
    try {
      const updated = await profilesApi.update(userId, patch)
      if (updated) useSession.getState().setProfile(updated)
      // The server extracts text from an uploaded file into cv_text. If that came
      // back empty (scanned PDF, legacy .doc, extraction off), the matching gate
      // won't pass — so don't drop the user into a dead "not ready" state. Keep
      // them on the résumé step and ask for a paste instead. (The paste path
      // always sets cv_text, so this only ever fires for a failed file upload.)
      if (!(updated?.cv_text ?? '').trim()) {
        setSaving(false)
        setCvFile(null)
        setStep(0)
        toast({
          title: "We couldn't read that file",
          description: 'Paste your résumé text instead so we can match you to roles.',
          tone: 'error',
        })
        return
      }
      useMatchRun.getState().invalidate(userId) // fresh profile → run matching next visit
      toast({ title: "You're all set ✨", description: 'AI will match you to your best-fit roles.', tone: 'success' })
      navigate('/app')
    } catch (e) {
      toast({ title: 'Could not save', description: e instanceof Error ? e.message : 'Is the server running?', tone: 'error' })
      setSaving(false)
    }
  }

  return (
    <div className="mesh-bg min-h-screen px-4 py-10">
      <div className="mx-auto w-full max-w-xl">
        <div className="mb-6 flex items-center justify-center gap-2">
          <Logo className="h-9 w-9" />
          <span className="text-xl font-bold tracking-tight">Optryva</span>
        </div>

        {/* Stepper */}
        <div className="mb-6 flex items-center gap-3">
          <StepDot n={1} active={step === 0} done={step > 0} label="Your résumé" />
          <div className="h-px flex-1 bg-border" />
          <StepDot n={2} active={step === 1} done={false} label="Preferences" />
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
          {step === 0 ? (
            <>
              <div className="mb-1 flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                <h1 className="text-lg font-bold tracking-tight">Add your résumé</h1>
              </div>
              <p className="mb-5 text-sm text-muted-foreground">
                This is the #1 signal our AI uses to find your best-fit roles. Upload a file or paste it in — we need one to match you.
              </p>

              <input ref={cvRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => attachCv(e.target.files?.[0])} />
              {cvFile ? (
                <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/5 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-success/15 text-success">
                    <Check className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{cvFile.filename}</p>
                    <p className="text-xs text-muted-foreground">Attached — you're good to go</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setCvFile(null)}>Remove</Button>
                </div>
              ) : (
                <button onClick={() => cvRef.current?.click()} className="flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-input p-5 text-left transition-colors hover:border-primary/50 hover:bg-primary/5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Upload className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Upload your CV</p>
                    <p className="text-xs text-muted-foreground">PDF or Word</p>
                  </div>
                </button>
              )}

              {!cvFile && (
                <div className="mt-4">
                  <Label>…or paste your résumé</Label>
                  <Textarea
                    rows={6}
                    value={cvText}
                    onChange={(e) => setCvText(e.target.value)}
                    placeholder="Paste your experience, education, projects, and skills…"
                  />
                </div>
              )}

              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" /> Your résumé stays private and only powers your matches.
              </p>

              <div className="mt-6 flex justify-end">
                <Button onClick={() => setStep(1)} disabled={!hasResume} className="gap-1.5">
                  Continue <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="mb-1 flex items-center gap-2">
                <Briefcase className="h-5 w-5 text-primary" />
                <h1 className="text-lg font-bold tracking-tight">What are you looking for?</h1>
              </div>
              <p className="mb-5 text-sm text-muted-foreground">
                Pick at least one so we only match roles you actually want. You can fine-tune all of this later in your profile.
              </p>

              <Label>Roles I'm interested in</Label>
              <ChipGroup options={ROLES} selected={roles} onToggle={(v) => toggle(roles, setRoles, v)} />

              <Label className="mt-4">Industries</Label>
              <ChipGroup options={INDUSTRIES} selected={industries} onToggle={(v) => toggle(industries, setIndustries, v)} />

              <Label className="mt-4">Opportunity types I want</Label>
              <ChipGroup options={LISTING_TYPES} selected={prefTypes} onToggle={(v) => toggle(prefTypes, setPrefTypes, v)} />

              <Label className="mt-4">Countries I'd work in</Label>
              <p className="mb-1.5 text-xs text-muted-foreground">Remote roles always count. Leave empty for anywhere.</p>
              <ChipGroup
                options={Array.from(new Set([...COUNTRIES, ...prefCountries]))}
                selected={prefCountries}
                onToggle={(v) => toggle(prefCountries, setPrefCountries, v)}
              />
              <form onSubmit={(e) => { e.preventDefault(); addCountry() }} className="mt-2 flex gap-2">
                <div className="relative max-w-xs flex-1">
                  <MapPin className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={countryInput} onChange={(e) => setCountryInput(e.target.value)} placeholder="Add another country…" className="pl-8" />
                </div>
                <Button type="submit" variant="outline" size="icon" aria-label="Add country"><Plus className="h-4 w-4" /></Button>
              </form>

              <Label className="mt-4">Skills</Label>
              <div className="flex flex-wrap gap-1.5">
                {skills.map((s) => (
                  <span key={s} className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2.5 py-1 text-xs font-medium text-primary">
                    {s}<button type="button" onClick={() => setSkills(skills.filter((x) => x !== s))}><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
              <form onSubmit={(e) => { e.preventDefault(); addSkill() }} className="mt-2 flex gap-2">
                <Input value={skillInput} onChange={(e) => setSkillInput(e.target.value)} placeholder="Add a skill…" className="max-w-xs" />
                <Button type="submit" variant="outline" size="icon"><Plus className="h-4 w-4" /></Button>
              </form>

              <div className="mt-6 flex items-center justify-between">
                <Button variant="ghost" onClick={() => setStep(0)} className="gap-1.5">
                  <ArrowLeft className="h-4 w-4" /> Back
                </Button>
                <Button onClick={finish} loading={saving} disabled={!hasPreferences} className="gap-1.5">
                  <Sparkles className="h-4 w-4" /> Finish & match me
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function StepDot({ n, active, done, label }: { n: number; active: boolean; done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold',
          done ? 'bg-success text-white' : active ? 'bg-primary text-white' : 'bg-muted text-muted-foreground',
        )}
      >
        {done ? <Check className="h-4 w-4" /> : n}
      </div>
      <span className={cn('text-sm font-medium', active || done ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
    </div>
  )
}

function ChipGroup({ options, selected, onToggle }: { options: string[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o)
        return (
          <button
            key={o}
            type="button"
            onClick={() => onToggle(o)}
            className={cn('rounded-full border px-3 py-1.5 text-sm transition-colors', on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}
          >
            {o}
          </button>
        )
      })}
    </div>
  )
}
