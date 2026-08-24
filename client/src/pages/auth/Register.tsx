import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2, Mail, Lock, User, Building2, School, AlertCircle } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/Button'
import { Input, Label } from '@/components/ui/primitives'
import { Spinner } from '@/components/ui/Spinner'
import { useSession } from '@/lib/store'
import { authApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { UserType } from '@/types'

const ERRORS: Record<string, string> = {
  email_taken: 'An account with that email already exists.',
  invalid: 'Please fill in your name, a valid email, and a password (6+ chars).',
}

const ROLES: { value: UserType; label: string; hint: string; icon: typeof User }[] = [
  { value: 'student', label: 'Student', hint: 'Find roles', icon: User },
  { value: 'company', label: 'Company', hint: 'Hire talent', icon: Building2 },
  { value: 'school', label: 'School', hint: 'Manage students', icon: School },
]

const NAME_FIELD: Record<UserType, { label: string; placeholder: string }> = {
  student: { label: 'Full name', placeholder: 'Your name' },
  company: { label: 'Company name', placeholder: 'e.g. Acme Inc.' },
  school: { label: 'School / organization name', placeholder: 'e.g. University of Rwanda' },
}

export default function Register() {
  const navigate = useNavigate()
  const login = useSession((s) => s.login)
  const [form, setForm] = useState<{ name: string; email: string; password: string; user_type: UserType }>({
    name: '',
    email: '',
    password: '',
    user_type: 'student',
  })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  const nameField = NAME_FIELD[form.user_type]

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { accessToken, user } = await authApi.register({
        full_name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        user_type: form.user_type,
      })
      login(user, accessToken)
      // After email/password signup, go to role selection to confirm/change role
      navigate('/role-selection')
    } catch (err) {
      const code = err instanceof Error ? err.message : 'register_failed'
      setError(ERRORS[code] ?? 'Could not create your account. Is the server running?')
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogleSignup() {
    setError(null)
    setGoogleLoading(true)
    try {
      const { url } = await authApi.googleAuthUrl('/app')
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-up failed')
      setGoogleLoading(false)
    }
  }

  return (
    <div className="mesh-bg flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2">
          <Logo className="h-10 w-10" />
          <span className="text-2xl font-bold tracking-tight">Optryva</span>
        </Link>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold tracking-tight">Create your account</h1>
            <p className="mt-1 text-sm text-muted-foreground">Free to join, from anywhere.</p>
          </div>

          {/* Google Sign-Up — Primary method per spec */}
          <Button
            type="button"
            variant="outline"
            className="w-full gap-2"
            onClick={handleGoogleSignup}
            disabled={googleLoading}
          >
            {googleLoading ? (
              <>
                <Spinner className="h-4 w-4" />
                <span>Continuing with Google…</span>
              </>
            ) : (
              <>
                <svg className="h-5 w-5" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="currentColor"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                <span>Continue with Google</span>
              </>
            )}
          </Button>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or sign up with email</span>
            </div>
          </div>

          {/* Email/Password Form — Secondary method */}
          <form onSubmit={submit} className="space-y-4">
            {/* Who are you? */}
            <div>
              <Label>I'm signing up as a…</Label>
              <div className="grid grid-cols-3 gap-2">
                {ROLES.map((r) => {
                  const on = form.user_type === r.value
                  return (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => setForm({ ...form, user_type: r.value })}
                      aria-pressed={on}
                      className={cn(
                        'flex flex-col items-center gap-1 rounded-xl border p-3 text-center transition-colors',
                        on
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                      )}
                    >
                      <r.icon className="h-5 w-5" />
                      <span className="text-sm font-medium">{r.label}</span>
                      <span className="text-[11px] text-muted-foreground">{r.hint}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <Label>{nameField.label}</Label>
              <div className="relative mt-1">
                <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={nameField.placeholder}
                  className="pl-9"
                />
              </div>
            </div>
            <div>
              <Label>Email</Label>
              <div className="relative mt-1">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="you@example.com"
                  className="pl-9"
                />
              </div>
            </div>
            <div>
              <Label>Password</Label>
              <div className="relative mt-1">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required
                  minLength={6}
                  className="pl-9"
                />
              </div>
            </div>
            {error && (
              <div className={cn('flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive')}>
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Spinner className="h-4 w-4" /> Creating…
                </>
              ) : (
                'Create account'
              )}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link to="/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}