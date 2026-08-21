import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2, Search, Users, MapPin, ArrowRight, Briefcase, Check, GraduationCap } from 'lucide-react'
import { useCurrentUser } from '@/lib/store'
import { followsApi, jobsApi, profilesApi } from '@/lib/api'
import type { Profile } from '@/types'
import { Card, CardBody, Badge, Avatar, Input, Skeleton } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { CoverImage } from '@/components/CoverImage'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

type Tab = 'all' | 'company' | 'school' | 'following'

export default function Companies() {
  const user = useCurrentUser()!
  const { toast } = useToast()
  const [companies, setCompanies] = useState<Profile[]>([])
  const [openCounts, setOpenCounts] = useState<Record<string, number>>({})
  const [followerCounts, setFollowerCounts] = useState<Record<string, number>>({})
  const [following, setFollowing] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<Tab>('all')

  async function load() {
    const [cs, sc, jobs, myFollows] = await Promise.all([
      profilesApi.list('company'),
      profilesApi.list('school'),
      jobsApi.list(),
      followsApi.forStudent(user.id),
    ])
    const all = [...cs, ...sc]
    const open: Record<string, number> = {}
    jobs.forEach((j) => (open[j.company_id] = (open[j.company_id] ?? 0) + 1))
    const fc = await followsApi.followerCounts(all.map((c) => c.id))
    setCompanies(all)
    setOpenCounts(open)
    setFollowerCounts(fc)
    setFollowing(new Set(myFollows.map((f) => f.company_id)))
    setLoading(false)
  }
  useEffect(() => { load() }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleFollow(id: string, name: string) {
    const nowFollowing = await followsApi.toggle(user.id, id)
    setFollowing((s) => { const n = new Set(s); nowFollowing ? n.add(id) : n.delete(id); return n })
    setFollowerCounts((c) => ({ ...c, [id]: (c[id] ?? 0) + (nowFollowing ? 1 : -1) }))
    toast({ title: nowFollowing ? `Following ${name}` : `Unfollowed ${name}`, description: nowFollowing ? 'You will be notified about new roles.' : undefined, tone: nowFollowing ? 'success' : 'info' })
  }

  const filtered = useMemo(
    () => companies.filter((c) => {
      if (q && !`${c.company_name} ${c.industry} ${c.location}`.toLowerCase().includes(q.toLowerCase())) return false
      if (tab === 'company') return c.user_type === 'company'
      if (tab === 'school') return c.user_type === 'school'
      if (tab === 'following') return following.has(c.id)
      return true
    }),
    [companies, q, tab, following],
  )

  const counts = useMemo(() => ({
    all: companies.length,
    company: companies.filter((c) => c.user_type === 'company').length,
    school: companies.filter((c) => c.user_type === 'school').length,
    following: companies.filter((c) => following.has(c.id)).length,
  }), [companies, following])

  const tabs: { key: Tab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'company', label: 'Companies' },
    { key: 'school', label: 'Schools' },
    { key: 'following', label: 'Following' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Building2 className="h-6 w-6 text-primary" /> Companies</h1>
        <p className="text-sm text-muted-foreground">Follow employers to get notified the moment they post a role.</p>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
                tab === t.key ? 'bg-primary text-primary-foreground shadow-soft' : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground',
              )}
            >
              {t.label}
              <span className={cn('rounded-full px-1.5 text-xs tabular-nums', tab === t.key ? 'bg-primary-foreground/20' : 'bg-background/60')}>{counts[t.key]}</span>
            </button>
          ))}
        </div>
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies…" className="pl-9" />
        </div>
      </div>

      {loading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <Skeleton className="h-20 w-full rounded-none" />
              <CardBody className="-mt-8">
                <Skeleton className="h-14 w-14 rounded-2xl" />
                <Skeleton className="mt-3 h-4 w-2/3" />
                <Skeleton className="mt-2 h-3 w-1/2" />
                <Skeleton className="mt-4 h-8 w-full" />
              </CardBody>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-16 text-center">
          <Building2 className="h-8 w-8 text-muted-foreground/60" />
          <p className="font-medium">No companies found</p>
          <p className="text-sm text-muted-foreground">{q ? 'Try a different search term.' : tab === 'following' ? "You're not following anyone yet." : 'Check back soon.'}</p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => {
            const isFollowing = following.has(c.id)
            const isSchool = c.user_type === 'school'
            const openRoles = openCounts[c.id] ?? 0
            return (
              <Card key={c.id} className="group flex flex-col overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-card">
                {/* Cover banner */}
                <Link to={`/app/companies/${c.id}`} className="relative block h-20 overflow-hidden">
                  <CoverImage src={c.cover_url} isSchool={isSchool} />
                  {(isSchool || isFollowing) && (
                    <div className="absolute right-2.5 top-2.5 flex gap-1.5">
                      {isSchool && <Badge tone="accent" className="bg-card/90 backdrop-blur"><GraduationCap className="h-3 w-3" /> School</Badge>}
                      {isFollowing && <Badge tone="primary" className="bg-card/90 backdrop-blur"><Check className="h-3 w-3" /> Following</Badge>}
                    </div>
                  )}
                </Link>

                <CardBody className="-mt-8 flex flex-1 flex-col">
                  <Avatar name={c.company_name} src={c.avatar_url} size={56} className="rounded-2xl bg-card ring-4 ring-card" />
                  <Link to={`/app/companies/${c.id}`} className="mt-3 font-semibold leading-tight hover:text-primary">{c.company_name}</Link>
                  <p className="truncate text-sm text-muted-foreground">{[c.industry, c.company_size].filter(Boolean).join(' · ') || '—'}</p>
                  {c.location && <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3 shrink-0" /> {c.location}</p>}

                  {/* Stats */}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                      <Users className="h-3.5 w-3.5" /> {followerCounts[c.id] ?? 0}
                    </span>
                    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs', openRoles > 0 ? 'bg-primary/12 text-primary' : 'bg-muted text-muted-foreground')}>
                      <Briefcase className="h-3.5 w-3.5" /> {openRoles} open {openRoles === 1 ? 'role' : 'roles'}
                    </span>
                  </div>

                  <div className="mt-auto flex gap-2 pt-4">
                    <Button variant={isFollowing ? 'outline' : 'default'} size="sm" className="flex-1" onClick={() => toggleFollow(c.id, c.company_name ?? 'company')}>
                      {isFollowing ? <><Check className="h-3.5 w-3.5" /> Following</> : 'Follow'}
                    </Button>
                    <Link to={`/app/companies/${c.id}`} className="flex-1">
                      <Button variant="ghost" size="sm" className="w-full gap-1">View <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></Button>
                    </Link>
                  </div>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
