import { Input } from './Field'
import { cn } from '../../lib/cn'
import { decimalProblem } from '../../lib/decimal'

// A text field for money and decimal quantities: a decimal keyboard on
// phones, comma or dot accepted. The value stays the text as typed; read it
// with parseDecimal. Wrong text turns the field red; <DecimalHint /> under
// it says why.
export function DecimalInput({ value, className, ...props }) {
  const bad = Boolean(decimalProblem(value))
  return (
    <Input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={value}
      aria-invalid={bad || undefined}
      className={cn(className, bad && 'border-rose-400 focus:border-rose-400')}
      {...props}
    />
  )
}

// The short message for text that isn't a number (nothing when it is fine).
export function DecimalHint({ value, className }) {
  const problem = decimalProblem(value)
  if (!problem) return null
  return (
    <p role="alert" className={cn('text-[11px] text-rose-400 mt-1', className)}>
      {problem}
    </p>
  )
}
