import { Sparkles, Gauge, MessageSquare, ListChecks, Lightbulb } from 'lucide-react'
import { useCurrentUser } from '@/lib/store'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs'
import { ResumePicker } from '@/components/ResumePicker'
import { SnapshotTab } from './insights/SnapshotTab'
import { ChatTab } from './insights/ChatTab'
import { MatchesTab } from './insights/MatchesTab'
import { TipsTab } from './insights/TipsTab'

export default function Insights() {
  const user = useCurrentUser()!
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Sparkles className="h-6 w-6 text-primary" /> AI Insights
          </h1>
          <p className="text-sm text-muted-foreground">Your personal AI career assistant.</p>
        </div>
        <ResumePicker userId={user.id} />
      </div>

      <Tabs defaultValue="snapshot">
        <TabsList>
          <TabsTrigger value="snapshot"><span className="inline-flex items-center gap-1.5"><Gauge className="h-4 w-4" /> Snapshot</span></TabsTrigger>
          <TabsTrigger value="chat"><span className="inline-flex items-center gap-1.5"><MessageSquare className="h-4 w-4" /> Chat</span></TabsTrigger>
          <TabsTrigger value="matches"><span className="inline-flex items-center gap-1.5"><ListChecks className="h-4 w-4" /> Job Matches</span></TabsTrigger>
          <TabsTrigger value="tips"><span className="inline-flex items-center gap-1.5"><Lightbulb className="h-4 w-4" /> CV Tips</span></TabsTrigger>
        </TabsList>

        <TabsContent value="snapshot" className="mt-4"><SnapshotTab user={user} /></TabsContent>
        <TabsContent value="chat" className="mt-4"><ChatTab /></TabsContent>
        <TabsContent value="matches" className="mt-4"><MatchesTab user={user} /></TabsContent>
        <TabsContent value="tips" className="mt-4"><TipsTab user={user} /></TabsContent>
      </Tabs>
    </div>
  )
}
