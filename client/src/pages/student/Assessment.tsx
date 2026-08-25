import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTransitionNavigate } from '@/lib/useTransitionNavigate'
import { ArrowLeft, Check, ClipboardCheck } from 'lucide-react'
import { useCurrentUser } from '@/lib/store'
import { applicationsApi, jobsApi, profilesApi } from '@/lib/api'
import type { Application, JobListing, Profile } from '@/types'
import { Card, CardBody, Avatar } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { AssessmentRunner } from '@/components/AssessmentRunner'
import { cn } from '@/lib/utils'

/** Progress bars for the candidate's journey through the assessment, so the test
 *  never feels like a detached popup — they can see exactly where they are. */
function TestSteps() {
  const steps = ['Application sent', 'Take assessment', 'Complete']
  const current = 1
  return (
    <div className="flex items-center">
      {steps.map((label, i) => (
        <div key={label} className="flex flex-1 items-center last:flex-none">
          <div className="flex flex-col items-center">
            <div
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors',
                i < current
                  ? 'border-primary bg-primary text-primary-foreground'
                  : i === current
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-card text-muted-foreground',
              )}
            >
              {i < current ? <Check className="h-4 w-4" /> : <span className="text-xs">{i + 1}</span>}
            </div>
            <span className={cn('mt-1.5 text-[11px] font-medium', i === current || i < current ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
          </div>
          {i < steps.length - 1 && <div className={cn('mx-1 h-0.5 flex-1 rounded-full', i < current ? 'bg-primary' : 'bg-border')} />}
        </div>
      ))}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[60vh] items-center justify-center px-5 text-center"><div className="max-w-sm">{children}</div></div>
}

export default function AssessmentPage() {
  const { id } = useParams()
  const navigate = useTransitionNavigate()
  const user = useCurrentUser()!
  const [app, setApp] = useState<Application | null>(null)
  const [job, setJob] = useState<JobListing | null>(null)
  const [company, setCompany] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      if (!id) return
      try {
        const a = await applicationsApi.get(id)
        if (!a) { setError('Application not found.'); setLoading(false); return }
        const j = await jobsApi.get(a.job_id)
        const c = j ? await profilesApi.get(j.company_id) : null
        setApp(a); setJob(j); setCompany(c)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load the assessment.')
      } finally {
        setLoading(false)
      }
    })()
  }, [id])

  if (loading) return <Centered><p className="text-sm text-muted-foreground">Loading…</p></Centered>
  if (error || !app || !job) return <Centered><p className="font-medium">{error ?? 'Assessment not available.'}</p><Button className="mt-4" onClick={() => navigate('/app/applications')}>Back to applications</Button></Centered>

  const brand = job.original_company_name || company?.company_name
  const when = job.assignment?.required_when ?? 'after_application'
  const eligible = when === 'after_application' || app.status === 'shortlisted'
  const maxAttempts = job.assignment?.max_attempts ?? 10
  const exhausted = (app.attempts ?? 0) >= maxAttempts
  const canTake = !!job.assignment && app.assignment_status !== 'submitted' && eligible && !exhausted

  if (!canTake) {
    return (
      <Centered>
        <p className="font-medium">{app.assignment_status === 'submitted' ? 'You’ve already completed this assessment.' : 'This assessment isn’t available right now.'}</p>
        <Button className="mt-4" onClick={() => navigate(`/app/applications/${app.id}`)}>Back to application</Button>
      </Centered>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <Link to={`/app/applications/${app.id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to application
      </Link>

      <Card>
        <CardBody>
          <div className="flex items-center gap-3">
            <Avatar name={brand} src={job.original_company_logo_url || company?.avatar_url} size={44} className="rounded-xl" />
            <div>
              <p className="font-semibold">{job.title}</p>
              <p className="text-xs text-muted-foreground">{brand}</p>
            </div>
          </div>
          <div className="mt-5">
            <TestSteps />
          </div>
        </CardBody>
      </Card>

      <AssessmentRunner
        job={job}
        application={app}
        onComplete={(updated) => { setApp(updated); navigate(`/app/applications/${app.id}`) }}
        onClose={() => navigate(`/app/applications/${app.id}`)}
      />
    </div>
  )
}
