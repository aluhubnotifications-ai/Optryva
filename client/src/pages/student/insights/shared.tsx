export function readinessLabel(n: number) {
  if (n >= 85) return { label: 'Market-ready', tone: 'text-success' }
  if (n >= 70) return { label: 'Strong', tone: 'text-success' }
  if (n >= 50) return { label: 'Developing', tone: 'text-warning' }
  return { label: 'Early', tone: 'text-muted-foreground' }
}

export function DistCell({ label, hint, value, tone }: { label: string; hint: string; value: number; tone: string }) {
  return (
    <div className={`rounded-xl px-3 py-2 ${tone}`}>
      <p className="text-xl font-bold leading-none">{value}</p>
      <p className="mt-1 text-[11px] font-medium leading-tight">{label}</p>
      <p className="text-[10px] opacity-70">{hint}</p>
    </div>
  )
}
