import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { useTransitionNavigate } from '@/lib/useTransitionNavigate'
import { ArrowLeft } from 'lucide-react'
import { ApplyForm } from '@/components/ApplyModal'
import { jobsApi } from '@/lib/api'
import { useCurrentUser } from '@/lib/store'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import type { JobListing } from '@/types'

export default function Apply() {
  const { jobId } = useParams<{ jobId: string }>()
  const navigate = useTransitionNavigate()
  const user = useCurrentUser()
  const [job, setJob] = useState<JobListing | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!jobId) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setLoading(true)
    jobsApi
      .get(jobId)
      .then((j) => {
        if (!j) setNotFound(true)
        else setJob(j)
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [jobId])

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner label="Loading application…" />
      </div>
    )
  }

  if (notFound || !job) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="font-semibold">We couldn't find that opportunity</p>
        <p className="mt-1 text-sm text-muted-foreground">It may have been filled or removed.</p>
        <Button className="mt-4" onClick={() => navigate('/app/jobs')}>Back to jobs</Button>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="font-semibold">Please sign in to apply</p>
        <Button className="mt-4" onClick={() => navigate('/app/jobs')}>Back to jobs</Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="mb-5 rounded-2xl border border-border bg-card p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{job.company_name}</p>
        <h1 className="mt-0.5 text-xl font-bold">{job.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{[job.location, job.type].filter(Boolean).join(' · ')}</p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <ApplyForm
          job={job}
          user={user}
          onClose={() => navigate('/app/jobs')}
          onSubmitted={(app) => navigate('/app/applications/' + app.id)}
        />
      </div>
    </div>
  )
}
