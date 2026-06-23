import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom'
import { AppShell } from '@/app/AppShell'
import { useSession } from '@/lib/store'

import Landing from '@/pages/Landing'
import Login from '@/pages/auth/Login'
import Register from '@/pages/auth/Register'
import VerifyEmail from '@/pages/auth/VerifyEmail'
import ForgotPassword from '@/pages/auth/ForgotPassword'
import Onboarding from '@/pages/Onboarding'

import Dashboard from '@/pages/Dashboard'
import Jobs from '@/pages/student/Jobs'
import JobDetail from '@/pages/student/JobDetail'
import Applications from '@/pages/student/Applications'
import ApplicationDetail from '@/pages/student/ApplicationDetail'
import Insights from '@/pages/student/Insights'
import Compass from '@/pages/student/Compass'
import Companies from '@/pages/student/Companies'
import CompanyPublic from '@/pages/student/CompanyPublic'
import Profile from '@/pages/Profile'

import Messages from '@/pages/Messages'
import Billing from '@/pages/Billing'

import Listings from '@/pages/company/Listings'
import ListingApplicants from '@/pages/company/ListingApplicants'
import Analytics from '@/pages/company/Analytics'
import CompanyProfile from '@/pages/company/CompanyProfile'
import ApplicantView from '@/pages/company/ApplicantView'

function RequireAuth() {
  const userId = useSession((s) => s.userId)
  const onboarded = useSession((s) => s.onboarded)
  if (!userId) return <Navigate to="/login" replace />
  if (!onboarded[userId]) return <Navigate to="/onboarding" replace />
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}

export const router = createBrowserRouter([
  { path: '/', element: <Landing /> },
  { path: '/login', element: <Login /> },
  { path: '/register', element: <Register /> },
  { path: '/verify-email', element: <VerifyEmail /> },
  { path: '/forgot-password', element: <ForgotPassword /> },
  { path: '/onboarding', element: <Onboarding /> },
  {
    path: '/app',
    element: <RequireAuth />,
    children: [
      { index: true, element: <Dashboard /> },
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
      { path: 'billing', element: <Billing /> },
      { path: 'listings', element: <Listings /> },
      { path: 'listings/:id', element: <ListingApplicants /> },
      { path: 'analytics', element: <Analytics /> },
      { path: 'company-profile', element: <CompanyProfile /> },
      { path: 'applicants/:id', element: <ApplicantView /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
