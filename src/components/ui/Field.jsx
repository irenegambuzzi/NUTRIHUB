import { cn } from '../../lib/cn'

const fieldClasses =
  'w-full bg-[var(--color-surface-soft)] border border-[var(--color-border)] rounded-2xl p-2.5 text-sm text-[var(--color-text)] transition-colors duration-200 focus:outline-none focus:border-[var(--color-primary)]'

export function Label({ className, children, ...props }) {
  return (
    <label className={cn('text-xs text-[var(--color-text-soft)] block mb-1', className)} {...props}>
      {children}
    </label>
  )
}

export function Input({ className, ...props }) {
  return <input className={cn(fieldClasses, className)} {...props} />
}

export function Select({ className, children, ...props }) {
  return (
    <select className={cn(fieldClasses, className)} {...props}>
      {children}
    </select>
  )
}

export function Textarea({ className, ...props }) {
  return <textarea className={cn(fieldClasses, 'h-24', className)} {...props} />
}
