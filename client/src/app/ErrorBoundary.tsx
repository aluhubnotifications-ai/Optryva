import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

/** Root-level safety net. If anything still suspends or throws during a render
 *  (e.g. a stray React error #300), show a recoverable fallback instead of a
 *  white screen — and offer a reload so the user can continue. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error('[Optryva] Root ErrorBoundary caught:', error)
  }

  render() {
    if (this.state.error) {
      const err = this.state.error as Error & { componentStack?: string }
      const stack = err.componentStack
      const path = typeof window !== 'undefined' ? window.location.pathname : '?'
      return (
        <div className="mesh-bg flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
          <h1 className="text-xl font-bold tracking-tight">Something went wrong</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            The page hit an unexpected error. Reloading usually fixes it.
          </p>
          <pre className="max-h-72 max-w-lg overflow-auto rounded-lg border border-border bg-card p-3 text-left text-[11px] text-muted-foreground">
            {`route: ${path}\n\n${err.message}\n\n${stack ?? err.stack ?? ''}`}
          </pre>
          <button
            className="rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground"
            onClick={() => location.reload()}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
