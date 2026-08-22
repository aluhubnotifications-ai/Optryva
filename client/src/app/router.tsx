import { lazy, useEffect, useState } from 'react'
import { createBrowserRouter, isRouteErrorResponse, Navigate, Outlet, useRouteError } from 'react-router-dom'
import { AppShell } from '@/app/AppShell'
import { useSession, useCurrentUser } from '@/lib/store'
import { authApi } from '@/lib/api'
import { needsOnboarding } from '@/lib/matchReady'

import Landing from '@/pages/Landing'
import Login from '@/pages/auth/Login'
import Register from '@/pages/auth/Register'
import VerifyEmail from '@/pages/auth/VerifyEmail'
import ForgotPassword from '@/pages/auth/ForgotPassword'
import Onboarding from '@/pages/Onboarding'

const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Research = lazy(() => import('@/pages/Research'))
const Jobs = lazy(() => import('@/pages/student/Jobs'))
const JobDetail = lazy(() => import('@/pages/student/JobDetail'))
const Applications = lazy(() => import('@/pages/student/Applications'))
const ApplicationDetail = lazy(() => import('@/pages/student/ApplicationDetail'))
const Insights = lazy(() => import('@/pages/student/Insights'))
const Compass = lazy(() => import('@/pages/student/Compass'))
const Companies = lazy(() => import('@/pages/student/Companies'))
const CompanyPublic = lazy(() => import('@/pages/student/CompanyPublic'))
const Profile = lazy(() => import('@/pages/Profile'))

const Messages = lazy(() => import('@/pages/Messages'))
const Usage = lazy(() => import('@/pages/Usage'))
const Admin = lazy(() => import('@/pages/Admin'))
const UserProfile = lazy(() => import('@/pages/UserProfile'))

const Listings = lazy(() => import('@/pages/company/Listings'))
const ListingApplicants = lazy(() => import('@/pages/company/ListingApplicants'))
const Analytics = lazy(() => import('@/pages/company/Analytics'))
const CompanyProfile = lazy(() => import('@/pages/company/CompanyProfile'))
const ApplicantView = lazy(() => import('@/pages/company/ApplicantView'))

function RequireAuth() {
  const userId = useSession((s) => s.userId)
  const profile = useSession((s) => s.profile)
  // Refresh the persisted profile from the server on load, so changes made since
  // last login (is_admin, plan, …) take effect without a re-login.
  useEffect(() => {
    if (!userId) return
    authApi.me().then((p) => { if (p) useSession.getState().setProfile(p) })
  }, [userId])
  if (!userId) return <Navigate to="/login" replace />
  // A student can't be matched without a résumé + preferences — collect them in
  // a required onboarding step instead of failing silently later. Companies and
  // already-complete students fall straight through.
  if (needsOnboarding(profile)) return <Navigate to="/onboarding" replace />
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
  { path: '/onboarding', element: <Onboarding /> },
  {
    path: '/app',
    element: <RequireAuth />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'research', element: <Research /> },
      { path: 'jobs', element: <Jobs /> },
      { path: 'jobs/:id', element: <JobDetail /> },
      { path: 'applications', element: <Applications /> },
      { path: 'applications/:id', element: <ApplicationDetail /> },
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
      { path: 'listings/:id', element: <ListingApplicants /> },
      { path: 'analytics', element: <Analytics /> },
      { path: 'company-profile', element: <CompanyProfile /> },
      { path: 'applicants/:id', element: <ApplicantView /> },
    ],
  },
  // Convenience: /admin → the in-app admin page (guarded there).
  { path: '/admin', element: <Navigate to="/app/admin" replace /> },
  { path: '*', element: <Navigate to="/" replace /> },
])
