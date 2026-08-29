import { forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { DancingMascot } from '@/components/DancingMascot'

type Variant = 'default' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success' | 'subtle'
type Size = 'sm' | 'md' | 'lg' | 'icon'

const variants: Record<Variant, string> = {
  default:
    'bg-primary text-primary-foreground hover:brightness-110 shadow-soft active:scale-[.98]',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  outline: 'border border-border bg-transparent hover:bg-muted text-foreground',
  ghost: 'hover:bg-muted text-foreground',
  subtle: 'bg-primary/10 text-primary hover:bg-primary/15',
  danger: 'bg-danger text-danger-foreground hover:brightness-110',
  success: 'bg-success text-success-foreground hover:brightness-110',
}

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
  icon: 'h-10 w-10',
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', loading, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading && (
        <DancingMascot size={16} />
      )}
      {children}
    </button>
  ),
)
Button.displayName = 'Button'
