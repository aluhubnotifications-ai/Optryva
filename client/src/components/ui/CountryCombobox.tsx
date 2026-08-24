import { useEffect, useRef, useState } from 'react'
import { COUNTRIES } from '@/lib/geo'
import { cn } from '@/lib/utils'

interface CountryComboboxProps {
  value: string
  onChange: (v: string) => void
  id?: string
  placeholder?: string
  className?: string
}

// A country input that lets companies/schools either pick from the full world
// list (with flags) or type a custom country name. Any custom value is accepted
// as-is, so jobs get tagged to that country and become searchable for students.
export function CountryCombobox({ value, onChange, id, placeholder, className }: CountryComboboxProps) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  const q = value.trim().toLowerCase()
  const list = COUNTRIES.filter((c) => c.code !== 'all')
  const matches = q ? list.filter((c) => c.name.toLowerCase().includes(q)) : list
  const show = open && matches.length > 0

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  function pick(name: string) {
    onChange(name)
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!show) {
      if (e.key === 'ArrowDown') {
        setOpen(true)
        setHighlight(0)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(matches[highlight].name)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <input
        id={id}
        type="text"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setHighlight(0)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className={cn(
          'flex h-9 w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          className,
        )}
      />
      {show && (
        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-card">
          {matches.slice(0, 50).map((c, i) => (
            <button
              type="button"
              key={c.code}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(c.name)
              }}
              onMouseEnter={() => setHighlight(i)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm',
                i === highlight ? 'bg-muted' : 'hover:bg-muted',
                c.name === value && 'text-primary',
              )}
            >
              {c.flagUrl ? (
                <img src={c.flagUrl} alt="" className="h-3.5 w-5 rounded-sm object-cover shadow-sm" />
              ) : (
                <span className="h-3.5 w-5" />
              )}
              <span className="flex-1">{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
