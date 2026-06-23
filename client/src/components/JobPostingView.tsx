import type { ReactNode } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { Avatar, Badge } from '@/components/ui/primitives'
import { buildJobContent } from '@/lib/jobContent'
import type { JobListing } from '@/types'

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
    </div>
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
