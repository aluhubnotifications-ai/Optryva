import { useState } from 'react'
import { Sparkles, FileText } from 'lucide-react'
import { aiApi } from '@/lib/api'
import type { Profile } from '@/types'
import { Card, CardBody } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'

export function TipsTab({ user }: { user: Profile }) {
  const [tips, setTips] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)

  async function generate() {
    setLoading(true)
    const t = await aiApi.cvTips(user)
    setTips(t)
    setLoading(false)
  }

  return (
    <Card>
      <CardBody>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 font-semibold"><FileText className="h-5 w-5 text-primary" /> Personalized CV Tips</h2>
            <p className="text-sm text-muted-foreground">AI suggestions based on your profile{user.cv_filename ? ` and ${user.cv_filename}` : ''}.</p>
          </div>
          <Button onClick={generate} loading={loading} className="w-full gap-1.5 sm:w-auto"><Sparkles className="h-4 w-4" /> {tips ? 'Regenerate' : 'Generate tips'}</Button>
        </div>
        {tips && (
          <ol className="mt-5 space-y-3">
            {tips.map((t, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-bold text-primary">{i + 1}</span>
                <p className="text-sm text-muted-foreground">{t}</p>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  )
}
