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
// ----------------------------------------------------------------------------

export type ResearchPhase = 'idle' | 'running' | 'done' | 'error'

interface ResearchState {
  company: string | null
  role: string | undefined
  text: string
  phase: ResearchPhase
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

  run: async (company, role, force = false) => {
    const s = get()
    // Reuse an in-flight or completed run for the same company.
    if (!force && s.company === company && (s.phase === 'running' || (s.phase === 'done' && s.text.length > 0))) return

    set({ company, role, text: '', phase: 'running' })
    try {
      const streamed = await aiApi.companyResearchStream(company, role, (tok) => {
        // Only append if this is still the company being researched (guards against
        // a fast company switch racing an older stream).
        if (get().company === company) set((st) => ({ text: st.text + tok }))
      })
      if (get().company !== company) return // superseded by a newer run
      set({ phase: streamed && get().text.trim() ? 'done' : 'error' })
    } catch {
      if (get().company === company) set({ phase: 'error' })
    }
  },

  reset: () => set({ company: null, role: undefined, text: '', phase: 'idle' }),
}))
