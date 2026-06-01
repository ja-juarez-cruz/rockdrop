/**
 * Card — generic surface container.
 *
 * Props:
 *   padding    'none' | 'sm' | 'md' | 'lg'   (default: 'md')
 *   className  additional Tailwind classes
 *   children
 */

const paddingClasses = {
  none: '',
  sm:   'p-4',
  md:   'p-5',
  lg:   'p-6',
}

export default function Card({
  padding = 'md',
  className = '',
  children,
  ...rest
}) {
  return (
    <div
      className={[
        'bg-white border border-zinc-200 rounded-2xl shadow-sm',
        paddingClasses[padding] ?? paddingClasses.md,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </div>
  )
}
