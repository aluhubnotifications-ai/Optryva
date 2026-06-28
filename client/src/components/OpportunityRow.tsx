import { Link } from 'react-router-dom'
import { Gauge, Loader2, Sparkles } from 'lucide-react'
import { Card, CardBody, Badge, Avatar } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { ScoreRing } from '@/components/ScoreRing'
import { ResearchBody } from '@/components/AIResearchPanel'
import type { AiMatch, JobListing, Profile } from '@/types'

/** One opportunity, with AI research that expands inline (no modal). Shared by
 *  the Dashboard and the Research page. Pass `onScore` to let an unscored role be
 *  scored on demand (students only); omit it for viewers who can't score. */
export function OpportunityRow({
  job,
  user,
  match,
  company,
  scoring = false,
  autoRunning = false,
  researchOpen,
  aiReasons,
  onScore,
  onToggleResearch,
}: {
  job: JobListing
  user: Profile
  match?: AiMatch
  company?: Profile
  scoring?: boolean
  autoRunning?: boolean
  researchOpen: boolean
  /** "Why this matched your search" chips from the AI sourcing engine. */
  aiReasons?: string[]
  onScore?: () => void
  onToggleResearch: () => void
}) {
  const canScore = !!onScore
  return (
    <Card className={`transition-shadow ${researchOpen ? 'shadow-card ring-1 ring-primary/30' : 'hover:shadow-card'}`}>
      <CardBody className="flex items-center gap-4">
        {match ? (
          <Link to={`/app/jobs?job=${job.id}`}>
            <ScoreRing score={match.score} size={50} showLabel />
          </Link>
        ) : (
          <div className="flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-full border border-dashed border-border text-center text-[10px] font-medium leading-tight text-muted-foreground">
            Not<br />scored
          </div>
        )}
        <div className="min-w-0 flex-1">
          <Link to={`/app/jobs?job=${job.id}`} className="truncate font-semibold hover:text-primary">
            {job.title}
          </Link>
          <div className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
            <Avatar name={job.original_company_name || company?.company_name} src={job.original_company_logo_url || company?.avatar_url} size={16} />
            <span className="truncate">{job.original_company_name || company?.company_name}</span>
            <span>·</span>
            <span className="truncate">{job.location}</span>
          </div>
          {match ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {match.matched_skills.slice(0, 3).map((s) => (
                <Badge key={s} tone="success" className="text-[11px]">{s}</Badge>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              {canScore ? 'Not in your auto-matched set yet — score it to see your fit.' : 'Open research for the full breakdown.'}
            </p>
          )}
          {aiReasons && aiReasons.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {aiReasons.slice(0, 3).map((r) => (
                <span key={r} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                  <Sparkles className="h-3 w-3" /> {r}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canScore && !match && (
            <Button size="sm" className="gap-1.5" disabled={scoring || autoRunning} onClick={onScore}>
              {scoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gauge className="h-4 w-4" />}
              {scoring ? 'Scoring…' : 'Score it'}
            </Button>
          )}
          <Button
            variant={researchOpen ? 'default' : 'outline'}
            size="sm"
            className="gap-1.5"
            onClick={onToggleResearch}
          >
            <Sparkles className={`h-4 w-4 ${researchOpen ? '' : 'text-primary'}`} />
            <span className="hidden sm:inline">{researchOpen ? 'Close' : 'Research'}</span>
          </Button>
        </div>
      </CardBody>

      {/* Inline AI research — expands in place, no modal. Uses the shared store
          score (if any) and lets an unscored role be scored right here. */}
      {researchOpen && (
        <div className="border-t border-border bg-muted/30 px-4 py-5 sm:px-6">
          <ResearchBody
            job={job}
            company={company}
            user={user}
            match={match ?? null}
            autoMatch={false}
            onScore={onScore}
            scoring={scoring}
          />
        </div>
      )}
    </Card>
  )
}
