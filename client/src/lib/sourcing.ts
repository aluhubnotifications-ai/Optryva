import { create } from 'zustand'

interface SourcingState {
  open: boolean
  query: string
  openSourcing: (query: string) => void
  close: () => void
}

/** Global AI-sourcing panel state, triggered from the navbar search bar. */
export const useSourcing = create<SourcingState>((set) => ({
  open: false,
  query: '',
  openSourcing: (query) => set({ open: true, query: query.trim() }),
  close: () => set({ open: false }),
}))
