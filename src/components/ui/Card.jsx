import { cn } from '../../lib/cn'

export function Card({ className, children, ...props }) {
  return (
    <div
      className={cn(
        'bg-[var(--color-surface)] border border-[var(--color-border)] rounded-3xl p-4 shadow-sm',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}
