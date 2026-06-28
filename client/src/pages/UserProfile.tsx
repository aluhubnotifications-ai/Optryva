import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, MapPin, GraduationCap, Building2, Mail, Linkedin, Github, Globe, FileText, Briefcase } from 'lucide-react'
import { profilesApi } from '@/lib/api'
import type { Profile } from '@/types'
import { Card, CardBody, Badge, Avatar, Skeleton } from '@/components/ui/primitives'
import { formatDate } from '@/lib/utils'

/** Read-only profile view for ANY user by id (student / company / school).
 *  Used from the admin panel so each user opens their own profile. */
export default function UserProfile() {
  const { id } = useParams()
  const [p, setP] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    profilesApi.get(id!).then((r) => { if (active) { setP(r); setLoading(false) } })
    return () => { active = false }
  }, [id])

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl">
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
    <div className="mx-auto max-w-3xl">
      <Link to="/app/admin" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to admin
      </Link>

      <Card>
        <CardBody>
          <div className="flex items-start gap-4">
            <Avatar name={name} src={p.avatar_url} size={64} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold">{name}</h1>
                <Badge tone={isOrg ? 'accent' : 'primary'} className="capitalize">{p.user_type}</Badge>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> {p.email}</span>
                {p.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {p.location}</span>}
                <span>· joined {formatDate(p.created_at)}</span>
              </div>
              {p.bio && <p className="mt-3 text-sm text-muted-foreground">{p.bio}</p>}
            </div>
          </div>

          {/* Student details */}
          {!isOrg && (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {(p.school || p.major || p.year) && (
                <div>
                  <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><GraduationCap className="h-3.5 w-3.5" /> Education</p>
                  <p className="text-sm">{[p.school, p.major].filter(Boolean).join(' · ') || '—'}{p.year ? ` · Year ${p.year}` : ''}</p>
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
    </div>
  )
}
