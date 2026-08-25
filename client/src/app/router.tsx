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

/** Wrap a `lazy()` import in its own <Suspense> so every route has a boundary
 *  directly around the suspending chunk. This — combined with transition-based
 *  navigation — prevents React error #300 when a not-yet-loaded page mounts. */
function lazyRoute(factory: () => Promise<{ default: ComponentType }>) {
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
  const chunkFailed = /dynamically imported module|importing a module script failed|failed to fetch/i.test(message)
  return (
    <div className="mesh-bg flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-7 text-center shadow-card">
        <h1 className="text-xl font-bold">We couldn’t open this page</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {chunkFailed
            ? 'The app was updated while this page was open. Reload to get the latest version.'
            : 'Something went wrong while loading this page. Please try again.'}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          Reload page
        </button>
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
