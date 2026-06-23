import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Globe, Sparkles, Briefcase } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/Button'

export default function Landing() {
  return (
    <div className="mesh-bg min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <Logo className="h-9 w-9" />
          <span className="text-xl font-bold tracking-tight">Optryva</span>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/login">
            <Button variant="ghost" size="sm">
              Sign in
            </Button>
          </Link>
          <Link to="/register">
            <Button size="sm">Get started</Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6">
        <section className="py-20 text-center">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground"
          >
            <Globe className="h-3.5 w-3.5 text-accent" /> For students & employers — worldwide
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="mx-auto max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl"
          >
            Where talent meets{' '}
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              opportunity
            </span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground"
          >
            AI-powered job matching, application coaching, and a global community — built to
            launch early-career careers anywhere in the world.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <Link to="/app">
              <Button size="lg" className="gap-2">
                Enter the app <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link to="/register">
              <Button size="lg" variant="outline">
                Create an account
              </Button>
            </Link>
          </motion.div>
        </section>

        <section className="grid gap-4 pb-24 sm:grid-cols-3">
          {[
            { icon: Sparkles, title: 'AI Job Matcher', body: 'Every role scored 0–99 against your real résumé.' },
            { icon: Briefcase, title: 'Apply smarter', body: 'An AI coach drafts and refines your application.' },
            { icon: Globe, title: 'Global by default', body: 'Students and companies across every continent.' },
          ].map((f) => (
            <div key={f.title} className="rounded-2xl border border-border bg-card/60 p-6">
              <f.icon className="mb-3 h-6 w-6 text-primary" />
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  )
}
