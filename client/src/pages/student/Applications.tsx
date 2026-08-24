import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { FileText, ArrowRight, Briefcase, Sparkles } from 'lucide-react'
import { useCurrentUser } from '@/lib/store'
import { applicationsApi, jobsApi, profilesApi } from '@/lib/api'
import type { Application, ApplicationStatus, JobListing, Profile } from '@/types'
import { Card, CardBody, Badge, Avatar, Skeleton } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { AppProgressSteps } from '@/components/AppProgressSteps'
import { formatDate } from '@/lib/utils'

const statusTone = {
  draft: 'outline',
  pending: 'default',
  reviewed: 'primary',
  shortlisted: 'accent',
  hired: 'success',
  rejected: 'danger',
  cancelled: 'danger',
  withdrawn: 'outline',
} as const

const FILTERS: { key: ApplicationStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'reviewed', label: 'Reviewed' },
  { key: 'shortlisted', label: 'Shortlisted' },
  { key: 'hired', label: 'Accepted' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'withdrawn', label: 'Withdrawn' },
]

export default function Applications() {
  const user = useCurrentUser()!
  const [apps, setApps] = useState<Application[]>([])
  const [jobs, setJobs] = useState<Record<string, JobListing>>({})
  const [companies, setCompanies] = useState<Record<string, Profile>>({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<ApplicationStatus | 'all'>('all')

  useEffect(() => {
    ;(async () => {
      const [a, allJobs, cs, sc] = await Promise.all([
        applicationsApi.byStudent(user.id),
        jobsApi.list(user),
        profilesApi.list('company'),
        profilesApi.list('school'),
      ])
      const jmap: Record<string, JobListing> = {}
      allJobs.forEach((j) => (jmap[j.id] = j))
      const cmap: Record<string, Profile> = {}
      ;[...cs, ...sc].forEach((c) => (cmap[c.id] = c))
      setApps(a)
      setJobs(jmap)
      setCompanies(cmap)
      setLoading(false)
    })()
  }, [user])

  const filtered = useMemo(
    () => (filter === 'all' ? apps : apps.filter((a) => a.status === filter)),
    [apps, filter],
  )

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <FileText className="h-6 w-6 text-primary" /> My Applications
        </h1>
        <p className="text-sm text-muted-foreground">Track every role you've applied to.</p>
      </div>

      {/* Filters */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1">
        {FILTERS.map((f) => {
          const count = f.key === 'all' ? apps.length : apps.filter((a) => a.status === f.key).length
          const active = filter === f.key
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {f.label}
              <span className="rounded-full bg-muted px-1.5 text-xs">{count}</span>
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}><CardBody><Skeleton className="h-4 w-1/2" /><Skeleton className="mt-3 h-8 w-full" /></CardBody></Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center">
          <Briefcase className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="font-medium">No applications {filter !== 'all' ? `(${filter})` : 'yet'}</p>
          <p className="mt-1 text-sm text-muted-foreground">Browse opportunities and apply to get started.</p>
          <Link to="/app/jobs"><Button className="mt-4">Browse opportunities</Button></Link>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((a, i) => {
            const job = jobs[a.job_id]
            const company = job ? companies[job.company_id] : undefined
            const brand = job?.original_company_name || company?.company_name
            return (
              <motion.div key={a.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                <Link to={`/app/applications/${a.id}`}>
                  <Card className="transition-shadow hover:shadow-card">
                    <CardBody>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 gap-3">
                          <Avatar name={brand} src={job?.original_company_logo_url || company?.avatar_url} size={44} className="rounded-xl" />
                          <div className="min-w-0">
                            <p className="truncate font-semibold">{job?.title ?? 'Role'}</p>
                            <p className="truncate text-sm text-muted-foreground">{brand} · {job?.location}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">Applied {formatDate(a.created_at)}</p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {a.assignment_score != null && (
                            <Badge tone="outline" className="gap-1 capitalize"><Sparkles className="h-3 w-3" /> Scored</Badge>
                          )}
                          <Badge tone={statusTone[a.status]} className="capitalize">{a.status === 'hired' ? 'Accepted' : a.status}</Badge>
                          <ArrowRight className="hidden h-4 w-4 text-muted-foreground sm:block" />
                        </div>
                      </div>
                      <div className="mt-4 border-t border-border pt-4">
                        <AppProgressSteps status={a.status} />
                      </div>
                    </CardBody>
                  </Card>
                </Link>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}
