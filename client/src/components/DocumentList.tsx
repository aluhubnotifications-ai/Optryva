import { useState } from 'react'
import { Download, Eye, FileText } from 'lucide-react'
import type { AppDocument } from '@/types'
import { formatBytes } from '@/lib/utils'
import { fetchProtectedDocument } from '@/lib/api'
import { DocumentViewer } from '@/components/DocumentViewer'

export const DOC_LABELS: Record<string, string> = {
  cv: 'CV / Résumé',
  cover: 'Cover Letter',
  transcript: 'Transcript',
  recommendation: 'Recommendation',
  portfolio: 'Portfolio',
  certificate: 'Certificate',
  id: 'ID',
}

function isViewable(url?: string): boolean {
  return !!url && url !== '#' && (url.startsWith('data:') || url.startsWith('/api/documents/') || /^https?:\/\//.test(url))
}

async function downloadDoc(d: AppDocument) {
  const url = d.url.startsWith('/api/documents/') ? await fetchProtectedDocument(d.url) : d.url
  const a = document.createElement('a')
  a.href = url
  a.download = d.name || 'document'
  document.body.appendChild(a)
  a.click()
  a.remove()
  if (url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Shared renderer for an application's submitted documents, with working
 *  view + download actions. Used by both the student and company views. */
export function DocumentList({ documents, emptyText = 'No documents submitted.' }: { documents: AppDocument[]; emptyText?: string }) {
  const [viewerDoc, setViewerDoc] = useState<AppDocument | null>(null)
  if (!documents.length) return <p className="text-sm text-muted-foreground">{emptyText}</p>
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {documents.map((d) => {
        const viewable = isViewable(d.url)
        return (
          <div key={d.kind} className="flex items-center gap-2 rounded-lg border border-border p-2.5">
            <FileText className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{DOC_LABELS[d.kind] ?? d.kind}</p>
              <p className="truncate text-xs text-muted-foreground">{d.name}{d.size ? ` · ${formatBytes(d.size)}` : ''}</p>
            </div>
            {viewable ? (
              <div className="flex shrink-0 items-center gap-0.5">
                <button onClick={() => setViewerDoc(d)} title="View" aria-label="View" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                  <Eye className="h-4 w-4" />
                </button>
                <button onClick={() => downloadDoc(d)} title="Download" aria-label="Download" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                  <Download className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <span className="shrink-0 text-[11px] text-muted-foreground" title="No file was attached for this document">Not attached</span>
            )}
          </div>
        )
      })}
      <DocumentViewer document={viewerDoc} open={!!viewerDoc} onClose={() => setViewerDoc(null)} />
    </div>
  )
}
