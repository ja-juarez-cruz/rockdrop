/**
 * Spinner — animated loading indicator.
 *
 * Props:
 *   size      'sm' | 'md' | 'lg'   (default: 'md')
 *   className  additional classes (use text-* to control color)
 */

const sizeClasses = {
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-7 h-7',
}

export default function Spinner({ size = 'md', className = '' }) {
  return (
    <svg
      className={[
        'animate-spin',
        sizeClasses[size] ?? sizeClasses.md,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  )
}
