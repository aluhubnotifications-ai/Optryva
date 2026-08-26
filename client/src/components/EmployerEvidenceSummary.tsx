import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, ExternalLink, ImageIcon, Loader2, MessageSquare } from 'lucide-react'
import { evidenceApi } from '@/lib/api'
import type { JobListing } from '@/types'
import { Card, CardBody, Badge } from '@/components/ui/primitives'
import { Drawer } from '@/components/ui/Drawer'
import { EvidenceChat } from '@/components/EvidenceChat'

// Minimal Markdown renderer for the AI summary: handles **bold**, "- " bullets,
// and short **Heading** lines. Avoids pulling in a full Markdown dependency for
// a small, predictable block of text.
function renderInline(text: string, keyBase: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={`${keyBase}-${i}`}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={`${keyBase}-${i}`} className="italic">{part.slice(1, -1)}</em>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={`${keyBase}-${i}`} className="rounded bg-muted px-1 py-0.5 text-[0.85em] font-mono">{part.slice(1, -1)}</code>
    return <span key={`${keyBase}-${i}`}>{part}</span>
  })
}

function SummaryMarkdown({ text }: { text: string }) {
  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  let bullets: string[] = []
  const flush = () => {
    if (!bullets.length) return
    const items = bullets
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="mt-2 list-disc space-y-1.5 pl-5">
        {items.map((b, i) => (
          <li key={i}>{renderInline(b, `b-${blocks.length}-${i}`)}</li>
        ))}
      </ul>,
    )
    bullets = []
  }
  lines.forEach((line, idx) => {
    const t = line.trim()
    if (t.startsWith('- ')) {
      bullets.push(t.slice(2))
      return
    }
    flush()
    if (!t) return
    const heading = t.match(/^#{1,6}\s+(.*)$/)
    if (heading) {
      blocks.push(
        <p key={`h-${idx}`} className="mt-3 font-semibold text-foreground">
          {renderInline(heading[1], `h-${idx}`)}
        </p>,
      )
      return
    }
    if (/^\*\*[^*]+\*\*$/.test(t)) {
      blocks.push(
        <p key={`h-${idx}`} className="mt-3 font-semibold text-foreground">
          {renderInline(t, `h-${idx}`)}
        </p>,
      )
    } else {
      blocks.push(
        <p key={`p-${idx}`} className="mt-2 leading-relaxed text-foreground/90">
          {renderInline(t, `p-${idx}`)}
        </p>,
      )
    }
  })
  flush()
  return <>{blocks}</>
}

/**
 * Employer-facing evidence view. Instead of dumping the candidate's raw gallery
 * images, it shows an AI summary of what they've actually done (main points per
 * evidence item). Reviewers who want the primary sources can open the candidate's
 * public profile, where the full evidence gallery lives.
 */
export function EmployerEvidenceSummary({ studentId, job }: { studentId: string; job?: JobListing | null }) {
  const [summary, setSummary] = useState<string | null>(null)
  const [count, setCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [chatOpen, setChatOpen] = useState(false)

  // Build a single job-role context string so the summary only surfaces what's
  // relevant to THIS posting (not a generic dump of everything).
  const jobDescription = useMemo(() => {
    if (!job) return ''
    const parts = [job.title, job.description]
    if (job.responsibilities?.length) parts.push('Responsibilities: ' + job.responsibilities.join('; '))
    if (job.qualifications?.length) parts.push('Qualifications: ' + job.qualifications.join('; '))
    return parts.filter(Boolean).join('\n\n')
  }, [job])

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([evidenceApi.summary(studentId, jobDescription), evidenceApi.listForStudent(studentId)])
      .then(([s, fetchedItems]) => {
        if (!active) return
        setSummary(s.summary)
        setCount(fetchedItems.length)
      })
      .catch(() => active && setSummary('Could not load the evidence summary.'))
      .finally(() => active && setLoading(false))
  }, [studentId, jobDescription])

  return (
    <Card>
      <CardBody>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">{job ? 'Evidence for this role' : 'AI evidence summary'}</h3>
            {count != null && <Badge tone="outline">{count} item{count === 1 ? '' : 's'}</Badge>}
          </div>
          <Link
            to={`/app/u/${studentId}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
          >
            <ImageIcon className="h-3.5 w-3.5" /> View full evidence gallery
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Building the candidate summary…
          </div>
        ) : summary ? (
          <div className="text-sm">
            <SummaryMarkdown text={summary} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No evidence summary available.</p>
        )}

        <p className="mt-3 text-xs text-muted-foreground">
          {job
            ? 'This summary is scoped to what matters for the role you’re hiring for. Open the evidence assistant if you want specifics or proof.'
            : 'This summary is generated from the candidate’s submitted evidence. Open the full gallery to review the original files and links.'}
        </p>

        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className="mt-4 flex w-full items-center gap-2 rounded-xl border border-border px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-muted"
        >
          <MessageSquare className="h-4 w-4 text-primary" />
          Ask about this evidence
          <span className="ml-auto text-xs font-normal text-muted-foreground">Opens assistant →</span>
        </button>

        <Drawer
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          title="Evidence assistant"
          description={job ? 'Answers are scoped to this role.' : 'Ask about this candidate’s submitted evidence.'}
          width="lg"
        >
          <EvidenceChat studentId={studentId} />
        </Drawer>

        <div className="mt-3">
          <Link
            to={`/app/u/${studentId}`}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            Go to applicant profile <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </CardBody>
    </Card>
  )
}