import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Renders a company/school cover banner: the cover image when it loads, or a
 * gradient fallback when there's no cover_url OR the image fails to load (e.g. a
 * dead/expired link). School profiles get a slightly different gradient.
 */
export function CoverImage({
  src,
  isSchool,
  className,
}: {
  src?: string
  isSchool?: boolean
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src]) // retry when the url changes

  if (src && !failed) {
    return <img src={src} alt="" className={cn('h-full w-full object-cover', className)} onError={() => setFailed(true)} />
  }
  return (
    <div className={cn('h-full w-full', isSchool ? 'bg-gradient-to-br from-accent/30 to-primary/20' : 'bg-gradient-to-br from-primary/25 to-accent/25', className)} />
  )
}
