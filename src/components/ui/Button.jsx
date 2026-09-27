import { cn } from '../../lib/cn'

const VARIANTS = {
  primary: 'bg-[var(--color-primary)] hover:bg-[var(--color-primary-dark)] text-white',
  accent: 'bg-[var(--color-accent)] hover:bg-[var(--color-accent-dark)] text-white',
  ghost: 'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-primary)]',
  danger: 'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-rose-400',
}

export function Button({ variant = 'primary', className, children, ...props }) {
  return (
    <button
      className={cn(
        'font-bold rounded-2xl px-4 py-2.5 text-sm transition-all duration-200 inline-flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.97]',
        VARIANTS[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}
