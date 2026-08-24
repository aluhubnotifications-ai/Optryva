import { useState } from 'react'
import { Building2, Save, Link2, Crown, Globe, ShieldCheck, Lock } from 'lucide-react'
import { useCurrentUser, useSession } from '@/lib/store'
import { profilesApi } from '@/lib/api'
import { CountryCombobox } from '@/components/ui/CountryCombobox'
import type { Profile as ProfileT } from '@/types'
import { Card, CardBody, Badge, Avatar, Input, Label, Textarea, Select } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { AvatarEditor } from '@/components/AvatarEditor'
import { CoverEditor } from '@/components/CoverEditor'
import { useToast } from '@/components/ui/toast'

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
    student_domains: (user.student_domains ?? []).join(', '),
    is_private: user.is_private ?? false,
  })

  async function save() {
    setSaving(true)
    const patch: Partial<ProfileT> = {
      company_name: f.company_name, full_name: f.company_name, industry: f.industry, company_size: f.company_size,
      bio: f.bio, location: f.location, country: f.country || undefined, website: f.website, linkedin: f.linkedin,
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

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Cover + identity */}
      <Card className="overflow-hidden">
        <CoverEditor src={user.cover_url} isSchool={isSchool} onChange={changeCover} />
        <CardBody className="-mt-10">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-end gap-3">
              <AvatarEditor name={f.company_name} src={user.avatar_url} size={72} rounded="rounded-2xl" onChange={changeLogo} />
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold tracking-tight">{f.company_name || 'Your company'}</h1>
                  {isSchool && <Badge tone="accent">School</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{f.industry} · {f.company_size} employees</p>
              </div>
            </div>
            <Badge tone="primary" className="gap-1"><Crown className="h-3 w-3" /> {PLAN_LABELS[user.plan] ?? user.plan} plan</Badge>
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
  )
}
