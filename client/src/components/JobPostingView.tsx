import type { ReactNode } from 'react'
import { CheckCircle2, ClipboardCheck } from 'lucide-react'
import { Avatar, Badge } from '@/components/ui/primitives'
import { buildJobContent } from '@/lib/jobContent'
import type { AiAssignment, JobListing } from '@/types'

/** The rich job posting body (header + sections). Shared across company/student views. */
export function JobPostingView({ job, brand, logo }: { job: JobListing; brand?: string; logo?: string }) {
  const isIntern = job.listing_type === 'Internship' || job.listing_type === 'Fellowship'
  const content = buildJobContent(job)
  const List = ({ items }: { items: string[] }) => (
    <ul className="space-y-1.5">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2 text-sm text-muted-foreground"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {t}</li>
      ))}
    </ul>
  )
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <Avatar name={brand} src={logo} size={48} className="rounded-xl" />
        <div>
          <h2 className="text-lg font-bold tracking-tight">{job.title}</h2>
          <p className="text-sm text-muted-foreground">{brand} · {job.location}</p>
          <div className="mt-1 flex flex-wrap gap-2 text-xs">
            <Badge tone="outline">{job.listing_type}</Badge>
            {job.pay && <Badge tone="primary">{isIntern ? 'Stipend' : 'Salary'}: {job.pay}</Badge>}
            {job.tags.slice(0, 5).map((t) => <Badge key={t} tone="outline">{t}</Badge>)}
          </div>
        </div>
      </div>

      {content.intro && (
        <Section title="Job description"><p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{content.intro}</p></Section>
      )}
      {content.responsibilities.length > 0 && (
        <Section title="Responsibilities"><List items={content.responsibilities} /></Section>
      )}
      {content.qualifications.length > 0 && (
        <Section title="Qualifications"><List items={content.qualifications} /></Section>
      )}
      {content.benefits.length > 0 && (
        <Section title="Benefits"><List items={content.benefits} /></Section>
      )}

      {job.assignment && <AssignmentView assignment={job.assignment} />}
    </div>
  )
}

export function AssignmentView({ assignment }: { assignment: AiAssignment }) {
  const typeLabel: Record<string, string> = {
    essay: 'Essay',
    single_choice: 'Single choice',
    multiple_choice: 'Multiple choice',
    true_false: 'True / False',
    file: 'File upload',
    video: 'Video upload',
  }
  const questions = assignment.questions ?? []
  const rubric = assignment.rubric ?? []
  return (
    <Section title="Candidate assignment">
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ClipboardCheck className="h-4 w-4 text-accent" /> {assignment.title}
        </div>
        {assignment.prompt && (
          <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{assignment.prompt}</p>
        )}
        {questions.length > 0 && (
          <ol className="space-y-2">
            {questions.map((q, i) => (
              <li key={q.id ?? i} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{i + 1}. {q.prompt}</span>
                  <Badge tone="outline">{typeLabel[q.type] ?? q.type}</Badge>
                  {q.required && <Badge tone="primary">Required</Badge>}
                </div>
                {(q.type === 'single_choice' || q.type === 'multiple_choice') && q.options?.length ? (
                  <ul className="mt-2 space-y-1 pl-1 text-sm text-muted-foreground">
                    {q.options.map((o, oi) => <li key={oi}>• {o}</li>)}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        {rubric.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Scoring rubric</p>
            <div className="flex flex-wrap gap-2 text-xs">
              {rubric.map((c) => (
                <span key={c.id} className="rounded-lg border border-border px-2 py-1">{c.label} · {c.points} pts</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </Section>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 font-semibold">{title}</h3>
      {children}
    </div>
  )
}
