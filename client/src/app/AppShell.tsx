import { Suspense, useEffect, useMemo, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Briefcase,
  Building2,
  Compass,
  FileText,
  Home,
  LayoutDashboard,
  LogOut,
  type LucideIcon,
  MapPin,
  MessageSquare,
  Moon,
  Search,
  Sparkles,
  Sun,
  Users,
  GraduationCap,
  BookOpen,
  Gauge,
  ShieldCheck,
  Menu,
  X,
} from 'lucide-react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTheme } from '@/lib/theme'
import { useSession, useCurrentUser } from '@/lib/store'
import { useGeo, COUNTRIES } from '@/lib/geo'
import { messagesApi, jobsApi, applicationsApi } from '@/lib/api'
import { perf } from '@/lib/perf'
import { Avatar, Input } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { PageSpinner } from '@/components/ui/Spinner'
import { Logo } from '@/components/Logo'
import { AiActivityPanel } from '@/components/AiActivityPanel'
import { NotificationsMenu } from '@/components/NotificationsMenu'
import { GlobalProgress } from '@/components/GlobalProgress'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

type NavBadges = Partial<Record<string, number>>

/** Live nav badge counts from the real backend. Refreshes on navigation and on
 *  a short interval so unread/new counts stay current without a page reload. */
function useNavBadges(userId: string | null, isCompany: boolean): NavBadges {
  const [counts, setCounts] = useState<NavBadges>({})
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const load = async () => {
      try {
        const navStart = performance.now()
        const convos = await messagesApi.conversations(userId)
        const next: NavBadges = {}
        const unread = convos.reduce((s, c) => s + (c.unread || 0), 0)
        if (unread > 0) next['/app/messages'] = unread
        if (!isCompany) {
          const [apps, jobs] = await Promise.all([applicationsApi.byStudent(userId), jobsApi.list()])
          if (apps.length) next['/app/applications'] = apps.length
          if (jobs.length) next['/app/jobs'] = jobs.length
        } else {
          const [apps, jobs] = await Promise.all([applicationsApi.byCompany(userId), jobsApi.byCompany(userId)])
          const newCount = apps.filter((a) => a.status === 'pending').length
          if (newCount > 0) next['/app/listings'] = newCount
          else if (jobs.length) next['/app/listings'] = jobs.length
        }
        if (!cancelled) setCounts(next)
        const ms = Math.round((performance.now() - navStart) * 10) / 10
        perf('nav badges refreshed', { ms, unread })
      } catch {
        /* ignore transient fetch errors */
      }
    }
    const start = window.setTimeout(load, 0)
    const t = setInterval(load, 60_000)
    return () => {
      cancelled = true
      clearTimeout(start)
      clearInterval(t)
    }
  }, [userId, isCompany])
  return counts
}

const studentNav: NavItem[] = [
  { to: '/app', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/app/jobs', label: 'Opportunities', icon: Briefcase },
  { to: '/app/research', label: 'Research', icon: Search },
  { to: '/app/applications', label: 'Applications', icon: FileText },
  { to: '/app/companies', label: 'Companies', icon: Building2 },
  { to: '/app/insights', label: 'AI Insights', icon: Sparkles },
  { to: '/app/compass', label: 'Career Compass', icon: Compass },
  { to: '/app/messages', label: 'Messages', icon: MessageSquare },
]

const companyNav: NavItem[] = [
  { to: '/app', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/app/listings', label: 'Listings & applications', icon: Briefcase },
  { to: '/app/research', label: 'Research', icon: Search },
  { to: '/app/messages', label: 'Messages', icon: MessageSquare },
  { to: '/app/company-profile', label: 'Company Profile', icon: Building2 },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const user = useCurrentUser()
  const isCompany = user?.user_type === 'company' || user?.user_type === 'school'
  // Admins get an extra "Admin" entry appended to whichever nav they're on.
  const nav = useMemo(() => {
    const base = isCompany ? companyNav : studentNav
    return user?.is_admin ? [...base, { to: '/app/admin', label: 'Admin', icon: ShieldCheck }] : base
  }, [isCompany, user?.is_admin])
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const badges = useNavBadges(user?.id ?? null, isCompany)

  useEffect(() => setMobileOpen(false), [location.pathname])

  // Focus mode: the proctored assessment gets a clean, distraction-free,
  // full-screen experience — no sidebar, top bar, mobile drawer, or AI panel.
  const isFocusMode = /^\/app\/applications\/[^/]+\/assessment$/.test(location.pathname)
  if (isFocusMode) {
    return (
      <div className="min-h-screen bg-background">
        <GlobalProgress />
        <Suspense fallback={<div className="py-24"><PageSpinner label="Loading…" /></div>}>
          {children}
        </Suspense>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <GlobalProgress />
      {/* Sidebar (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-card/40 lg:flex">
        <SidebarInner nav={nav} badges={badges} />
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/50 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-border bg-card lg:hidden"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            >
              <SidebarInner nav={nav} badges={badges} onClose={() => setMobileOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main column */}
      <div className="lg:pl-64">
        <Topbar onMenu={() => setMobileOpen(true)} />
        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
          <Suspense fallback={<div className="py-24"><PageSpinner label="Loading…" /></div>}>
            {children}
          </Suspense>
        </main>
      </div>

      {/* Always-on AI activity window (students) — shows what matching/research
          is doing in real time so it's never a black box. */}
      {!isCompany && <AiActivityPanel />}
    </div>
  )
}

function SidebarInner({ nav, badges, onClose }: { nav: NavItem[]; badges: NavBadges; onClose?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between px-5">
        <Link to="/app" className="flex items-center gap-2">
          <Logo className="h-8 w-8" />
          <span className="text-lg font-bold tracking-tight">Optryva</span>
        </Link>
        {onClose && (
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-muted lg:hidden">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {nav.map((item) => {
          const count = badges[item.to]
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/app'}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/12 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )
              }
            >
              <item.icon className="h-[18px] w-[18px]" />
              <span className="flex-1">{item.label}</span>
              {count !== undefined && (
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  {count}
                </span>
              )}
            </NavLink>
          )
        })}
      </nav>
    </div>
  )
}

function CountrySelect() {
  const { country, setCountry } = useGeo()
  const [open, setOpen] = useState(false)
  const current = COUNTRIES.find((c) => c.name === country) ?? COUNTRIES[0]
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1.5 text-sm font-medium hover:bg-muted"
      >
        <span className="text-base leading-none">{current.flag}</span>
        <span className="hidden max-w-[120px] truncate sm:inline">{current.name}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              className="absolute right-0 z-20 mt-2 max-h-80 w-56 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-card"
            >
              {COUNTRIES.map((c) => (
                <button
                  key={c.code}
                  disabled={c.disabled}
                  onClick={() => {
                    if (c.disabled) return
                    setCountry(c.name)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm',
                    c.disabled
                      ? 'cursor-not-allowed opacity-50'
                      : 'hover:bg-muted',
                    c.name === country && !c.disabled && 'bg-primary/10 text-primary',
                  )}
                >
                  <span className="text-base">{c.flag}</span>
                  <span className="flex-1 text-left">{c.name}</span>
                  {c.disabled && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Soon
                    </span>
                  )}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const { theme, toggle } = useTheme()
  const user = useCurrentUser()
  const navigate = useNavigate()
  const logout = useSession((s) => s.logout)
  const [menuOpen, setMenuOpen] = useState(false)
  const [search, setSearch] = useState('')

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md sm:px-6 lg:px-8">
      <button onClick={onMenu} className="rounded-lg p-2 hover:bg-muted lg:hidden">
        <Menu className="h-5 w-5" />
      </button>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          // Search opens the Research page in the main view (a normal in-page
          // experience), not a side drawer.
          const q = search.trim()
          navigate(q ? `/app/research?q=${encodeURIComponent(q)}` : '/app/research')
          setSearch('')
        }}
        className="flex max-w-xl flex-1 items-center gap-2"
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search opportunities by role, company, location, or skill…"
            className="h-10 rounded-full bg-muted/50 pl-9"
          />
        </div>
        <Button type="submit" className="hidden rounded-full sm:inline-flex gap-1.5">
          <Search className="h-4 w-4" /> Search
        </Button>
      </form>

      <div className="flex-1" />

      <CountrySelect />

      <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
        {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      </Button>

      <NotificationsMenu />

      <div className="relative">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="flex items-center gap-2 rounded-full p-0.5 pr-2 hover:bg-muted"
        >
          <Avatar name={user?.full_name} src={user?.avatar_url} size={34} />
        </button>
        <AnimatePresence>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.97 }}
                className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-border bg-card shadow-card"
              >
                <div className="border-b border-border p-3">
                  <p className="truncate text-sm font-semibold">{user?.full_name}</p>
                  <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
                </div>
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    navigate(user?.user_type === 'student' ? '/app/profile' : '/app/company-profile')
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted"
                >
                  <Users className="h-4 w-4" /> Profile
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    navigate('/app/usage')
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted"
                >
                  <Gauge className="h-4 w-4" /> Usage
                </button>
                <button
                  onClick={() => {
                    logout()
                    navigate('/login')
                  }}
                  className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-sm text-danger hover:bg-muted"
                >
                  <LogOut className="h-4 w-4" /> Sign out
                </button>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </header>
  )
}
