import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Country {
  code: string
  name: string
  flag: string
  disabled?: boolean // shown in the picker but not selectable yet
}

export const COUNTRIES: Country[] = [
  { code: 'all', name: 'All countries', flag: '🌍' },
  { code: 'remote', name: 'Remote', flag: '🛰️' },
  // Africa — where Optryva operates. Rwanda is home base.
  { code: 'rw', name: 'Rwanda', flag: '🇷🇼' },
  { code: 'ke', name: 'Kenya', flag: '🇰🇪' },
  { code: 'ng', name: 'Nigeria', flag: '🇳🇬' },
  { code: 'za', name: 'South Africa', flag: '🇿🇦' },
  { code: 'gh', name: 'Ghana', flag: '🇬🇭' },
  { code: 'ug', name: 'Uganda', flag: '🇺🇬' },
  { code: 'tz', name: 'Tanzania', flag: '🇹🇿' },
  { code: 'et', name: 'Ethiopia', flag: '🇪🇹' },
  // Coming soon (disabled for now)
  { code: 'eg', name: 'Egypt', flag: '🇪🇬', disabled: true },
  { code: 'ma', name: 'Morocco', flag: '🇲🇦', disabled: true },
  { code: 'sn', name: 'Senegal', flag: '🇸🇳', disabled: true },
  { code: 'ci', name: "Côte d'Ivoire", flag: '🇨🇮', disabled: true },
]

interface GeoState {
  country: string // country name, or 'All countries'
  setCountry: (name: string) => void
}

export const useGeo = create<GeoState>()(
  persist(
    (set) => ({
      // Default to where we are now — Rwanda.
      country: 'Rwanda',
      setCountry: (name) => set({ country: name }),
    }),
    { name: 'optryva-geo-v2' }, // bumped so existing sessions pick up the Rwanda default
  ),
)
