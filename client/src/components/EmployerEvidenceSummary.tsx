import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, ExternalLink, ImageIcon, Loader2 } from 'lucide-react'
import { evidenceApi } from '@/lib/api'
import { Card, CardBody, Badge } from '@/components/ui/primitives'
import { EvidenceComments } from '@/components/evidence/Comments'

// Minimal Markdown renderer for the AI summary: handles **bold**, "- " bullets,
// and short **Heading** lines. Avoids pulling in a full Markdown dependency for
// a small, predictable block of text.
function renderInline(text: string, keyBase: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={`${keyBase}-${i}`}>{part.slice(2, -2)}</strong>
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
export function EmployerEvidenceSummary({ studentId }: { studentId: string }) {
const [summary, setSummary] = useState<string | null>(null)
  const [count, setCount] = useState<number | null>(null)
  const [items, setItems] = useState<Array<{ id: string; title: string } | null>>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([evidenceApi.summary(studentId), evidenceApi.listForStudent(studentId)])
      .then(([s, fetchedItems]) => {
        if (!active) return
        setSummary(s.summary)
        setCount(fetchedItems.length)
        setItems(fetchedItems)
      })
      .catch(() => active && setSummary('Could not load the evidence summary.'))
      .finally(() => active && setLoading(false))
  }, [studentId])

  return (
    <Card>
      <CardBody>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">AI evidence summary</h3>
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
          This summary is generated from the candidate's submitted evidence. Open the full gallery to review the original files, links, and verification status.
        </p>

        {items && items.length > 0 ? (
          <EvidenceComments
            evidenceId={items[0].id}
            token=""
          />
        ) : null}

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
