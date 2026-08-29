import { Suspense, useEffect, useMemo, useRef, useState, lazy } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useTransitionNavigate } from '@/lib/useTransitionNavigate'
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
} from 'lucide-react'
import { ChevronDown, Globe, Wifi } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTheme } from '@/lib/theme'
import { useSession, useCurrentUser, useRightSidebarOpen, useHideGlobalSidebar } from '@/lib/store'
import { useGeo, COUNTRIES, useCountryStats, type Country } from '@/lib/geo'
import { messagesApi, jobsApi, applicationsApi } from '@/lib/api'
import { perf } from '@/lib/perf'
import { Avatar, Input } from '@/components/ui/primitives'
import { Button } from '@/components/ui/Button'
import { PageSpinner } from '@/components/ui/Spinner'
import { LoadingMascot } from '@/components/DancingMascot'
import { Logo } from '@/components/Logo'
import { NotificationsMenu } from '@/components/NotificationsMenu'
import { GlobalProgress } from '@/components/GlobalProgress'
// Lazy: the AI assistant panel pulls in the assistant API, activity log, match
// progress + research streams. It's a side panel, not needed for first paint, so
// deferring it keeps the initial bundle lean (faster login/dashboard mount).
const RightSidebar = lazy(() =>
  import('@/components/RightSidebar').then((m) => ({ default: m.RightSidebar })),
)

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
  const location = useLocation()
  const badges = useNavBadges(user?.id ?? null, isCompany)
  const hideGlobalSidebar = useHideGlobalSidebar()

  // Routes that use a dedicated sidebar instead of the global AI panel.
  const isDedicatedSidebarRoute =
    hideGlobalSidebar ||
    /^\/app\/listings\/[^/]+$/m.test(location.pathname) ||
    /^\/app\/applicants\/[^/]+$/m.test(location.pathname)

  // Focus mode: the proctored assessment gets a clean, distraction-free,
  // full-screen experience — no sidebar, top bar, mobile drawer, or AI panel.
  const isFocusMode = /^\/app\/applications\/[^/]+\/assessment$/.test(location.pathname)

  if (isFocusMode) {
    return (
      <div className="app-bg min-h-screen">
        <GlobalProgress />
        <Suspense fallback={<div className="py-24"><LoadingMascot label="Loading…" /></div>}>
          {children}
        </Suspense>
      </div>
    )
  }

  return (
    <div className="app-bg min-h-screen">
      <GlobalProgress />
      {/* Sidebar (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-card/40 lg:flex">
        <SidebarInner nav={nav} badges={badges} />
      </aside>

      {/* Main column */}
      <div className={cn('lg:pl-64')}>
        <Topbar />
        <main className={cn(
          'mx-auto w-full px-4 py-6 sm:px-6 lg:px-8',
          'max-w-[1600px]',
        )}>
          <Suspense fallback={<div className="py-24"><LoadingMascot label="Loading…" /></div>}>
            {children}
          </Suspense>
        </main>
      </div>

      {/* Right sidebar — integrated AI assistant, activity panel, and research.
          Replaces the old floating AssistantWidget and AiActivityPanel. Lazy:
          it streams in after first paint so it never blocks the dashboard.
          Skipped on dedicated sidebar routes (shortlist, applicant evidence)
          where a context-aware sidebar is rendered inline. */}
      {!isDedicatedSidebarRoute && (
        <Suspense fallback={null}>
          <RightSidebar mode={isCompany ? 'employer' : 'student'} />
        </Suspense>
      )}
    </div>
  )
}

function SidebarInner({ nav, badges }: { nav: NavItem[]; badges: NavBadges }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between px-5">
        <Link to="/app" className="flex items-center gap-2">
          <Logo className="h-8 w-8" />
          <span className="text-lg font-bold tracking-tight">Optryva</span>
        </Link>
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

function CountryFlag({ c }: { c: Country }) {
  if (c.flagUrl) {
    return <img src={c.flagUrl} alt="" className="h-3.5 w-5 rounded-sm object-cover shadow-sm" />
  }
  if (c.code === 'remote') return <Wifi className="h-4 w-4 text-muted-foreground" />
  return <Globe className="h-4 w-4 text-muted-foreground" />
}

function CountrySelect() {
  const user = useCurrentUser()
  const { country, setCountry } = useGeo()
  const stats = useCountryStats((s) => s.stats)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  // Employers (companies + schools) don't browse by country — the picker is a
  // student-only discovery control, so hide it for them. All hooks above must
  // run on every render so the hook count stays stable (avoids React #300).
  if (user && (user.user_type === 'company' || user.user_type === 'school')) return null
  // Merge the fixed country list with any custom country a company/school typed
  // on a listing — so students can still research those jobs by country.
  const customCountries = Object.keys(stats)
    .filter((name) => !COUNTRIES.some((c) => c.name === name))
    .map((name) => ({ code: name.slice(0, 2).toLowerCase(), name, flag: '🌍' }))
  const allCountries = [...COUNTRIES, ...customCountries]
  const current = allCountries.find((c) => c.name === country) ?? allCountries[0]

  const q = query.trim().toLowerCase()
  const filtered = q
    ? allCountries.filter((c) => c.name.toLowerCase().includes(q))
    : allCountries
  const exact = allCountries.some((c) => c.name.toLowerCase() === q)
  const canUseCustom = q.length > 0 && !exact
  const optionCount = filtered.length + (canUseCustom ? 1 : 0)

  useEffect(() => {
    if (open) {
      setQuery('')
      setHighlight(0)
      // focus the search box once the popover mounts
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => {
    setHighlight(0)
  }, [query])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  function choose(name: string) {
    setCountry(name)
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, optionCount - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (canUseCustom && highlight === filtered.length) choose(query.trim())
      else if (filtered[highlight]) choose(filtered[highlight].name)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1.5 text-sm font-medium hover:bg-muted"
      >
        <CountryFlag c={current} />
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
              className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-border bg-card p-2 shadow-card"
            >
              <div className="relative mb-1">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Search or type a country"
                  className="w-full rounded-lg border border-border bg-card py-1.5 pl-8 pr-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                />
              </div>
              <div className="max-h-72 overflow-y-auto">
                {filtered.length === 0 && !canUseCustom && (
                  <p className="px-3 py-2 text-sm text-muted-foreground">No countries match.</p>
                )}
                {filtered.map((c, i) => {
                  const st = stats[c.name]
                  const hasIntern = (st?.internships ?? 0) > 0
                  const active = c.name === country
                  return (
                    <button
                      key={c.code}
                      onClick={() => choose(c.name)}
                      onMouseEnter={() => setHighlight(i)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-muted',
                        i === highlight && 'bg-muted',
                        active && 'bg-primary/10 text-primary',
                        hasIntern && !active && 'ring-1 ring-inset ring-accent/30',
                      )}
                    >
                      <CountryFlag c={c} />
                      <span className="flex-1 text-left">{c.name}</span>
                      {hasIntern && (
                        <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                          Intern
                        </span>
                      )}
                      {st && st.total > 0 && (
                        <span className="text-xs tabular-nums text-muted-foreground">{st.total}</span>
                      )}
                    </button>
                  )
                })}
                {canUseCustom && (
                  <button
                    onClick={() => choose(query.trim())}
                    onMouseEnter={() => setHighlight(filtered.length)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-muted',
                      highlight === filtered.length && 'bg-muted',
                    )}
                  >
                    <Search className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1 text-left">Use &ldquo;{query.trim()}&rdquo;</span>
                  </button>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

function Topbar() {
  const { theme, toggle } = useTheme()
  const user = useCurrentUser()
  const navigate = useTransitionNavigate()
  const logout = useSession((s) => s.logout)
  const [menuOpen, setMenuOpen] = useState(false)
  const [search, setSearch] = useState('')
  const sidebarOpen = useRightSidebarOpen()

  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/80 backdrop-blur-md px-4 sm:px-6 lg:px-8',
      )}
    >
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

       {/* Right-side icon group. When the AI assistant sidebar is open, nudge the
          icons left so the profile picture peeks out from behind the sidebar
          instead of being fully covered. */}
      <div className={cn('ml-auto flex items-center gap-1.5', !sidebarOpen && 'translate-x-[-24px]', sidebarOpen && 'mr-[3px]')}>
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
      </div>
    </header>
  )
}
