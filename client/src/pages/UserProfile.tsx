import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, MapPin, GraduationCap, Building2, Mail, Linkedin, Github, Globe, FileText, Briefcase, Sparkles } from 'lucide-react'
import { profilesApi, evidenceApi } from '@/lib/api'
import type { Profile } from '@/types'
import { Card, CardBody, Badge, Avatar, Skeleton } from '@/components/ui/primitives'
import { EvidenceGallery } from '@/components/EvidenceGallery'
import { DancingMascot } from '@/components/DancingMascot'
import { formatDate } from '@/lib/utils'

/** Read-only profile view for ANY user by id (student / company / school).
 *  Used from the admin panel so each user opens their own profile. */
export default function UserProfile() {
  const { id } = useParams()
  const [p, setP] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [evidenceSummary, setEvidenceSummary] = useState<EvidenceSummary | null>(null)
  const [evidenceLoading, setEvidenceLoading] = useState(false)

  type EvidenceSummary = {
  overview: string
  bullets: string[]
}

function parseSummary(raw: string): EvidenceSummary {
  // Strip emojis and markdown bold markers
  let cleaned = raw
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/[^\S]?\*[^\S]?/g, ' ')
    .replace(/[\u2605\u2606\u2B50\ud83c\udf89\ud83c\ud83c\udd8c\ufe0f]/g, '')
    .trim()

  // Split into overview + bullets. Bullets are separated by " – " (en-dash)
  // or start with "- " after "Evidence highlights".
  const highlightsIdx = cleaned.search(/evidence highlights/i)
  let overview = cleaned
  let bullets: string[] = []

  if (highlightsIdx !== -1) {
    overview = cleaned.slice(0, highlightsIdx).trim()
    const rest = cleaned.slice(highlightsIdx)
    // Split on "– " (en-dash space) or newlines with dashes
    const rawBullets = rest
      .replace(/^evidence highlights\s*/i, '')
      .split(/(?:\n\s*–\s*|\n\s*-\s*|--\s)/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    bullets = rawBullets
  } else {
    // Try splitting on en-dash separated list
    const dashSplit = cleaned.split(/(?:\n\s*–\s*|\n\s*-\s*)/).map((s) => s.trim()).filter(Boolean)
    if (dashSplit.length > 1) {
      overview = dashSplit[0]
      bullets = dashSplit.slice(1)
    }
  }

  return { overview, bullets }
}

  useEffect(() => {
    let active = true
    setLoading(true)
    profilesApi.get(id!).then((r) => { if (active) { setP(r); setLoading(false) } })
    return () => { active = false }
  }, [id])

  useEffect(() => {
    if (!p || p.user_type !== 'student') return
    let active = true
    setEvidenceLoading(true)
    evidenceApi.summary(p.id).then((s) => { if (active && s) setEvidenceSummary(parseSummary(s.summary)) }).catch(() => {})
      .finally(() => active && setEvidenceLoading(false))
    return () => { active = false }
  }, [p])

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card><CardBody className="space-y-3"><Skeleton className="h-16 w-16 rounded-full" /><Skeleton className="h-5 w-1/3" /><Skeleton className="h-3 w-1/2" /></CardBody></Card>
      </div>
    )
  }
  if (!p) return <div className="py-20 text-center"><p className="font-medium">Profile not found.</p></div>

  const isOrg = p.user_type === 'company' || p.user_type === 'school'
  const name = isOrg ? (p.company_name || p.full_name) : p.full_name
  const links = [
    p.linkedin && { icon: Linkedin, label: 'LinkedIn', href: p.linkedin },
    p.github && { icon: Github, label: 'GitHub', href: p.github },
    p.website && { icon: Globe, label: 'Website', href: p.website },
  ].filter(Boolean) as { icon: typeof Globe; label: string; href: string }[]

  return (
     <div className="mx-auto max-w-7xl">
      {p.cover_url && (
        <div className="h-44 w-full overflow-hidden rounded-xl bg-gradient-to-r from-primary/30 to-accent/20">
          <img src={p.cover_url} alt="Cover" className="h-full w-full object-cover" />
        </div>
      )}
      <Link to="/app/admin" className="mb-4 mt-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to admin
      </Link>

      <Card className={p.cover_url ? '-mt-12 relative z-10' : ''}>
        <CardBody className="pt-0">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <Avatar name={name} src={p.avatar_url} size={88} className="rounded-2xl ring-4 ring-card" />
            <Badge tone={isOrg ? 'accent' : 'primary'} className="mb-1 capitalize">{p.user_type}</Badge>
          </div>
          <div className="mt-3">
            <h1 className="text-2xl font-bold tracking-tight">{name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> {p.email}</span>
              {p.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {p.location}</span>}
              <span>· joined {formatDate(p.created_at)}</span>
            </div>
            {p.bio && <p className="mt-3 text-sm text-muted-foreground">{p.bio}</p>}
          </div>

          {/* Student details */}
          {!isOrg && (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {(p.school || p.major || p.year) && (
                <div>
                  <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><GraduationCap className="h-3.5 w-3.5" /> Education</p>
                  <p className="text-sm">{[p.school, p.major].filter(Boolean).join(' · ') || '—'}{p.year ? ` · Year ${p.year}` : p.graduated ? ' · Graduate' : ''}</p>
                </div>
              )}
              {p.desired_roles && p.desired_roles.length > 0 && (
                <div>
                  <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Briefcase className="h-3.5 w-3.5" /> Desired roles</p>
                  <p className="text-sm">{p.desired_roles.join(', ')}</p>
                </div>
              )}
            </div>
          )}

          {/* Org details */}
          {isOrg && (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Building2 className="h-3.5 w-3.5" /> Organization</p>
                <p className="text-sm">{[p.industry, p.company_size].filter(Boolean).join(' · ') || '—'}</p>
              </div>
              <div className="flex items-end">
                <Link to={`/app/companies/${p.id}`} className="text-sm font-medium text-primary hover:underline">View public page & listings →</Link>
              </div>
            </div>
          )}

          {/* Skills */}
          {p.skills && p.skills.length > 0 && (
            <div className="mt-5">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Skills</p>
              <div className="flex flex-wrap gap-1.5">
                {p.skills.map((s) => <Badge key={s} tone="success" className="text-[11px]">{s}</Badge>)}
              </div>
            </div>
          )}

          {/* CV + links */}
          <div className="mt-5 flex flex-wrap items-center gap-3 text-sm">
            {p.cv_filename && <span className="inline-flex items-center gap-1 text-muted-foreground"><FileText className="h-4 w-4" /> CV on file</span>}
            {links.map((l) => (
              <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                <l.icon className="h-4 w-4" /> {l.label}
              </a>
            ))}
          </div>
        </CardBody>
      </Card>

       {/* Evidence section — reviewers land here from employer AI summary */}
        {!isOrg && (
          <div className="mt-6">
            <h2 className="mb-4 text-xl font-bold tracking-tight">Portfolio & evidence</h2>
            {evidenceLoading ? (
              <Card>
                <CardBody>
               <div className="flex items-center gap-2">
                     <DancingMascot size={20} />
                     <span className="text-sm text-muted-foreground">Building AI summary…</span>
                  </div>
                </CardBody>
              </Card>
            ) : evidenceSummary ? (
              <Card className="bg-gradient-to-br from-primary/5 via-card to-accent/5">
                <CardBody>
                  <div className="mb-3 flex items-center gap-2">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <Sparkles className="h-4 w-4 text-primary" />
                    </div>
                    <h3 className="text-lg font-semibold">AI evidence summary</h3>
                  </div>
                  {evidenceSummary.overview && (
                    <p className="text-xs leading-normal text-foreground/80">{evidenceSummary.overview}</p>
                  )}
                  {evidenceSummary.bullets.length > 0 && (
                    <ul className="mt-2 space-y-1.5 pl-4 text-xs text-foreground/80 marker:text-primary">
                      {evidenceSummary.bullets.map((b, i) => (
                        <li key={i} className="leading-normal">{b}</li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>
            ) : null}
            <EvidenceGallery studentId={p.id} mode="viewer" />
          </div>
        )}
    </div>
  )
}
