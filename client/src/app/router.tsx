import { lazy, Suspense, useEffect, useState } from 'react'
import { createBrowserRouter, isRouteErrorResponse, Navigate, Outlet, useRouteError } from 'react-router-dom'
import { AppShell } from '@/app/AppShell'
import { useSession, useCurrentUser } from '@/lib/store'
import { authApi } from '@/lib/api'
import { requiresProfileCompletion, isNewAccount } from '@/lib/onboarding'
import { useLocation } from 'react-router-dom'
import { Spinner } from '@/components/ui/Spinner'

import { type ComponentType } from 'react'
import Landing from '@/pages/Landing'
import Login from '@/pages/auth/Login'
import Register from '@/pages/auth/Register'
import VerifyEmail from '@/pages/auth/VerifyEmail'
import ForgotPassword from '@/pages/auth/ForgotPassword'

// Collect every lazy route factory so the app can warm all route chunks
// immediately after auth. Declared BEFORE the lazyRoute(...) calls below because
// those run at module-init time and push into this array (a hoisted function
// can be called early, but a `const` it closes over must already be initialized).
const lazyFactories: Array<() => Promise<{ default: ComponentType }>> = []
const Dashboard = lazyRoute(() => import('@/pages/Dashboard'))
const Research = lazyRoute(() => import('@/pages/Research'))
const Jobs = lazyRoute(() => import('@/pages/student/Jobs'))
const JobDetail = lazyRoute(() => import('@/pages/student/JobDetail'))
const Apply = lazyRoute(() => import('@/pages/student/Apply'))
const Applications = lazyRoute(() => import('@/pages/student/Applications'))
const ApplicationDetail = lazyRoute(() => import('@/pages/student/ApplicationDetail'))
const Assessment = lazyRoute(() => import('@/pages/student/Assessment'))
const Insights = lazyRoute(() => import('@/pages/student/Insights'))
const Compass = lazyRoute(() => import('@/pages/student/Compass'))
const Companies = lazyRoute(() => import('@/pages/student/Companies'))
const CompanyPublic = lazyRoute(() => import('@/pages/student/CompanyPublic'))
const Profile = lazyRoute(() => import('@/pages/Profile'))

const Messages = lazyRoute(() => import('@/pages/Messages'))
const Usage = lazyRoute(() => import('@/pages/Usage'))
const Admin = lazyRoute(() => import('@/pages/Admin'))
const UserProfile = lazyRoute(() => import('@/pages/UserProfile'))

const Listings = lazyRoute(() => import('@/pages/company/Listings'))
const JobEditor = lazyRoute(() => import('@/pages/company/JobEditor'))
const CompanyProfile = lazyRoute(() => import('@/pages/company/CompanyProfile'))
const ApplicantView = lazyRoute(() => import('@/pages/company/ApplicantView'))
const Onboarding = lazyRoute(() => import('@/pages/Onboarding'))
// Note: company Analytics is shown inline on the Dashboard, so there is no
// separate /app/analytics route.

function RouteFallback() {
  return (
    <div className="mesh-bg flex min-h-[60vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  )
}

/** Collect every lazy route factory so the app can warm all route chunks
 *  immediately after auth. Once a chunk is already loaded, React.lazy resolves
 *  synchronously on first render, so the post-onboarding navigation into
 *  /app/* never suspends — which is what previously threw React error #300. */
export function preloadRoutes() {
  for (const factory of lazyFactories) {
    try {
      void factory()
    } catch {
      /* preload is best-effort */
    }
  }
}

/** Wrap a `lazy()` import in its own <Suspense> so every route has a boundary
 *  directly around the suspending chunk. This — combined with transition-based
 *  navigation and preloaded chunks — prevents React error #300 when a
 *  not-yet-loaded page mounts. */
function lazyRoute(factory: () => Promise<{ default: ComponentType }>) {
  lazyFactories.push(factory)
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
  // Only accounts created in this session are held in the onboarding wizard. The
  // "new" marker comes from the `?new=1` flag the server/register sets (and the
  // OAuth callback sets for brand-new Google accounts). Returning users — even
  // ones who haven't filled every optional profile field, or who aren't yet
  // match-ready — are NEVER bounced to onboarding; they land on their Profile and
  // complete things at their leisure. (Using `needsOnboarding` here would loop
  // companies/schools, which have no résumé/skills steps in their flow.)
  if (requiresProfileCompletion(profile) && isNewAccount() && location.pathname !== '/onboarding') {
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
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
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
      { path: 'profile', element: <Profile /> },
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
