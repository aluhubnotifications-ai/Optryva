// Minimal markdown renderer for AI chat output: headings, bold, inline code,
// code fences, ordered/unordered lists, and GitHub-style tables.

function renderInline(text: string, keyBase: string) {
  // split on **bold**, *italic*, and `code`
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g)
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={`${keyBase}-${i}`}>{p.slice(2, -2)}</strong>
    if (/^\*[^*]+\*$/.test(p)) return <em key={`${keyBase}-${i}`} className="italic">{p.slice(1, -1)}</em>
    if (/^`[^`]+`$/.test(p)) return (
      <code key={`${keyBase}-${i}`} className="rounded bg-muted px-1.5 py-0.5 text-[0.85em] font-mono">{p.slice(1, -1)}</code>
    )
    return <span key={`${keyBase}-${i}`}>{p}</span>
  })
}

export function Markdown({ content }: { content: string }) {
  const lines = content.split('\n')
  const blocks: React.ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    // code fence
    if (line.trim().startsWith('```')) {
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code.push(lines[i])
        i++
      }
      i++ // closing fence
      blocks.push(
        <pre key={key++} className="my-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs">
          <code className="font-mono">{code.join('\n')}</code>
        </pre>,
      )
      continue
    }

    // table
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[ :|-]+\|?\s*$/.test(lines[i + 1])) {
      const header = line.split('|').map((c) => c.trim()).filter(Boolean)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|')) {
        rows.push(lines[i].split('|').map((c) => c.trim()).filter(Boolean))
        i++
      }
      blocks.push(
        <div key={key++} className="my-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {header.map((h, hi) => (
                  <th key={hi} className="px-3 py-1.5 text-left font-semibold">{renderInline(h, `th${key}-${hi}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-b border-border/50">
                  {r.map((c, ci) => (
                    <td key={ci} className="px-3 py-1.5 text-muted-foreground">{renderInline(c, `td${key}-${ri}-${ci}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    // headings
    const h = line.match(/^(#{1,3})\s+(.*)$/)
    if (h) {
      const lvl = h[1].length
      const cls = lvl === 1 ? 'text-lg font-bold' : lvl === 2 ? 'text-base font-semibold' : 'text-sm font-semibold'
      blocks.push(<p key={key++} className={`mt-3 ${cls}`}>{renderInline(h[2], `h${key}`)}</p>)
      i++
      continue
    }

    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      blocks.push(
        <ol key={key++} className="my-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          {items.map((it, ii) => <li key={ii}>{renderInline(it, `ol${key}-${ii}`)}</li>)}
        </ol>,
      )
      continue
    }

    // unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
        i++
      }
      blocks.push(
        <ul key={key++} className="my-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {items.map((it, ii) => <li key={ii}>{renderInline(it, `ul${key}-${ii}`)}</li>)}
        </ul>,
      )
      continue
    }

    // blank
    if (!line.trim()) {
      i++
      continue
    }

    // paragraph
    blocks.push(<p key={key++} className="my-1.5 text-sm leading-relaxed text-muted-foreground">{renderInline(line, `p${key}`)}</p>)
    i++
  }

  return <div className="space-y-0.5">{blocks}</div>
}
