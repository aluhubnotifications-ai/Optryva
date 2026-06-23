import { Sparkles } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/primitives'

export function Placeholder({ title, note }: { title: string; note?: string }) {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        {note ?? 'This screen is coming next in the build.'}
      </p>
      <Card>
        <CardBody className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/12 text-primary">
            <Sparkles className="h-6 w-6" />
          </div>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{title}</span> will be built in an
            upcoming step.
          </p>
        </CardBody>
      </Card>
    </div>
  )
}
