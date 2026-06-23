import { useRef, useState } from 'react'
import {
  User,
  Briefcase,
  GraduationCap,
  Link2,
  FileText,
  Upload,
  Sparkles,
  Crown,
  Mail,
  Lock,
  Trash2,
  X,
  Plus,
  Save,
  Camera,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useCurrentUser, useSession } from '@/lib/store'
import { useMatchRun } from '@/lib/matchRun'
import { profilesApi } from '@/lib/api'
import type { Profile as ProfileT, WorkType } from '@/types'
import { Card, CardBody, Badge, Avatar, Input, Label, Textarea, Select } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { AvatarEditor } from '@/components/AvatarEditor'
import { useToast } from '@/components/ui/toast'
import { formatDate, cn, fileToDataUrl } from '@/lib/utils'

const ROLES = ['Software Engineering', 'Data Science', 'Product Management', 'Marketing', 'Operations', 'Finance', 'Design', 'Consulting']
const INDUSTRIES = ['Technology', 'Finance', 'Healthcare', 'Agriculture', 'Education', 'E-commerce', 'Consulting', 'Nonprofit']

export default function Profile() {
  const user = useCurrentUser()!
  const { toast } = useToast()
  const cvRef = useRef<HTMLInputElement>(null)
  const [, force] = useState(0)
  const [saving, setSaving] = useState(false)
  const [skillInput, setSkillInput] = useState('')

  async function changePicture(avatar_url: string) {
    const updated = await profilesApi.update(user.id, { avatar_url })
    if (updated) useSession.getState().setProfile(updated)
    toast({ title: 'Profile picture updated', tone: 'success' })
  }

  // editable copy
  const [form, setForm] = useState({
    full_name: user.full_name,
    bio: user.bio ?? '',
    school: user.school ?? '',
    major: user.major ?? '',
    year: user.year ? String(user.year) : '',
    location: user.location ?? '',
    linkedin: user.linkedin ?? '',
    github: user.github ?? '',
    twitter: user.twitter ?? '',
    website: user.website ?? '',
    work_type: (user.work_type ?? 'any') as WorkType,
    open_to_internship: user.open_to_internship ?? true,
    open_to_fulltime: user.open_to_fulltime ?? true,
  })
  const [roles, setRoles] = useState<string[]>(user.desired_roles ?? [])
  const [industries, setIndustries] = useState<string[]>(user.preferred_industries ?? [])
  const [skills, setSkills] = useState<string[]>(user.skills ?? [])

  function toggle(list: string[], set: (v: string[]) => void, v: string) {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  }

  async function save() {
    setSaving(true)
    const patch: Partial<ProfileT> = {
      full_name: form.full_name,
      bio: form.bio,
      school: form.school,
      major: form.major,
      year: form.year ? Number(form.year) : undefined,
      location: form.location,
      linkedin: form.linkedin,
      github: form.github,
      twitter: form.twitter,
      website: form.website,
      work_type: form.work_type,
      open_to_internship: form.open_to_internship,
      open_to_fulltime: form.open_to_fulltime,
      desired_roles: roles,
      preferred_industries: industries,
      skills,
    }
    const updated = await profilesApi.update(user.id, patch)
    if (updated) useSession.getState().setProfile(updated)
    setSaving(false)
    toast({ title: 'Profile saved', tone: 'success' })
  }

  async function uploadCv(file?: File | null) {
    if (!file) return
    let cv_url: string
    try {
      cv_url = await fileToDataUrl(file)
    } catch (e) {
      toast({ title: 'Could not upload that file', description: e instanceof Error ? e.message : undefined, tone: 'error' })
      return
    }
    const updated = await profilesApi.update(user.id, {
      cv_filename: file.name,
      cv_url,
      cv_uploaded_at: new Date().toISOString(),
    })
    if (updated) useSession.getState().setProfile(updated)
    // New résumé → invalidate matches so the Jobs page re-runs AI matching.
    useMatchRun.getState().invalidate(user.id)
    toast({ title: 'CV uploaded', description: 'AI will re-run your matches next time you open Opportunities.', tone: 'success' })
    force((n) => n + 1)
  }

  async function viewCv() {
    if (!user.cv_url) return
    if (user.cv_url.startsWith('data:')) {
      const blob = await (await fetch(user.cv_url)).blob()
      const objUrl = URL.createObjectURL(blob)
      window.open(objUrl, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(objUrl), 60_000)
    } else {
      window.open(user.cv_url, '_blank', 'noopener')
    }
  }

  function addSkill() {
    const s = skillInput.trim()
    if (s && !skills.includes(s)) setSkills([...skills, s])
    setSkillInput('')
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Header */}
      <Card>
        <CardBody className="flex flex-wrap items-center gap-4">
          <AvatarEditor name={user.full_name} src={user.avatar_url} size={72} onChange={changePicture} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight">{user.full_name}</h1>
              {user.plan !== 'free' && <Badge tone="primary" className="gap-1"><Crown className="h-3 w-3" /> {user.plan.toUpperCase()}</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">{user.major}{user.school ? ` · ${user.school}` : ''}</p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
          <Button onClick={save} loading={saving} className="gap-1.5"><Save className="h-4 w-4" /> Save changes</Button>
        </CardBody>
      </Card>

      {/* About */}
      <Section icon={User} title="About">
        <div className="space-y-4">
          <div><Label>Full name</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
          <div><Label>Bio</Label><Textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} placeholder="A short intro about you…" /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label>School / University</Label><Input value={form.school} onChange={(e) => setForm({ ...form, school: e.target.value })} /></div>
            <div><Label>Major</Label><Input value={form.major} onChange={(e) => setForm({ ...form, major: e.target.value })} /></div>
            <div>
              <Label>Year of study</Label>
              <Select value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })}>
                <option value="">—</option>
                {[1, 2, 3, 4].map((y) => <option key={y} value={y}>Year {y}</option>)}
              </Select>
            </div>
            <div><Label>Location</Label><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="City, Country" /></div>
          </div>
        </div>
      </Section>

      {/* CV */}
      <Section icon={FileText} title="CV / Résumé">
        <input ref={cvRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => uploadCv(e.target.files?.[0])} />
        {user.cv_filename ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-success/30 bg-success/5 p-3">
            <FileText className="h-5 w-5 text-success" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user.cv_filename}</p>
              <p className="text-xs text-muted-foreground">Uploaded {user.cv_uploaded_at ? formatDate(user.cv_uploaded_at) : ''}</p>
            </div>
            {user.cv_url && <Button variant="ghost" size="sm" onClick={() => viewCv()}>View</Button>}
            <Button variant="outline" size="sm" onClick={() => cvRef.current?.click()}>Replace</Button>
          </div>
        ) : (
          <button onClick={() => cvRef.current?.click()} className="flex w-full items-center gap-3 rounded-xl border border-dashed border-input p-4 text-left hover:border-primary/40">
            <Upload className="h-5 w-5 text-muted-foreground" />
            <div><p className="text-sm font-medium">Upload your CV</p><p className="text-xs text-muted-foreground">PDF or Word — powers your AI matches</p></div>
          </button>
        )}
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Sparkles className="h-3.5 w-3.5 text-primary" /> Your CV is the primary signal the AI matcher uses.</p>
      </Section>

      {/* Career preferences */}
      <Section icon={Briefcase} title="Career preferences" hint="Feeds the AI matching engine">
        <Label>Roles I'm interested in</Label>
        <ChipGroup options={ROLES} selected={roles} onToggle={(v) => toggle(roles, setRoles, v)} />
        <Label className="mt-4">Industries</Label>
        <ChipGroup options={INDUSTRIES} selected={industries} onToggle={(v) => toggle(industries, setIndustries, v)} />

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Work type</Label>
            <Select value={form.work_type} onChange={(e) => setForm({ ...form, work_type: e.target.value as WorkType })}>
              <option value="any">Any</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">On-site</option>
            </Select>
          </div>
          <div className="flex items-end gap-4">
            <Toggle label="Open to internships" checked={form.open_to_internship} onChange={(v) => setForm({ ...form, open_to_internship: v })} />
            <Toggle label="Open to full-time" checked={form.open_to_fulltime} onChange={(v) => setForm({ ...form, open_to_fulltime: v })} />
          </div>
        </div>

        <Label className="mt-4">Skills</Label>
        <div className="flex flex-wrap gap-1.5">
          {skills.map((s) => (
            <span key={s} className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2.5 py-1 text-xs font-medium text-primary">
              {s}<button onClick={() => setSkills(skills.filter((x) => x !== s))}><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); addSkill() }} className="mt-2 flex gap-2">
          <Input value={skillInput} onChange={(e) => setSkillInput(e.target.value)} placeholder="Add a skill…" className="max-w-xs" />
          <Button type="submit" variant="outline" size="icon"><Plus className="h-4 w-4" /></Button>
        </form>
      </Section>

      {/* Social */}
      <Section icon={Link2} title="Links">
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label>LinkedIn</Label><Input value={form.linkedin} onChange={(e) => setForm({ ...form, linkedin: e.target.value })} placeholder="https://linkedin.com/in/…" /></div>
          <div><Label>GitHub</Label><Input value={form.github} onChange={(e) => setForm({ ...form, github: e.target.value })} placeholder="https://github.com/…" /></div>
          <div><Label>Twitter / X</Label><Input value={form.twitter} onChange={(e) => setForm({ ...form, twitter: e.target.value })} /></div>
          <div><Label>Website</Label><Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></div>
        </div>
      </Section>

      <div className="flex justify-end">
        <Button onClick={save} loading={saving} className="gap-1.5"><Save className="h-4 w-4" /> Save changes</Button>
      </div>

      <AccountSecurity />
    </div>
  )
}

function Section({ icon: Icon, title, hint, children }: { icon: typeof User; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardBody>
        <div className="mb-4 flex items-center gap-2">
          <Icon className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">{title}</h2>
          {hint && <Badge tone="outline" className="ml-auto text-[11px]">{hint}</Badge>}
        </div>
        {children}
      </CardBody>
    </Card>
  )
}

function ChipGroup({ options, selected, onToggle }: { options: string[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o)
        return (
          <button key={o} onClick={() => onToggle(o)} className={cn('rounded-full border px-3 py-1.5 text-sm transition-colors', on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}>
            {o}
          </button>
        )
      })}
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} className="flex items-center gap-2 text-sm">
      <span className={cn('relative h-5 w-9 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-muted')}>
        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </span>
      <span className="text-muted-foreground">{label}</span>
    </button>
  )
}

/* ---------- Account & Security (shared component) ---------- */
function AccountSecurity() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const logout = useSession((s) => s.logout)
  const [modal, setModal] = useState<null | 'email' | 'password' | 'delete'>(null)

  return (
    <Card>
      <CardBody>
        <div className="mb-4 flex items-center gap-2">
          <Lock className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Account & Security</h2>
        </div>
        <div className="divide-y divide-border">
          <Row icon={Mail} title="Change email" desc="Update your sign-in email" onClick={() => setModal('email')} />
          <Row icon={Lock} title="Change password" desc="Use a strong, unique password" onClick={() => setModal('password')} />
          <Row icon={Trash2} title="Delete account" desc="Permanently remove your account & data" danger onClick={() => setModal('delete')} />
        </div>
      </CardBody>

      {/* Change email */}
      <Modal open={modal === 'email'} onClose={() => setModal(null)} size="sm" title="Change email">
        <form onSubmit={(e) => { e.preventDefault(); setModal(null); toast({ title: 'Email updated (demo)', tone: 'success' }) }} className="space-y-3">
          <div><Label>Current password</Label><Input type="password" required /></div>
          <div><Label>New email</Label><Input type="email" required /></div>
          <div className="flex justify-end gap-2 pt-2"><Button variant="ghost" type="button" onClick={() => setModal(null)}>Cancel</Button><Button type="submit">Update</Button></div>
        </form>
      </Modal>

      {/* Change password */}
      <Modal open={modal === 'password'} onClose={() => setModal(null)} size="sm" title="Change password">
        <form onSubmit={(e) => { e.preventDefault(); setModal(null); toast({ title: 'Password changed (demo)', tone: 'success' }) }} className="space-y-3">
          <div><Label>Current password</Label><Input type="password" required /></div>
          <div><Label>New password</Label><Input type="password" required /></div>
          <div className="flex justify-end gap-2 pt-2"><Button variant="ghost" type="button" onClick={() => setModal(null)}>Cancel</Button><Button type="submit">Update</Button></div>
        </form>
      </Modal>

      {/* Delete */}
      <Modal open={modal === 'delete'} onClose={() => setModal(null)} size="sm" title="Delete account?" description="This is irreversible and removes all your applications, messages, and data.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => { setModal(null); logout(); toast({ title: 'Account deleted (demo)', tone: 'info' }); navigate('/') }}>Delete forever</Button>
        </div>
      </Modal>
    </Card>
  )
}

function Row({ icon: Icon, title, desc, onClick, danger }: { icon: typeof Mail; title: string; desc: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 py-3 text-left hover:bg-muted/40">
      <Icon className={cn('h-5 w-5', danger ? 'text-danger' : 'text-muted-foreground')} />
      <div className="flex-1">
        <p className={cn('text-sm font-medium', danger && 'text-danger')}>{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </button>
  )
}
