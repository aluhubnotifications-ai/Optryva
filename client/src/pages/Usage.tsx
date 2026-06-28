import { useEffect, useMemo, useState } from 'react'
import { Coins, Cpu, ArrowDownToLine, ArrowUpFromLine, Activity, Sparkles } from 'lucide-react'
import { aiApi, type UsageSummary } from '@/lib/api'
import { Card, CardBody, Skeleton } from '@/components/ui/primitives'

/** Friendly labels for the model ids we meter. Falls back to the raw id. */
const MODEL_LABEL: Record<string, string> = {
  'claude-opus-4-8': 'Claude Opus 4.8',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-haiku-4-5': 'Claude Haiku 4.5',
}
const labelFor = (id: string) => MODEL_LABEL[id] ?? id

const fmt = (n: number) => n.toLocaleString()

/** Usage — what the AI has cost you, in credits, with per-model token breakdown.
 *  This is a usage dashboard, not a payment page: nothing here charges money. */
export default function Usage() {
  const [data, setData] = useState<UsageSummary | null>(null)

  useEffect(() => {
    let active = true
    aiApi.usage().then((u) => active && setData(u))
    return () => { active = false }
  }, [])

  const loading = data === null
  const empty = !loading && data.models.length === 0
  const totals = data?.totals

  const summaryCards = useMemo(() => {
    if (!totals) return []
    return [
      { icon: Coins, label: 'Credits used', value: fmt(totals.credits), hint: `≈ $${totals.cost_usd.toFixed(2)} of AI spend` },
      { icon: ArrowDownToLine, label: 'Input tokens', value: fmt(totals.input_tokens), hint: 'across all models' },
      { icon: ArrowUpFromLine, label: 'Output tokens', value: fmt(totals.output_tokens), hint: 'across all models' },
      { icon: Activity, label: 'AI calls', value: fmt(totals.calls), hint: 'requests metered' },
    ]
  }, [totals])

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Sparkles className="h-6 w-6 text-primary" /> Usage
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          How much AI you've used — in credits — with the token input and output for each model.
          1 credit = $0.01 of model spend.
        </p>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardBody className="space-y-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-7 w-2/3" /></CardBody></Card>
          ))}
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {summaryCards.map((c) => (
              <Card key={c.label}>
                <CardBody>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <c.icon className="h-4 w-4 text-primary" /> {c.label}
                  </div>
                  <p className="mt-1 text-2xl font-bold tabular-nums">{c.value}</p>
                  <p className="text-xs text-muted-foreground">{c.hint}</p>
                </CardBody>
              </Card>
            ))}
          </div>

          {/* Per-model breakdown */}
          <h2 className="mb-3 mt-8 flex items-center gap-2 text-lg font-semibold">
            <Cpu className="h-5 w-5 text-primary" /> By model
          </h2>

          {empty ? (
            <Card>
              <CardBody className="py-12 text-center text-sm text-muted-foreground">
                No AI usage yet. Matching, research, and AI search will show up here as you use them.
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardBody className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Model</th>
                      <th className="px-4 py-3 text-right font-medium">Input tokens</th>
                      <th className="px-4 py-3 text-right font-medium">Output tokens</th>
                      <th className="px-4 py-3 text-right font-medium">Calls</th>
                      <th className="px-4 py-3 text-right font-medium">Credits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data!.models.map((m) => (
                      <tr key={m.model} className="border-b border-border/60 last:border-0">
                        <td className="px-4 py-3 font-medium">{labelFor(m.model)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmt(m.input_tokens)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmt(m.output_tokens)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{fmt(m.calls)}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmt(m.credits)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border bg-muted/30 font-semibold">
                      <td className="px-4 py-3">Total</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmt(totals!.input_tokens)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmt(totals!.output_tokens)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmt(totals!.calls)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmt(totals!.credits)}</td>
                    </tr>
                  </tfoot>
                </table>
              </CardBody>
            </Card>
          )}

          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            Token-based estimate at current model prices (Opus 4.8 $5/$25, Sonnet 4.6 $3/$15, Haiku 4.5 $1/$5 per 1M in/out).
          </p>
        </>
      )}
    </div>
  )
}
