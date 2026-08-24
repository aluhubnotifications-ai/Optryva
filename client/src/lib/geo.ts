import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Country {
  code: string
  name: string
  flag: string // emoji fallback (used only for All countries / Remote)
  flagUrl?: string // real flag image (flagcdn) — used for actual countries
  disabled?: boolean // shown in the picker but not selectable yet
}

export const COUNTRIES: Country[] = [
  { code: 'all', name: 'All countries', flag: '🌍' },
  { code: 'remote', name: 'Remote', flag: '🛰️' },
  // Africa — where Optryva operates. Rwanda is home base.
  { code: 'rw', name: 'Rwanda', flag: '🇷🇼', flagUrl: 'https://flagcdn.com/w40/rw.png' },
  { code: 'ke', name: 'Kenya', flag: '🇰🇪', flagUrl: 'https://flagcdn.com/w40/ke.png' },
  { code: 'ng', name: 'Nigeria', flag: '🇳🇬', flagUrl: 'https://flagcdn.com/w40/ng.png' },
  { code: 'za', name: 'South Africa', flag: '🇿🇦', flagUrl: 'https://flagcdn.com/w40/za.png' },
  { code: 'gh', name: 'Ghana', flag: '🇬🇭', flagUrl: 'https://flagcdn.com/w40/gh.png' },
  { code: 'ug', name: 'Uganda', flag: '🇺🇬', flagUrl: 'https://flagcdn.com/w40/ug.png' },
  { code: 'tz', name: 'Tanzania', flag: '🇹🇿', flagUrl: 'https://flagcdn.com/w40/tz.png' },
  { code: 'et', name: 'Ethiopia', flag: '🇪🇹', flagUrl: 'https://flagcdn.com/w40/et.png' },
  { code: 'eg', name: 'Egypt', flag: '🇪🇬', flagUrl: 'https://flagcdn.com/w40/eg.png' },
  { code: 'ma', name: 'Morocco', flag: '🇲🇦', flagUrl: 'https://flagcdn.com/w40/ma.png' },
  { code: 'sn', name: 'Senegal', flag: '🇸🇳', flagUrl: 'https://flagcdn.com/w40/sn.png' },
  { code: 'ci', name: "Côte d'Ivoire", flag: '🇨🇮', flagUrl: 'https://flagcdn.com/w40/ci.png' },
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

// Live per-country listing counts, published by the Jobs page so the global
// country picker can show how many roles (and how many internships) exist per
// country. Empty until the Jobs page has loaded its listings.
export interface CountryStat {
  total: number
  internships: number
}

interface CountryStatsState {
  stats: Record<string, CountryStat>
  setStats: (s: Record<string, CountryStat>) => void
}

export const useCountryStats = create<CountryStatsState>()((set) => ({
  stats: {},
  setStats: (s) => set({ stats: s }),
}))
