// ----------------------------------------------------------------------------
// Synchronous wrappers for data loading — used by the queue consumer
// to load entities without the async complexity of the full engine.
// These are thin wrappers around the Supabase client.
// ----------------------------------------------------------------------------

import { sb, j } from '@/db'

let _studentCache = new Map<string, any>()
let _jobCache = new Map<string, any>()
let _resumeCache = new Map<string, any>()
let _evidenceCache = new Map<string, any[]>()

export async function loadStudentSync(studentId: string): Promise<any> {
  if (_studentCache.has(studentId)) return _studentCache.get(studentId)
  const { data } = await sb.from('profiles').select('*').eq('id', studentId).maybeSingle()
  if (data) _studentCache.set(studentId, data)
  return data as any
}

export async function loadJobSync(jobId: string): Promise<any> {
  if (_jobCache.has(jobId)) return _jobCache.get(jobId)
  const { data } = await sb.from('job_listings').select('*').eq('id', jobId).maybeSingle()
  if (data) _jobCache.set(jobId, data)
  return data as any
}

export async function loadResumeSync(resumeId: string): Promise<any> {
  if (_resumeCache.has(resumeId)) return _resumeCache.get(resumeId)
  const { data } = await sb.from('resume_profiles').select('*').eq('id', resumeId).maybeSingle()
  if (data) _resumeCache.set(resumeId, data)
  return data as any
}

export async function loadEvidenceSync(studentId: string, selectedIds: string[]): Promise<any[]> {
  const cacheKey = `${studentId}`
  if (_evidenceCache.has(cacheKey)) return _evidenceCache.get(cacheKey) ?? []
  if (!selectedIds?.length) {
    _evidenceCache.set(cacheKey, [])
    return []
  }
  const { data } = await sb
    .from('evidence_items')
    .select('*')
    .eq('student_id', studentId)
    .in('id', selectedIds)
  const result = (data ?? []) as any[]
  _evidenceCache.set(cacheKey, result)
  return result
}

export function clearSyncCache(): void {
  _studentCache.clear()
  _jobCache.clear()
  _resumeCache.clear()
  _evidenceCache.clear()
}
