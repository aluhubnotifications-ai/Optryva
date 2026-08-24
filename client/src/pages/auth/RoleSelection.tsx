import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { GraduationCap, Building2, School, ArrowRight, Loader2 } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/Button'
import { useSession } from '@/lib/store'
import { authApi } from '@/lib/api'
import { cn } from '@/lib/utils'

const ROLES = [
  {
    value: 'student' as const,
    label: 'Student / Candidate',
    description: 'Find opportunities, build résumé profiles, show evidence, and apply.',
    icon: GraduationCap,
  },
  {
    value: 'company' as const,
    label: 'Employer',
    description: 'Post roles, create assessments, and review evidence-backed candidates.',
    icon: Building2,
  },
  {
    value: 'school' as const,
    label: 'University / Career Office',
    description: 'Support students, publish opportunities, and measure outcomes.',
    icon: School,
  },
] as const

export default function RoleSelection() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const returnTo = searchParams.get('returnTo') ?? '/app'
  const login = useSession((s) => s.login)
  const [selected, setSelected] = useState<'student' | 'company' | 'school'>('student')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Auto-select if returnTo hints at a role
    if (returnTo.startsWith('/app/listings') || returnTo.startsWith('/app/applicants')) {
      setSelected('company')
    } else if (returnTo.startsWith('/app/admin') || returnTo.includes('school')) {
      setSelected('school')
    }
  }, [returnTo])

  async function continueWithRole() {
    setError(null)
    setLoading(true)
    try {
      const { accessToken, user } = await authApi.completeOnboarding({
        user_type: selected,
        returnTo,
      })
      login(user, accessToken)
      navigate(returnTo, { replace: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not save role. Please try again.'
      setError(msg)
      setLoading(false)
    }
  }

  return (
    <div className="mesh-bg flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2">
          <Logo className="h-10 w-10" />
          <span className="text-2xl font-bold tracking-tight">Optryva</span>
        </Link>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold tracking-tight">How will you use Optryva?</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose the role that fits you best. You can add another role later from your profile.
            </p>
          </div>

          {error && (
            <div className="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {error}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Select your role">
            {ROLES.map((role) => {
              const isSelected = selected === role.value
              const Icon = role.icon
              return (
                <button
                  key={role.value}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => setSelected(role.value)}
                  className={cn(
                    'relative flex flex-col items-center gap-3 rounded-2xl border p-5 text-center transition-all',
                    isSelected
                      ? 'border-primary bg-primary/5 shadow-[0_0_0_2px_rgba(var(--primary),0.2)]'
                      : 'border-border hover:border-primary/40 hover:bg-muted/30',
                  )}
                >
                  <div className={cn(
                    'flex h-12 w-12 items-center justify-center rounded-xl',
                    isSelected ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                  )}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className={cn('font-semibold', isSelected ? 'text-foreground' : 'text-muted-foreground')}>
                      {role.label}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">{role.description}</p>
                  </div>
                  {isSelected && (
                    <div className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <ArrowRight className="h-4 w-4" />
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          <Button
            className="mt-6 w-full"
            onClick={continueWithRole}
            disabled={loading}
            loading={loading}
          >
            Continue <ArrowRight className="h-4 w-4" />
          </Button>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            By continuing, you agree to our{' '}
            <Link to="/terms" className="underline hover:text-primary">Terms of Service</Link>{' '}
            and{' '}
            <Link to="/privacy" className="underline hover:text-primary">Privacy Policy</Link>
            .
          </p>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}