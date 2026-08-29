import { lazy, Suspense, useEffect, useState } from 'react'
import { createBrowserRouter, isRouteErrorResponse, Navigate, Outlet, useRouteError } from 'react-router-dom'
import { AppShell } from '@/app/AppShell'
import { useSession, useCurrentUser } from '@/lib/store'
import { authApi } from '@/lib/api'
import { requiresProfileCompletion, isNewAccount } from '@/lib/onboarding'
import { useLocation } from 'react-router-dom'
import { Spinner } from '@/components/ui/Spinner'
import { DancingMascot } from '@/components/DancingMascot'

import { type ComponentType } from 'react'
import Landing from '@/pages/Landing'
import Login from '@/pages/auth/Login'
import Register from '@/pages/auth/Register'
import VerifyEmail from '@/pages/auth/VerifyEmail'
import ForgotPassword from '@/pages/auth/ForgotPassword'

// Collect every lazy route factory so the app can warm a subset on boot.
// Declared BEFORE the lazyRoute(...) calls below because those run at module-init
// time and push into this array.
type Factory = { name: string; fn: () => Promise<{ default: ComponentType }> }
const lazyFactories: Factory[] = []
const Dashboard = lazyRoute('Dashboard', () => import('@/pages/Dashboard'))
const Research = lazyRoute('Research', () => import('@/pages/Research'))
const Jobs = lazyRoute('Jobs', () => import('@/pages/student/Jobs'))
const JobDetail = lazyRoute('JobDetail', () => import('@/pages/student/JobDetail'))
const Apply = lazyRoute('Apply', () => import('@/pages/student/Apply'))
const Applications = lazyRoute('Applications', () => import('@/pages/student/Applications'))
const ApplicationDetail = lazyRoute('ApplicationDetail', () => import('@/pages/student/ApplicationDetail'))
const Assessment = lazyRoute('Assessment', () => import('@/pages/student/Assessment'))
const Insights = lazyRoute('Insights', () => import('@/pages/student/Insights'))
const Compass = lazyRoute('Compass', () => import('@/pages/student/Compass'))
const Companies = lazyRoute('Companies', () => import('@/pages/student/Companies'))
const CompanyPublic = lazyRoute('CompanyPublic', () => import('@/pages/student/CompanyPublic'))
const Profile = lazyRoute('Profile', () => import('@/pages/Profile'))

const Messages = lazyRoute('Messages', () => import('@/pages/Messages'))
const Usage = lazyRoute('Usage', () => import('@/pages/Usage'))
const Admin = lazyRoute('Admin', () => import('@/pages/Admin'))
const UserProfile = lazyRoute('UserProfile', () => import('@/pages/UserProfile'))

const Listings = lazyRoute('Listings', () => import('@/pages/company/Listings'))
const JobEditor = lazyRoute('JobEditor', () => import('@/pages/company/JobEditor'))
const CompanyProfile = lazyRoute('CompanyProfile', () => import('@/pages/company/CompanyProfile'))
const ApplicantView = lazyRoute('ApplicantView', () => import('@/pages/company/ApplicantView'))
const Onboarding = lazyRoute('Onboarding', () => import('@/pages/Onboarding'))
// Note: company Analytics is shown inline on the Dashboard, so there is no
// separate /app/analytics route.

// Account-aware profile route: students get the student editor while companies
// and schools get the org profile — regardless of which link they clicked or any
// stale cached user_type (the old "I see the student profile until I refresh").
function ProfileRoute() {
  const user = useCurrentUser()
  if (user && (user.user_type === 'company' || user.user_type === 'school')) {
    return <CompanyProfile />
  }
  return <Profile />
}

function RouteFallback() {
  return (
    <div className="mesh-bg flex min-h-[60vh] items-center justify-center">
        <DancingMascot size={80} />
    </div>
  )
}

// The most common "first route after login" pages — preloaded eagerly so the
// first navigation into /app/* never has to lazy-load and suspend (React error
// #300). Deliberately EXCLUDES the heavy-on-demand routes: Assessment
// (-> @tensorflow/tfjs blazeface, ~590 KB) and Analytics/Dashboard-charts
// (-> recharts, ~360 KB). Those stay truly lazy so the initial page load is
// fast and the user only pays for a heavy module if they actually visit it.
const PRELOAD_ROUTES = new Set([
  'Dashboard',
  'Profile',
  'CompanyProfile',
  'Listings',
  'Applications',
  'Jobs',
  'Messages',
])

/** Preload only the lightweight first-navigation routes (default), or an
 *  explicit subset by name. Heavy modules (tfjs, recharts) are never preloaded
 *  here — they're fetched on actual navigation into their route. */
export function preloadRoutes(names?: string[]) {
  const allow = names ? new Set(names) : PRELOAD_ROUTES
  for (const { name, fn } of lazyFactories) {
    if (!allow.has(name)) continue
    try {
      void fn()
    } catch {
      /* preload is best-effort */
    }
  }
}

/** Wrap a `lazy()` import in its own <Suspense> so every route has a boundary
 *  directly around the suspending chunk. This — combined with transition-based
 *  navigation and preloaded chunks — prevents React error #300 when a
 *  not-yet-loaded page mounts. */
function lazyRoute(name: string, factory: () => Promise<{ default: ComponentType }>) {
  lazyFactories.push({ name, fn: factory })
  const Component = lazy(factory)
  return function LazyRoute() {
    return (
      <Suspense fallback={<RouteFallback />}>
        <Component />
      </Suspense>
    )
  }
}

function RequireAuth() {
  const userId = useSession((s) => s.userId)
  const profile = useSession((s) => s.profile)
  // Persisted "still owes onboarding" flag: set true the moment a user opens the
  // wizard, cleared in finish(). Survives a refresh, so an unfinished student OR
  // company/school is sent straight back to /onboarding instead of landing on the
  // dashboard with a half-finished profile.
  const needsOnb = useSession((s) => (s.userId ? !!s.needsOnboarding[s.userId] : false))
  const location = useLocation()
  // Refresh the persisted profile from the server on load, so changes made since
  // last login (is_admin, plan, …) take effect without a re-login.
  useEffect(() => {
    if (!userId) return
    authApi.me().then((p) => { if (p) useSession.getState().setProfile(p) })
  }, [userId])
  if (!userId) return <Navigate to="/login" replace />
  // Wait for the session profile to load before rendering — otherwise `Profile`
  // (and this guard's own completion check) can briefly see a null user and throw,
  // which surfaces as a flash of the route error before the real profile appears.
  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Loading your profile…" />
      </div>
    )
  }
  // Accounts created in this session (the `?new=1` marker) AND any account that
  // started but hasn't finished onboarding (persisted `needsOnboarding` flag) are
  // held in the wizard until the required steps are done. Returning users who
  // never started onboarding, or who already finished it, are NOT bounced — they
  // land on their Profile / dashboard and complete optional fields at leisure.
  // Only bounce to the wizard when the profile is genuinely incomplete. A profile
  // that already satisfies completion must never be sent to /onboarding — otherwise
  // a stale `needsOnboarding` flag would bounce completed users to the wizard, which
  // then immediately pushes them on to /app/profile on login.
  if (
    location.pathname !== '/onboarding' &&
    requiresProfileCompletion(profile) &&
    (needsOnb || isNewAccount())
  ) {
    return <Navigate to="/onboarding" replace />
  }
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}

/** Admin-only guard. Refreshes the profile first so a stale (pre-admin) session
 *  isn't bounced; only redirects non-admins once the fresh profile is in. */
function RequireAdmin() {
  const user = useCurrentUser()
  const [checked, setChecked] = useState(false)
  useEffect(() => {
    authApi.me()
      .then((p) => { if (p) useSession.getState().setProfile(p) })
      .finally(() => setChecked(true))
  }, [])
  if (!user || !checked) return null // wait for the fresh profile before deciding
  if (!user.is_admin) return <Navigate to="/app" replace />
  return <Outlet />
}

/** Students track applications they submitted; companies review inside Listings. */
function ApplicationsRoute() {
  const user = useCurrentUser()!
  const isCompany = user.user_type === 'company' || user.user_type === 'school'
  if (isCompany) return <Navigate to="/app/listings" replace />
  return <Applications />
}

function RouteError() {
  const error = useRouteError()
  const message = error instanceof Error ? error.message : isRouteErrorResponse(error) ? error.statusText : ''
  // Try multiple places where componentStack might live (React Router attaches it directly)
  const stack = (error as any)?.componentStack 
    || (error instanceof Error ? (error as Error & { componentStack?: string }).componentStack : undefined)
  const chunkFailed = /dynamically imported module|importing a module script failed|failed to fetch/i.test(message)

  // 10-second lock so you can read/copy the stack before any navigation
  const [lock, setLock] = useState(true)
  const [countdown, setCountdown] = useState(10)
  useEffect(() => {
    const id = setInterval(() => setCountdown(c => c - 1), 1000)
    const t = setTimeout(() => setLock(false), 10000)
    return () => { clearInterval(id); clearTimeout(t) }
  }, [])

  // Log full stack to console with unmistakable prefix
  useEffect(() => {
    if (stack) {
      console.error('🚨 ROUTE ERROR FULL STACK:', message)
      console.error('🚨 COMPONENT STACK:\n', stack)
    }
  }, [message, stack])

  const copyStack = () => {
    navigator.clipboard.writeText(`${message}\n\n${stack || 'no stack'}`)
    alert('Full error stack copied to clipboard!')
  }

  const goProfile = () => {
    window.location.href = '/app/profile'
  }

  const handleReload = () => {
    if (!lock) window.location.reload()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-4xl rounded-2xl border-2 border-destructive bg-card p-6 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between gap-4 mb-4">
          <h1 className="text-2xl font-bold text-destructive">🚨 Route Error — Full Stack Below</h1>
          {stack && (
            <button
              type="button"
              onClick={copyStack}
              className="flex-shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Copy Stack
            </button>
          )}
        </div>

        <p className="mb-4 text-sm text-muted-foreground">
          {chunkFailed
            ? 'The app was updated while this page was open. Reload to get the latest version.'
            : 'Something went wrong while loading this page. Check the stack below.'}
        </p>

        {lock && (
          <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-center">
            <span className="font-mono text-lg font-bold text-destructive">
              Locked for {countdown}s — navigation blocked so you can copy the stack
            </span>
          </div>
        )}

        {stack ? (
          <div className="rounded-lg border border-border bg-background p-4 text-left overflow-auto max-h-[70vh]">
            <pre className="text-[12px] font-mono text-foreground whitespace-pre-wrap break-all">
              {`${message}\n\n${stack}`}
            </pre>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No component stack available.</p>
        )}

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={handleReload}
            disabled={lock}
            className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {lock ? `Reload Page (${countdown}s)` : 'Reload Page'}
          </button>
          {stack && (
            <button
              type="button"
              onClick={copyStack}
              className="flex-1 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Copy Stack
            </button>
          )}
          {!lock && (
            <button
              type="button"
              onClick={goProfile}
              className="flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90"
            >
              Continue to Profile
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export const router = createBrowserRouter([
  { path: '/', element: <Landing />, errorElement: <RouteError /> },
  { path: '/login', element: <Login /> },
  { path: '/register', element: <Register /> },
  { path: '/verify-email', element: <VerifyEmail /> },
  { path: '/forgot-password', element: <ForgotPassword /> },
  { path: '/role-selection', element: <Navigate to="/onboarding" replace /> },
  {
    path: '/onboarding',
    element: (
      <Suspense
        fallback={
          <div className="mesh-bg flex min-h-screen items-center justify-center">
              <DancingMascot size={80} />
          </div>
        }
      >
        <Onboarding />
      </Suspense>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/app',
    element: <RequireAuth />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'research', element: <Research /> },
      { path: 'jobs', element: <Jobs /> },
      { path: 'jobs/:id', element: <JobDetail /> },
      { path: 'apply/:jobId', element: <Apply /> },
      { path: 'applications', element: <ApplicationsRoute /> },
      { path: 'applications/:id', element: <ApplicationDetail /> },
      { path: 'applications/:id/assessment', element: <Assessment /> },
      { path: 'insights', element: <Insights /> },
      { path: 'compass', element: <Compass /> },
      { path: 'companies', element: <Companies /> },
      { path: 'companies/:id', element: <CompanyPublic /> },
      { path: 'messages', element: <Messages /> },
      { path: 'profile', element: <ProfileRoute /> },
      { path: 'usage', element: <Usage /> },
      { path: 'admin', element: <RequireAdmin />, children: [{ index: true, element: <Admin /> }] },
      { path: 'u/:id', element: <UserProfile /> },
      { path: 'listings', element: <Listings /> },
      { path: 'listings/new', element: <JobEditor /> },
      { path: 'listings/:id/edit', element: <JobEditor /> },
      { path: 'listings/:id', element: <Listings /> },
      { path: 'company-profile', element: <CompanyProfile /> },
      { path: 'applicants/:id', element: <ApplicantView /> },
    ],
  },
  // Convenience: /admin → the in-app admin page (guarded there).
  { path: '/admin', element: <Navigate to="/app/admin" replace /> },
  { path: '*', element: <Navigate to="/" replace /> },
])
