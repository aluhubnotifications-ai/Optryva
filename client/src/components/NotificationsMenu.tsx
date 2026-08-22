import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Bell,
  CheckCheck,
  Briefcase,
  MessageSquare,
  TrendingUp,
  Home,
  CreditCard,
  CalendarCheck,
  type LucideIcon,
} from 'lucide-react'
import { useCurrentUser } from '@/lib/store'
import { notificationsApi } from '@/lib/api'
import type { AppNotification, NotificationType } from '@/types'
import { cn, timeAgo } from '@/lib/utils'

const ICONS: Record<NotificationType, LucideIcon> = {
  dm: MessageSquare,
  message: MessageSquare,
  new_job: Briefcase,
  new_listing: Briefcase,
  followed_company_listing: Briefcase,
  status_change: TrendingUp,
  housing: Home,
  payment: CreditCard,
  new_application: Briefcase,
  booking: CalendarCheck,
}

function routeFor(n: AppNotification, isCompany: boolean): string {
  if (n.type === 'new_application') {
    return n.ref_id ? `/app/applicants/${n.ref_id}` : '/app/listings'
  }
  if (n.type === 'status_change') {
    return n.ref_id ? (isCompany ? `/app/applicants/${n.ref_id}` : `/app/applications/${n.ref_id}`) : (isCompany ? '/app/listings' : '/app/applications')
  }
  if (n.type === 'dm' || n.type === 'booking') return n.ref_id ? `/app/messages?thread=${n.ref_id}` : '/app/messages'
  if (n.type === 'followed_company_listing' || n.type === 'new_listing' || n.type === 'new_job') return n.ref_id ? `/app/jobs?job=${n.ref_id}` : '/app/jobs'
  if (n.type === 'housing') return '/app/housing'
  if (n.type === 'payment') return '/app/usage'
  return '/app'
}

/** Bell button + dropdown panel of notifications. Replaces the standalone page:
 *  opens in place, refreshes on navigation and on a short poll. */
export function NotificationsMenu() {
  const user = useCurrentUser()
  const isCompany = user?.user_type === 'company' || user?.user_type === 'school'
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AppNotification[]>([])

  const load = useCallback(() => {
    if (!user) return
    notificationsApi
      .forUser(user.id)
      .then(setItems)
      .catch(() => {})
  }, [user])

  // Refresh on navigation + every 30s so new notifications appear without reload.
  useEffect(() => {
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load, location.pathname])

  // Close the panel when navigating away.
  useEffect(() => setOpen(false), [location.pathname])

  const unread = items.filter((i) => !i.read).length

  async function openItem(n: AppNotification) {
    setOpen(false)
    if (!n.read) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
      await notificationsApi.markRead(n.id).catch(() => {})
    }
    navigate(routeFor(n, isCompany))
  }

  async function markAll() {
    if (!user) return
    setItems((prev) => prev.map((x) => ({ ...x, read: true })))
    await notificationsApi.markAllRead(user.id).catch(() => {})
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg p-2 hover:bg-muted"
        aria-label="Notifications"
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-danger-foreground">
            {unread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              className="absolute right-0 z-20 mt-2 flex max-h-[28rem] w-[22rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card"
            >
              <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <Bell className="h-4 w-4 text-primary" /> Notifications
                  {unread > 0 && <span className="rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold text-primary">{unread}</span>}
                </p>
                {unread > 0 && (
                  <button onClick={markAll} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                    <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto">
                {items.length === 0 ? (
                  <div className="px-4 py-12 text-center">
                    <Bell className="mx-auto mb-2 h-7 w-7 text-muted-foreground/60" />
                    <p className="text-sm font-medium">No notifications yet</p>
                    <p className="text-xs text-muted-foreground">You're all caught up.</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-border">
                    {items.map((n) => {
                      const Icon = ICONS[n.type] ?? Bell
                      return (
                        <li key={n.id}>
                          <button
                            onClick={() => openItem(n)}
                            className={cn('flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50', !n.read && 'bg-primary/5')}
                          >
                            <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', n.read ? 'bg-muted text-muted-foreground' : 'bg-primary/12 text-primary')}>
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium leading-tight">{n.title}</p>
                              <p className="truncate text-sm text-muted-foreground">{n.body}</p>
                              <p className="mt-0.5 text-[11px] text-muted-foreground">{timeAgo(n.created_at)}</p>
                            </div>
                            {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
