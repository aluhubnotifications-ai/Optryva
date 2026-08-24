import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, ExternalLink, ImageIcon, Loader2 } from 'lucide-react'
import { evidenceApi } from '@/lib/api'
import { Card, CardBody, Badge } from '@/components/ui/primitives'

/**
 * Employer-facing evidence view. Instead of dumping the candidate's raw gallery
 * images, it shows an AI summary of what they've actually done (main points per
 * evidence item). Reviewers who want the primary sources can open the candidate's
 * public profile, where the full evidence gallery lives.
 */
export function EmployerEvidenceSummary({ studentId }: { studentId: string }) {
  const [summary, setSummary] = useState<string | null>(null)
  const [count, setCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([evidenceApi.summary(studentId), evidenceApi.listForStudent(studentId)])
      .then(([s, items]) => {
        if (!active) return
        setSummary(s.summary)
        setCount(items.length)
      })
      .catch(() => active && setSummary('Could not load the evidence summary.'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
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
        ) : (
          <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">{summary}</p>
        )}

        <p className="mt-3 text-xs text-muted-foreground">
          This summary is generated from the candidate's submitted evidence. Open the full gallery to review the original files, links, and verification status.
        </p>

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
