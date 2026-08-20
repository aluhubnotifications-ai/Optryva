import { useEffect, useState } from 'react'
import { useNavigation } from 'react-router-dom'
import { isLoading, subscribeLoad } from '@/lib/loadingBar'

/** Thin accent bar pinned to the top of the viewport. Visible while the router is
 *  navigating between routes OR any API request is in flight, so the user always
 *  sees that *something* is happening instead of a frozen screen. */
export function GlobalProgress() {
  const nav = useNavigation()
  const [apiActive, setApiActive] = useState(false)

  useEffect(() => subscribeLoad(() => setApiActive(isLoading())), [])

  const active = nav.state === 'loading' || apiActive
  if (!active) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden" aria-hidden>
      <div
        className="h-full w-1/3 rounded-full bg-accent shadow-[0_0_10px_hsl(var(--accent))]"
        style={{ animation: 'optryva-progress 1.1s ease-in-out infinite' }}
      />
    </div>
  )
}
