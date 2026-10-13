import { useEffect, useId, useRef, useState } from 'react'
import { CalendarDays, X } from 'lucide-react'
import { Input } from './Field'
import { cn } from '../../lib/cn'
import { formatTypedDate, maskTypedDate, parseTypedDate } from '../../lib/dateInput'

// The one date input of the app: a date typed as day, month, year (10102026,
// 101026, 10-10-2026, 1/2/26 …) or picked from the calendar. `value` and
// `onChange` use YYYY-MM-DD, or '' for no date.
//
// While typing, slashes are put in for you and nothing is called wrong.
// When the field loses focus a real date is shown as DD/MM/YYYY; an
// incomplete or impossible one gets a short message then (and only then).
// A real date is passed to `onChange` as soon as it is complete; until then
// `onValidity(false)` tells the form not to save, so the old value is never
// saved by mistake. A `required` field has no remove button, and empty
// counts as not valid.
export function DateField({ value, onChange, onValidity, label, required = false, id, className, autoFocus, checkSignal = 0 }) {
  const [text, setText] = useState(() => formatTypedDate(value))
  const [error, setError] = useState('')
  const [seen, setSeen] = useState(value)
  const errorId = useId()

  // The value changed from outside (calendar, remove, a form reset): the
  // text follows.
  if (seen !== value) {
    setSeen(value)
    setText(formatTypedDate(value))
    setError('')
  }

  // Whether the text is a real date (or empty, when a date isn't required);
  // the form holds back saving while it isn't.
  const valid = text.trim() ? Boolean(parseTypedDate(text).iso) : !required
  const latest = useRef(onValidity)
  useEffect(() => {
    latest.current = onValidity
  })
  useEffect(() => {
    latest.current?.(valid)
  }, [valid])
  // A field that goes away no longer holds anything back.
  useEffect(
    () => () => {
      latest.current?.(true)
    },
    []
  )

  const type = (typed) => {
    const next = maskTypedDate(typed)
    setText(next)
    setError('')
    if (!next.trim()) {
      if (required) return
      setSeen('')
      return onChange('')
    }
    const { iso } = parseTypedDate(next)
    if (iso) {
      setSeen(iso)
      onChange(iso)
    }
  }

  const finish = () => {
    if (!text.trim()) return setError(required ? 'Enter a date, e.g. 10/10/2026.' : '')
    const { iso, error: problem } = parseTypedDate(text)
    if (iso) setText(formatTypedDate(iso))
    else setError(problem)
  }

  // A form that was refused for this field asks it to say what is wrong now.
  useEffect(() => {
    if (checkSignal) finish()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkSignal])

  const remove = () => {
    setText('')
    setError('')
    setSeen('')
    onChange('')
  }

  const pick = (iso) => {
    setSeen(iso)
    setText(formatTypedDate(iso))
    setError('')
    onChange(iso)
  }

  const canRemove = !required && Boolean(text || value)

  return (
    <div className={className}>
      <div className="relative">
        <Input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="DD/MM/YYYY"
          value={text}
          onChange={(e) => type(e.target.value)}
          onFocus={() => setError('')}
          onBlur={finish}
          autoFocus={autoFocus}
          aria-label={label}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className={cn(canRemove ? 'pr-16' : 'pr-10', error && 'border-red-400')}
        />
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center">
          {canRemove && (
            <button type="button" onClick={remove} title="Remove date" aria-label={`Remove ${label.toLowerCase()}`} className="p-1.5 text-[var(--color-icon-muted)] hover:text-[var(--color-text)]">
              <X size={14} />
            </button>
          )}
          <CalendarPick value={value} onPick={pick} label={label} />
        </div>
      </div>
      {error && (
        <p id={errorId} className="text-[11px] text-red-400 mt-1">
          {error}
        </p>
      )}
    </div>
  )
}

// The calendar picker: a real date input laid invisibly over a button, so
// it opens the phone's own calendar when tapped.
export function CalendarPick({ value, onPick, label }) {
  return (
    <span className="relative p-1.5 text-[var(--color-icon-muted)] hover:text-[var(--color-text)]" title="Pick from calendar">
      <CalendarDays size={16} />
      <input
        type="date"
        value={value || ''}
        onChange={(e) => onPick(e.target.value)}
        aria-label={`Pick ${label.toLowerCase()} from the calendar`}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
    </span>
  )
}
