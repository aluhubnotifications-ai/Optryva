import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/Button'
import { Input, Label } from '@/components/ui/primitives'

export default function ForgotPassword() {
  const [sent, setSent] = useState(false)
  return (
    <div className="mesh-bg flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2">
          <Logo className="h-10 w-10" />
          <span className="text-2xl font-bold tracking-tight">Optryva</span>
        </Link>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
          <h1 className="text-xl font-bold tracking-tight">Reset your password</h1>
          {sent ? (
            <p className="mt-3 text-sm text-muted-foreground">
              If an account exists for that email, a reset link is on its way.
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                setSent(true)
              }}
              className="mt-4 space-y-4"
            >
              <div>
                <Label>Email</Label>
                <Input type="email" placeholder="you@example.com" required />
              </div>
              <Button type="submit" className="w-full">
                Send reset link
              </Button>
            </form>
          )}
          <Link to="/login" className="mt-5 inline-block text-sm text-primary hover:underline">
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
