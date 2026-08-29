import { create } from 'zustand'
import { aiApi } from '@/lib/api'

// ----------------------------------------------------------------------------
// Company-research progress, kept OUTSIDE any component so the live web-grounded
// stream keeps going — and stays visible — when the user closes the drawer or
// navigates to another tab and back. Mirrors the matching progress store
// (lib/matchProgress.ts): the run streams from /ai/company/stream, accumulating
// Markdown, and reuses the same accumulated text when the panel re-opens for the
// same company instead of re-researching. The AI activity panel entry is created
// by streamAi (trackAi), so it persists across navigation too.
//
// Caching: when a stream finishes with a `done` frame carrying `cached: true`,
// the store marks `fromCache` so the UI can show a "Re-search" button and a
// cached timestamp instead of re-running the AI every time the panel opens.
// ----------------------------------------------------------------------------

export type ResearchPhase = 'idle' | 'running' | 'done' | 'error'

interface ResearchState {
  company: string | null
  role: string | undefined
  text: string
  phase: ResearchPhase
  fromCache: boolean
  cachedAt: string | null
  /** Start (or reuse) research for a company. Idempotent: a run already in flight
   *  — or already finished with text — for the same company is reused, so opening
   *  the panel again doesn't re-research. Pass force=true to re-run. */
  run: (company: string, role?: string, force?: boolean) => Promise<void>
  reset: () => void
}

export const useResearchStream = create<ResearchState>((set, get) => ({
  company: null,
  role: undefined,
  text: '',
  phase: 'idle',
  fromCache: false,
  cachedAt: null,

  run: async (company, role, force = false) => {
    const s = get()
    // Reuse an in-flight or completed run for the same company (unless force).
    if (!force && s.company === company && (s.phase === 'running' || (s.phase === 'done' && s.text.length > 0))) return

    set({ company, role, text: '', phase: 'running', fromCache: false, cachedAt: null })
    let wasCached = false
    try {
      let streamed = false
      try {
        streamed = await aiApi.companyResearchStream(company, role, (tok) => {
          if (get().company === company) set((st) => ({ text: st.text + tok }))
        }, force, (info) => {
          wasCached = info.cached
        })
      } catch {
        streamed = false
      }
      if (get().company !== company) return // superseded by a newer run
      if (streamed && get().text.trim()) {
        set({ phase: 'done', fromCache: wasCached, cachedAt: wasCached ? new Date().toISOString() : null })
        return
      }
      // Streaming failed or returned nothing — fall back to non-streamed research.
      if (get().company !== company) return
      const data = await aiApi.companyResearch(company, role, force)
      if (get().company !== company) return
      const cached = (data as any)._cached === true
      if (cached) {
        set({ text: formatCompanyResearch(data), phase: 'done', fromCache: true, cachedAt: new Date().toISOString() })
      } else {
        set({ text: formatCompanyResearch(data), phase: 'done', fromCache: false, cachedAt: null })
      }
    } catch {
      if (get().company === company) set({ phase: 'error' })
    }
  },

  reset: () => set({ company: null, role: undefined, text: '', phase: 'idle', fromCache: false, cachedAt: null }),
}))

function formatCompanyResearch(data: any): string {
  if (!data) return ''
  // If data already has a `text` field (streamed cache), use it directly.
  if (data.text && typeof data.text === 'string') {
    return data.text
  }
  const parts: string[] = []
  if (data.overview) parts.push(data.overview)
  if (data.culture) parts.push(`## Culture\n${data.culture}`)
  if (data.opportunity) parts.push(`## Opportunity\n${data.opportunity}`)
  if (data.red_flags && data.red_flags.length) parts.push(`## Red flags\n${data.red_flags.map((f: string) => `- ${f}`).join('\n')}`)
  if (data.questions && data.questions.length) parts.push(`## Questions to ask\n${data.questions.map((q: string) => `- ${q}`).join('\n')}`)
  if (data.verdict) parts.push(`## Verdict\n${data.verdict}`)
  return parts.join('\n\n')
}
