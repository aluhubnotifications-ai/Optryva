import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTransitionNavigate } from '@/lib/useTransitionNavigate'
import { ArrowLeft, Users, MapPin, Globe, Bell, BellOff, Briefcase, ArrowRight, Star, MessageSquare } from 'lucide-react'
import { useCurrentUser } from '@/lib/store'
import { followsApi, jobsApi, profilesApi, ratingsApi, messagesApi } from '@/lib/api'
import type { JobListing, Profile, Rating } from '@/types'
import { Card, CardBody, Badge, Avatar } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { CoverImage } from '@/components/CoverImage'
import { useToast } from '@/components/ui/toast'
import { cn, daysUntil } from '@/lib/utils'

export default function CompanyPublic() {
  const { id } = useParams()
  const navigate = useTransitionNavigate()
  const user = useCurrentUser()!
  const { toast } = useToast()
  const [company, setCompany] = useState<Profile | null>(null)
  const [jobs, setJobs] = useState<JobListing[]>([])
  const [followers, setFollowers] = useState(0)
  const [following, setFollowing] = useState(false)
  const [emailOn, setEmailOn] = useState(true)
  const [ratings, setRatings] = useState<Rating[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    if (!id) return
    const [c, allJobs, fc, myFollows, rts] = await Promise.all([
      profilesApi.get(id),
      jobsApi.list(user),
      followsApi.followerCount(id),
      followsApi.forStudent(user.id),
      ratingsApi.forRef('company', id),
    ])
    setCompany(c)
    setJobs(allJobs.filter((j) => j.company_id === id))
    setFollowers(fc)
    const mine = myFollows.find((f) => f.company_id === id)
    setFollowing(!!mine)
    setEmailOn(mine?.email_notifications ?? true)
    setRatings(rts)
    setLoading(false)
  }
  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <p className="py-20 text-center text-sm text-muted-foreground">Loading…</p>
  if (!company) return <div className="py-20 text-center"><p className="font-medium">Company not found.</p></div>

  async function toggleFollow() {
    const now = await followsApi.toggle(user.id, company!.id)
    setFollowing(now)
    setFollowers((n) => n + (now ? 1 : -1))
    toast({ title: now ? `Following ${company!.company_name}` : `Unfollowed`, description: now ? 'You will be notified about new roles.' : undefined, tone: now ? 'success' : 'info' })
  }
  async function toggleEmail() {
    const next = !emailOn
    setEmailOn(next)
    await followsApi.setEmailPref(user.id, company!.id, next)
    toast({ title: next ? 'Email alerts on' : 'Email alerts off', tone: 'info' })
  }
  async function messageCompany() {
    try {
      const threadId = await messagesApi.startDm(company!.id)
      navigate(`/app/messages?thread=${threadId}&to=${company!.id}`)
    } catch {
      toast({ title: 'Could not open chat', tone: 'error' })
    }
  }

  const avgRating = ratings.length ? (ratings.reduce((s, r) => s + r.stars, 0) / ratings.length).toFixed(1) : null

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back</button>

      {/* Header */}
      <Card className="overflow-hidden">
        <div className="h-32">
          <CoverImage src={company.cover_url} isSchool={company.user_type === 'school'} />
        </div>
        <CardBody>
          {/* Avatar overlaps the cover; actions sit on its right. Name & details
              render BELOW so the name is never over the cover photo. */}
          <div className="-mt-14 flex flex-wrap items-end justify-between gap-3">
            <Avatar name={company.company_name} src={company.avatar_url} size={96} className="rounded-2xl bg-card ring-4 ring-card shadow-card" />
            <div className="mb-1 flex max-w-full flex-wrap items-center justify-end gap-2">
              {following && (
                <Button variant="outline" size="icon" onClick={toggleEmail} title={emailOn ? 'Email alerts on' : 'Email alerts off'}>
                  {emailOn ? <Bell className="h-4 w-4 text-primary" /> : <BellOff className="h-4 w-4 text-muted-foreground" />}
                </Button>
              )}
              {user.id !== company.id && (
                <Button variant="outline" onClick={messageCompany} className="gap-1.5">
                  <MessageSquare className="h-4 w-4" /> <span className="hidden sm:inline">Message</span>
                </Button>
              )}
              <Button variant={following ? 'outline' : 'default'} onClick={toggleFollow}>{following ? 'Following' : 'Follow'}</Button>
            </div>
          </div>

          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{company.company_name}</h1>
              {company.user_type === 'school' && <Badge tone="accent">School</Badge>}
            </div>
            {(company.industry || company.company_size) && (
              <p className="mt-0.5 text-sm text-muted-foreground">{[company.industry, company.company_size].filter(Boolean).join(' · ')}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {followers} followers</span>
              {company.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {company.location}</span>}
              {avgRating && <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5 text-warning" /> {avgRating} ({ratings.length})</span>}
              {company.website && <a href={company.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><Globe className="h-3.5 w-3.5" /> Website</a>}
            </div>
          </div>

          {company.bio && <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{company.bio}</p>}
          {following && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs text-primary">
              <Bell className="h-3.5 w-3.5" /> You'll be notified {emailOn ? '(in-app + email)' : '(in-app)'} when {company.company_name} posts a new role.
            </p>
          )}
        </CardBody>
      </Card>

      {/* Open roles */}
      <div>
        <h2 className="mb-3 flex items-center gap-2 font-semibold"><Briefcase className="h-5 w-5 text-primary" /> Open roles ({jobs.length})</h2>
        {jobs.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">No open roles right now. Follow to get notified.</p>
        ) : (
          <div className="space-y-3">
            {jobs.map((j) => {
              const dl = daysUntil(j.deadline)
              return (
                <Link key={j.id} to={`/app/jobs?job=${j.id}`}>
                  <Card className="transition-shadow hover:shadow-card">
                    <CardBody className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{j.title}</p>
                        <p className="text-sm text-muted-foreground">{j.location} · {j.listing_type}{j.pay ? ` · ${j.pay}` : ''}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        {dl !== null && <Badge tone={dl <= 14 ? 'warning' : 'outline'}>{dl <= 0 ? 'Closing' : `${dl}d left`}</Badge>}
                        <ArrowRight className="hidden h-4 w-4 text-muted-foreground sm:block" />
                      </div>
                    </CardBody>
                  </Card>
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {/* Reviews */}
      {ratings.length > 0 && (
        <div>
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><Star className="h-5 w-5 text-warning" /> Reviews</h2>
          <div className="space-y-3">
            {ratings.map((r) => (
              <Card key={r.id}><CardBody>
                <div className="mb-1 flex gap-0.5">{Array.from({ length: 5 }).map((_, i) => <Star key={i} className={cn('h-4 w-4', i < r.stars ? 'fill-warning text-warning' : 'text-muted')} />)}</div>
                {r.comment && <p className="text-sm text-muted-foreground">{r.comment}</p>}
              </CardBody></Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
