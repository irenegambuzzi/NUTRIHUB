import { useEffect, useState } from 'react'
import { CalendarDays, X } from 'lucide-react'
import { Input } from './Field'
import { formatTypedDate, parseTypedDate } from '../../lib/dateInput'

// A date that can be typed (DD/MM/YYYY) or picked from the calendar, and
// removed. `value` and `onChange` use YYYY-MM-DD, or '' for no date.
// `onValidity(false)` tells the form while the typed text isn't a real
// date, so it can hold back saving.
export function DateField({ value, onChange, onValidity, label }) {
  const [text, setText] = useState(() => formatTypedDate(value))
  const [error, setError] = useState('')
  const [seen, setSeen] = useState(value)

  // The value changed from outside (calendar, remove): the text follows.
  if (seen !== value) {
    setSeen(value)
    setText(formatTypedDate(value))
    setError('')
  }

  // Whether the text is empty or a real date; the form holds back saving
  // while it isn't.
  const valid = !text.trim() || Boolean(parseTypedDate(text).iso)
  useEffect(() => onValidity?.(valid), [valid, onValidity])

  const report = (message) => setError(message)

  const type = (next) => {
    setText(next)
    if (!next.trim()) {
      report('')
      return onChange('')
    }
    const { iso, error: problem } = parseTypedDate(next)
    // A complete, real date is saved at once; a half-typed one waits (the
    // form can't be saved meanwhile) and is only called wrong once complete.
    if (iso) {
      report('')
      setSeen(iso)
      return onChange(iso)
    }
    report(next.trim().length >= 10 ? problem : '')
  }

  const finish = () => {
    if (!text.trim()) return
    const { iso, error: problem } = parseTypedDate(text)
    if (iso) setText(formatTypedDate(iso))
    else report(problem)
  }

  const remove = () => {
    setText('')
    report('')
    setSeen('')
    onChange('')
  }

  return (
    <div>
      <div className="relative">
        <Input
          type="text"
          inputMode="numeric"
          placeholder="DD/MM/YYYY"
          value={text}
          onChange={(e) => type(e.target.value)}
          onBlur={finish}
          aria-label={label}
          aria-invalid={Boolean(error)}
          className={`pr-16 ${error ? 'border-red-400' : ''}`}
        />
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center">
          {(text || value) && (
            <button type="button" onClick={remove} title="Remove date" aria-label={`Remove ${label.toLowerCase()}`} className="p-1.5 text-[var(--color-icon-muted)] hover:text-[var(--color-text)]">
              <X size={14} />
            </button>
          )}
          <CalendarPick value={value} onPick={onChange} label={label} />
        </div>
      </div>
      {error && <p className="text-[11px] text-red-400 mt-1">{error}</p>}
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
