import { useState } from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Building2, Save, Link2, Crown, Globe, ShieldCheck, Lock, Gauge, Briefcase, CheckCircle2, Circle } from 'lucide-react'
import { useCurrentUser, useSession } from '@/lib/store'
import { profilesApi } from '@/lib/api'
import { CountryCombobox } from '@/components/ui/CountryCombobox'
import type { Profile as ProfileT, WorkType } from '@/types'
import { Card, CardBody, Badge, Avatar, Input, Label, Textarea, Select } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { AvatarEditor } from '@/components/AvatarEditor'
import { CoverEditor } from '@/components/CoverEditor'
import { useToast } from '@/components/ui/toast'
import { AccountSecurity } from '@/pages/Profile'

  const SIZES = ['1-10', '11-50', '51-200', '201-500', '500+']
const INDUSTRIES = ['Technology', 'Finance', 'Healthcare', 'Education', 'E-commerce', 'Agriculture', 'Consulting', 'Nonprofit']
const PLAN_LABELS: Record<string, string> = { basic: 'Basic', standard: 'Standard', premium: 'Premium', free: 'Free' }
// Real, selectable countries (excludes the "All countries" pseudo-option).
// 'Remote' is allowed so distributed orgs can self-tag.


export default function CompanyProfile() {
  const user = useCurrentUser()!
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const isSchool = user.user_type === 'school'

  async function changeLogo(avatar_url: string) {
    const updated = await profilesApi.update(user.id, { avatar_url })
    if (updated) useSession.getState().setProfile(updated)
    toast({ title: 'Logo updated', tone: 'success' })
  }
  async function changeCover(cover_url: string) {
    const updated = await profilesApi.update(user.id, { cover_url })
    if (updated) useSession.getState().setProfile(updated)
    toast({ title: cover_url ? 'Cover updated' : 'Cover removed', tone: 'success' })
  }
  const [f, setF] = useState({
    company_name: user.company_name ?? '',
    industry: user.industry ?? 'Technology',
    company_size: user.company_size ?? '11-50',
    bio: user.bio ?? '',
    location: user.location ?? '',
    country: user.country ?? '',
    website: user.website ?? '',
    linkedin: user.linkedin ?? '',
    email: user.email,
    work_type: user.work_type ?? 'any',
    student_domains: (user.student_domains ?? []).join(', '),
    is_private: user.is_private ?? false,
  })

  async function save() {
    setSaving(true)
    const patch: Partial<ProfileT> = {
      company_name: f.company_name, full_name: f.company_name, industry: f.industry, company_size: f.company_size,
      bio: f.bio, location: f.location, country: f.country || undefined, website: f.website, linkedin: f.linkedin,
      work_type: f.work_type,
    }
    if (isSchool) {
      patch.student_domains = f.student_domains.split(',').map((s) => s.trim().replace(/^@/, '').replace(/^www\./, '').toLowerCase()).filter(Boolean)
      patch.is_private = f.is_private
    }
    const updated = await profilesApi.update(user.id, patch)
    if (updated) useSession.getState().setProfile(updated)
    setSaving(false)
    toast({ title: 'Company profile saved', tone: 'success' })
  }

  const checklist = [
    { label: 'Company name', done: !!f.company_name.trim() },
    { label: 'About / bio', done: !!f.bio.trim() },
    { label: 'Industry & size', done: !!(f.industry && f.company_size) },
    { label: 'Location & country', done: !!(f.location.trim() && f.country.trim()) },
    { label: 'Website or LinkedIn', done: !!(f.website.trim() || f.linkedin.trim()) },
    { label: 'Logo uploaded', done: !!user.avatar_url },
  ]
  const doneCount = checklist.filter((c) => c.done).length
  const pct = Math.round((doneCount / checklist.length) * 100)

  return (
    <motion.div
      className="mx-auto max-w-6xl"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-5">
      {/* Cover + identity */}
      <Card className="overflow-hidden">
        <CoverEditor src={user.cover_url} isSchool={isSchool} onChange={changeCover} />
        <CardBody className="-mt-12 pt-0">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <AvatarEditor name={f.company_name} src={user.avatar_url} size={96} rounded="rounded-2xl" className="ring-4 ring-card" onChange={changeLogo} />
            <Badge tone="primary" className="mb-1 gap-1"><Crown className="h-3 w-3" /> {PLAN_LABELS[user.plan] ?? user.plan} plan</Badge>
          </div>
          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{f.company_name || 'Your company'}</h1>
              {isSchool && <Badge tone="accent">School</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">{f.industry} · {f.company_size} employees</p>
          </div>
        </CardBody>
      </Card>

      {/* Details */}
      <Card>
        <CardBody className="space-y-4">
          <div className="flex items-center gap-2"><Building2 className="h-5 w-5 text-primary" /><h2 className="font-semibold">{isSchool ? 'Organization' : 'Company'} details</h2></div>
          <div><Label>{isSchool ? 'Organization' : 'Company'} name</Label><Input value={f.company_name} onChange={(e) => setF({ ...f, company_name: e.target.value })} /></div>
          <div><Label>About</Label><Textarea value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} placeholder="What you do, mission, culture…" /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label>Industry</Label><Select value={f.industry} onChange={(e) => setF({ ...f, industry: e.target.value })}>{INDUSTRIES.map((i) => <option key={i}>{i}</option>)}</Select></div>
            <div><Label>Size</Label><Select value={f.company_size} onChange={(e) => setF({ ...f, company_size: e.target.value })}>{SIZES.map((s) => <option key={s}>{s}</option>)}</Select></div>
            <div><Label>Location</Label><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="City / Remote" /></div>
            <div>
              <Label>Country</Label>
              <CountryCombobox value={f.country} onChange={(v) => setF({ ...f, country: v })} placeholder="Select or type a country" />
              <p className="mt-1 text-xs text-muted-foreground">Your listings use this country. Pick from the list or type your own — companies are locked to it when creating opportunities.</p>
            </div>
            <div><Label>Email</Label><Input value={f.email} disabled /></div>
            {!isSchool && (
              <div>
                <Label>Work preference</Label>
                <Select value={f.work_type} onChange={(e) => setF({ ...f, work_type: e.target.value as WorkType })}>
                  <option value="any">Any</option>
                  <option value="remote">Remote</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="onsite">On-site</option>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">How your team works — shown on your opportunities.</p>
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Student access & privacy (schools only) */}
      {isSchool && (
        <Card>
          <CardBody className="space-y-4">
            <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /><h2 className="font-semibold">Student access &amp; privacy</h2></div>
            <div>
              <Label>Student email domains</Label>
              <Input
                value={f.student_domains}
                onChange={(e) => setF({ ...f, student_domains: e.target.value })}
                placeholder="e.g. alueducation.com, alustudent.com"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Comma-separated. Anyone whose login email ends in one of these domains counts as your student — used for private access and “my students only” job postings.
              </p>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3">
              <input
                type="checkbox"
                checked={f.is_private}
                onChange={(e) => setF({ ...f, is_private: e.target.checked })}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span>
                <span className="flex items-center gap-1.5 font-medium"><Lock className="h-3.5 w-3.5 text-primary" /> Private school</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Only people with a matching student email domain can see your profile and your job listings. Leave off to stay public.
                </span>
              </span>
            </label>
          </CardBody>
        </Card>
      )}

      {/* Links */}
      <Card>
        <CardBody className="space-y-4">
          <div className="flex items-center gap-2"><Link2 className="h-5 w-5 text-primary" /><h2 className="font-semibold">Links</h2></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label><Globe className="mr-1 inline h-3.5 w-3.5" />Website</Label><Input value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="https://…" /></div>
            <div><Label>LinkedIn</Label><Input value={f.linkedin} onChange={(e) => setF({ ...f, linkedin: e.target.value })} placeholder="https://linkedin.com/company/…" /></div>
          </div>
        </CardBody>
      </Card>

      <div className="flex justify-end"><Button onClick={save} loading={saving} className="gap-1.5"><Save className="h-4 w-4" /> Save changes</Button></div>
        </div>

        <aside className="space-y-5 lg:sticky lg:top-6 self-start">
          {/* Quick actions */}
          <Card>
            <CardBody className="space-y-2">
              <h2 className="font-semibold">Quick actions</h2>
              <Link
                to="/app/listings/new"
                className="flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Briefcase className="h-4 w-4" /> Post an opportunity
              </Link>
              <Link
                to="/app/listings"
                className="flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
              >
                <Building2 className="h-4 w-4" /> My listings
              </Link>
              <Link
                to="/app"
                className="flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
              >
                <Gauge className="h-4 w-4" /> Analytics
              </Link>
            </CardBody>
          </Card>

          {/* Profile completeness */}
          <Card>
            <CardBody className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Profile completeness</h2>
                <span className="text-sm font-medium text-muted-foreground">{pct}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
              <ul className="space-y-1.5 text-sm">
                {checklist.map((c) => (
                  <li key={c.label} className="flex items-center gap-2">
                    {c.done ? (
                      <CheckCircle2 className="h-4 w-4 text-accent" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className={c.done ? 'text-foreground' : 'text-muted-foreground'}>{c.label}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">A complete profile attracts more applicants.</p>
            </CardBody>
          </Card>

          {/* Plan */}
          <Card>
            <CardBody className="space-y-3">
              <div className="flex items-center gap-2">
                <Crown className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Plan</h2>
              </div>
              <Badge tone="primary" className="gap-1">
                <Crown className="h-3 w-3" /> {PLAN_LABELS[user.plan] ?? user.plan} plan
              </Badge>
              <p className="text-sm text-muted-foreground">Manage seats, billing and upgrade your plan.</p>
              <Link
                to="/app/usage"
                className="flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
              >
                Manage plan
              </Link>
            </CardBody>
          </Card>

          {/* Account & Security (incl. delete account) */}
          <AccountSecurity />
        </aside>
      </div>
    </motion.div>
  )
}
