import { Link } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/Button'

export default function VerifyEmail() {
  return (
    <div className="mesh-bg flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <Link to="/" className="mb-8 inline-flex items-center justify-center gap-2">
          <Logo className="h-10 w-10" />
          <span className="text-2xl font-bold tracking-tight">Optryva</span>
        </Link>
        <div className="rounded-2xl border border-border bg-card p-8 shadow-card">
          <MailCheck className="mx-auto mb-4 h-10 w-10 text-primary" />
          <h1 className="text-xl font-bold tracking-tight">Check your inbox</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We sent a verification link to your email. Click it to activate your account.
          </p>
          <Button variant="outline" className="mt-6 w-full">
            Resend verification email
          </Button>
          <Link to="/login" className="mt-3 inline-block text-sm text-primary hover:underline">
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
