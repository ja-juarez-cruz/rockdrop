/**
 * Badge — small status indicator pill.
 *
 * Variants:
 *   waiting     — zinc neutral
 *   connected   — green
 *   disconnected — red muted
 *   win         — green filled
 *   lose        — red filled
 *   tie         — zinc filled
 */

const variantClasses = {
  waiting:      'bg-zinc-100 text-zinc-500',
  connected:    'bg-green-50 text-green-700',
  disconnected: 'bg-red-50 text-red-400',
  win:          'bg-green-50 text-green-700 font-semibold',
  lose:         'bg-red-50 text-red-500 font-semibold',
  tie:          'bg-zinc-100 text-zinc-500 font-semibold',
}

export default function Badge({ variant = 'waiting', children, className = '' }) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 px-2.5 py-0.5',
        'text-xs font-medium rounded-full',
        variantClasses[variant] ?? variantClasses.waiting,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </span>
  )
}
