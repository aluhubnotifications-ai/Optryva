import { useEffect, useRef, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { COUNTRIES } from '@/lib/geo'
import { cn } from '@/lib/utils'

// Quick lookup of a country's flag image by name so selected tags can show it.
const FLAG_BY_NAME: Record<string, string | undefined> = Object.fromEntries(
  COUNTRIES.map((c) => [c.name, c.flagUrl]),
)
// Only real countries (not the "All countries" / "Remote" pseudo-entries).
const REAL_COUNTRIES = COUNTRIES.filter((c) => c.code !== 'all' && c.code !== 'remote')

interface CountryMultiSelectProps {
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  id?: string
  suggestions?: readonly string[]
}

/**
 * Preferred-locations picker: a searchable country dropdown whose selections
 * become removable tags. Typing a value not in the list lets the user add it
 * as a custom location (e.g. a city). Far friendlier than a flat wall of chips.
 */
export function CountryMultiSelect({ value, onChange, placeholder, id, suggestions }: CountryMultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const q = query.trim().toLowerCase()
  const matches = q ? REAL_COUNTRIES.filter((c) => c.name.toLowerCase().includes(q)) : REAL_COUNTRIES
  const filtered = matches.filter((c) => !value.includes(c.name))
  const exactExists = REAL_COUNTRIES.some((c) => c.name.toLowerCase() === q)
  const showCustom = q.length > 0 && !exactExists && !value.includes(query.trim())

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  function add(name: string) {
    const clean = name.trim()
    if (!clean || value.includes(clean)) return
    onChange([...value, clean])
    setQuery('')
    setHighlight(0)
    inputRef.current?.focus()
  }
  function remove(name: string) {
    onChange(value.filter((v) => v !== name))
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const visible = [...filtered, ...(showCustom ? [query.trim()] : [])]
    if (!open) {
      if (e.key === 'ArrowDown') {
        setOpen(true)
        setHighlight(0)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, visible.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const pick = visible[highlight]
      if (pick) add(typeof pick === 'string' ? pick : pick.name)
    } else if (e.key === 'Backspace' && !query && value.length) {
      remove(value[value.length - 1])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const visible = [...filtered.map((c) => c.name), ...(showCustom ? [query.trim()] : [])]

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((name) => {
            const flag = FLAG_BY_NAME[name]
            return (
              <span
                key={name}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary',
                )}
              >
                {flag ? (
                  <img src={flag} alt="" className="h-3.5 w-4 rounded-sm object-cover shadow-sm" />
                ) : null}
                <span className="max-w-[12rem] truncate">{name}</span>
                <button
                  type="button"
                  onClick={() => remove(name)}
                  aria-label={`Remove ${name}`}
                  className="rounded-full p-0.5 text-primary/70 transition-colors hover:bg-primary/15 hover:text-primary"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )
          })}
        </div>
      )}

      {suggestions && suggestions.some((s) => !value.includes(s)) && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions
            .filter((s) => !value.includes(s))
            .map((s) => (
              <button
                type="button"
                key={s}
                onClick={() => add(s)}
                className="rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                + {s}
              </button>
            ))}
        </div>
      )}

      <div className="relative" ref={wrapRef}>
        <input
          ref={inputRef}
          id={id}
          type="text"
          autoComplete="off"
          value={query}
          placeholder={placeholder ?? 'Search countries to add…'}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setHighlight(0)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {open && visible.length > 0 && (
          <div className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-card">
            {filtered.slice(0, 60).map((c, i) => (
              <button
                type="button"
                key={c.code}
                onMouseDown={(e) => {
                  e.preventDefault()
                  add(c.name)
                }}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                  i === highlight ? 'bg-muted' : 'hover:bg-muted',
                )}
              >
                {c.flagUrl ? (
                  <img src={c.flagUrl} alt="" className="h-3.5 w-5 rounded-sm object-cover shadow-sm" />
                ) : (
                  <span className="h-3.5 w-5" />
                )}
                <span className="flex-1">{c.name}</span>
                {value.includes(c.name) && <Check className="h-3.5 w-3.5 text-primary" />}
              </button>
            ))}
            {showCustom && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  add(query.trim())
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                  visible.length - 1 === highlight ? 'bg-muted' : 'hover:bg-muted',
                )}
              >
                <Plus className="h-4 w-4 text-primary" />
                <span className="flex-1">
                  Add <span className="font-medium">“{query.trim()}”</span>
                </span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
