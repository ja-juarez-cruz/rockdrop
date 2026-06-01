/**
 * Button — design-system button with three variants.
 *
 * Variants:
 *   primary  — filled blue, high-contrast CTA
 *   ghost    — outlined zinc, secondary action
 *   danger   — filled red, destructive action
 *
 * Props:
 *   variant    'primary' | 'ghost' | 'danger'  (default: 'primary')
 *   size       'sm' | 'md' | 'lg'              (default: 'md')
 *   loading    boolean                          shows spinner, disables click
 *   disabled   boolean
 *   fullWidth  boolean
 *   children   ReactNode
 *   ...rest    passed to <button>
 */

import Spinner from './Spinner.jsx'

const variantClasses = {
  primary:
    'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 focus-visible:ring-blue-500 disabled:bg-blue-300',
  ghost:
    'bg-white text-zinc-700 border border-zinc-200 hover:bg-zinc-50 active:bg-zinc-100 focus-visible:ring-zinc-400 disabled:text-zinc-300 disabled:border-zinc-100',
  danger:
    'bg-red-500 text-white hover:bg-red-600 active:bg-red-700 focus-visible:ring-red-400 disabled:bg-red-300',
}

const sizeClasses = {
  sm: 'h-9 px-4 text-sm gap-1.5',
  md: 'h-11 px-5 text-sm gap-2',
  lg: 'h-14 px-6 text-base gap-2',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  children,
  className = '',
  ...rest
}) {
  const isDisabled = disabled || loading

  return (
    <button
      disabled={isDisabled}
      aria-disabled={isDisabled}
      className={[
        'inline-flex items-center justify-center',
        'rounded-xl font-medium',
        'transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        'cursor-pointer disabled:cursor-not-allowed',
        'touch-manipulation select-none',
        variantClasses[variant] ?? variantClasses.primary,
        sizeClasses[size] ?? sizeClasses.md,
        fullWidth ? 'w-full' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {loading && (
        <Spinner
          size="sm"
          className={variant === 'ghost' ? 'text-zinc-500' : 'text-white/80'}
        />
      )}
      {children}
    </button>
  )
}
