import { create } from 'zustand'
import type { Application, JobListing } from '@/types'
import { applicationsApi, jobsApi } from '@/lib/api'

// Session-level cache for a company's listings + applications. Keeps the data in
// memory for the whole session so returning to the "Listings & applications" page
// (e.g. after opening an applicant) is instant — no loading flash, no refetch —
// and only silently revalidates once the data is stale. Mutations call
// `invalidate()` so the next visit picks up fresh server state.
const STALE_MS = 60_000

interface CompanyData {
  userId: string | null
  jobs: JobListing[]
  apps: Application[]
  opens: Record<string, number>
  loaded: boolean
  loadedAt: number
  loading: boolean
  load: (userId: string, force?: boolean) => Promise<void>
  /** Mark data stale but keep showing the last value until a silent refresh
   *  replaces it — used after a mutation elsewhere (e.g. an applicant's status
   *  changed) so returning here refreshes without a loading flash. */
  invalidate: () => void
  reset: () => void
}

export const useCompanyData = create<CompanyData>((set, get) => ({
  userId: null,
  jobs: [],
  apps: [],
  opens: {},
  loaded: false,
  loadedAt: 0,
  loading: false,

  load: async (userId, force = false) => {
    const s = get()
    // Different account (or logout/login) → drop everything.
    if (s.userId && s.userId !== userId) {
      set({ jobs: [], apps: [], opens: {}, loaded: false, loadedAt: 0, userId })
    }
    const fresh = get().loaded && !force && Date.now() - get().loadedAt < STALE_MS
    if (fresh) return
    // If we already have something to show, refresh silently (no spinner).
    const hasData = get().loaded
    if (!hasData) set({ loading: true, userId })
    try {
      const [j, a, o] = await Promise.all([
        jobsApi.byCompany(userId),
        applicationsApi.byCompany(userId),
        jobsApi.openCounts(),
      ])
      set({ jobs: j, apps: a, opens: o, loaded: true, loadedAt: Date.now(), loading: false })
    } catch {
      set({ loading: false })
    }
  },

  invalidate: () => set({ loadedAt: 0 }),
  reset: () => set({ userId: null, jobs: [], apps: [], opens: {}, loaded: false, loadedAt: 0, loading: false }),
}))
