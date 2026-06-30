import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { GraduationCap, Building2, School } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/Button'
import { Input, Label } from '@/components/ui/primitives'
import { useSession } from '@/lib/store'
import { authApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { UserType } from '@/types'

const ERRORS: Record<string, string> = {
  email_taken: 'An account with that email already exists.',
  invalid: 'Please fill in your name, a valid email, and a password (6+ chars).',
}

// Who's signing up — drives user_type on the account so companies and schools
// get their own experience (post roles / manage students) instead of the
// student flow. The server defaults to 'student' if none is sent.
const ROLES: { value: UserType; label: string; hint: string; icon: typeof GraduationCap }[] = [
  { value: 'student', label: 'Student', hint: 'Find roles', icon: GraduationCap },
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
      // Only students go through the résumé/preferences onboarding; companies and
      // schools land straight in the app.
      navigate(form.user_type === 'student' ? '/onboarding' : '/app')
    } catch (err) {
      const code = err instanceof Error ? err.message : 'register_failed'
      setError(ERRORS[code] ?? 'Could not create your account. Is the server running?')
    } finally {
      setLoading(false)
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
          <h1 className="text-xl font-bold tracking-tight">Create your account</h1>
          <p className="mb-5 mt-1 text-sm text-muted-foreground">Free to join, from anywhere.</p>
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
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={nameField.placeholder}
              />
            </div>
            <div>
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="you@example.com"
              />
            </div>
            <div>
              <Label>Password</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                minLength={6}
              />
            </div>
            {error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Creating…' : 'Create account'}
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
