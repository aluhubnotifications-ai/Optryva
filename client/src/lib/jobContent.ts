import type { JobListing } from '@/types'

// Builds the student-facing posting body from ONLY what's stored on the job.
// No templated/hardcoded filler: sections the company left empty come back empty
// so the UI can omit them, instead of inventing responsibilities, qualifications,
// benefits, or "why you're a great fit" copy the role never actually specified.

export interface JobContent {
  benefits: string[]
  intro: string
  responsibilities: string[]
  qualifications: string[]
  wfhNote?: string
  workMode: string
}

export function buildJobContent(job: JobListing): JobContent {
  // Real, company-provided content only. Missing arrays stay empty.
  const benefits = job.benefits ?? []
  const responsibilities = job.responsibilities ?? []
  const qualifications = job.qualifications ?? []

  // The intro is the job's own description — not a generated wrapper.
  const intro = job.description ?? ''

  // workMode / wfhNote are factual labels derived from the stored remote flag,
  // not fabricated content.
  const workMode = job.remote
    ? job.location.toLowerCase().includes('remote')
      ? 'Remote'
      : 'On-site, Remote'
    : 'On-site'
  const wfhNote = job.remote ? 'Flexible work-from-home options available.' : undefined

  return { benefits, intro, responsibilities, qualifications, wfhNote, workMode }
}
