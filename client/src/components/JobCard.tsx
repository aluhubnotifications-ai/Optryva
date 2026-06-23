import { Link } from 'react-router-dom'
import { ExternalLink, MapPin, Rocket, Sparkles, Clock, Briefcase } from 'lucide-react'
import { Badge, Avatar } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { ScoreRing } from '@/components/ScoreRing'
import { daysUntil } from '@/lib/utils'
import type { AiMatch, JobListing, Profile } from '@/types'

const typeGradients: Record<string, string> = {
  'Software Engineering': 'from-violet-500/20 to-indigo-500/20',
  Data: 'from-cyan-500/20 to-blue-500/20',
  Design: 'from-pink-500/20 to-rose-500/20',
  Marketing: 'from-amber-500/20 to-orange-500/20',
  Operations: 'from-emerald-500/20 to-teal-500/20',
  Finance: 'from-green-500/20 to-lime-500/20',
  Product: 'from-fuchsia-500/20 to-purple-500/20',
}

export function JobCard({
  job,
  company,
  match,
  onResearch,
  onApply,
}: {
  job: JobListing
  company?: Profile
  match?: AiMatch
  onResearch: (job: JobListing) => void
  onApply: (job: JobListing) => void
}) {
  const external = !!job.apply_url
  const dl = daysUntil(job.deadline)
  const grad = typeGradients[job.type] ?? 'from-primary/20 to-accent/20'
  const brandName = job.original_company_name || company?.company_name

  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-card">
      {/* Banner */}
      <div className={`relative h-20 bg-gradient-to-br ${grad}`}>
        <div className="absolute left-4 top-4 flex items-center gap-2">
          <Avatar name={brandName} src={job.original_company_logo_url || company?.avatar_url} size={40} className="ring-2 ring-card" />
        </div>
        {match && (
          <div className="absolute right-3 top-3">
            <ScoreRing score={match.score} size={48} stroke={5} />
          </div>
        )}
        {job.posted_by_role === 'school' && (
          <Badge tone="accent" className="absolute bottom-2 left-4">School</Badge>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col p-4">
        <Link to={`/app/jobs/${job.id}`} className="block">
          <h3 className="line-clamp-1 font-semibold tracking-tight group-hover:text-primary">
            {job.title}
          </h3>
        </Link>
        <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{brandName}</p>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" /> {job.location}
          </span>
          <span className="inline-flex items-center gap-1">
            <Briefcase className="h-3.5 w-3.5" /> {job.listing_type}
          </span>
          {dl !== null && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> {dl <= 0 ? 'Closing' : `${dl}d left`}
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {job.tags.slice(0, 3).map((t) => {
            const matched = match?.matched_skills.includes(t)
            return (
              <Badge key={t} tone={matched ? 'success' : 'outline'} className="text-[11px]">
                {t}
              </Badge>
            )
          })}
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 pt-4">
          <span className="text-sm font-semibold text-foreground">{job.pay || 'Competitive'}</span>
        </div>

        <div className="mt-3 flex gap-2">
          <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={() => onResearch(job)}>
            <Sparkles className="h-4 w-4 text-primary" /> AI Research
          </Button>
          <Button
            size="sm"
            className="flex-1 gap-1.5"
            onClick={() => onApply(job)}
            title={external ? 'Apply on company site' : 'Apply in app'}
          >
            {external ? <ExternalLink className="h-4 w-4" /> : <Rocket className="h-4 w-4" />}
            Apply
          </Button>
        </div>
      </div>
    </div>
  )
}
