import { Navigate, useParams } from 'react-router-dom'

// The full, rich job posting renders in the Jobs board detail pane
// (/app/jobs?job=<id>). Redirect the legacy /app/jobs/:id route there so every
// job — seeded or newly created — shows its complete description, benefits,
// responsibilities, qualifications, and match analysis.
export default function JobDetail() {
  const { id } = useParams()
  return <Navigate to={id ? `/app/jobs?job=${id}` : '/app/jobs'} replace />
}
