import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/Button'
import { Input, Label } from '@/components/ui/primitives'
import { useSession } from '@/lib/store'
import { authApi } from '@/lib/api'

const ERRORS: Record<string, string> = {
  email_taken: 'An account with that email already exists.',
  invalid: 'Please fill in your name, a valid email, and a password (6+ chars).',
}

export default function Register() {
  const navigate = useNavigate()
  const login = useSession((s) => s.login)
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { accessToken, user } = await authApi.register({
        full_name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
      })
      login(user, accessToken)
      navigate('/onboarding')
    } catch (err) {
      const code = err instanceof Error ? err.message : 'register_failed'
      setError(ERRORS[code] ?? 'Could not create your account. Is the server running?')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mesh-bg flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2">
          <Logo className="h-10 w-10" />
          <span className="text-2xl font-bold tracking-tight">Optryva</span>
        </Link>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
          <h1 className="text-xl font-bold tracking-tight">Create your account</h1>
          <p className="mb-5 mt-1 text-sm text-muted-foreground">Free to join, from anywhere.</p>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label>Full name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Your name"
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
