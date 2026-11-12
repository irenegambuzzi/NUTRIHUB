import { useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { EXPENSE_PERIODS, EXPENSE_PERIOD_LABELS } from '../../data/constants'
import {
  FULL_MONTH_NAMES,
  calendarYearView,
  dataYears,
  defaultView,
  formatView,
  monthNumber,
  quickSpans,
  sameView,
  spanFromMonth,
  yearChoices,
} from '../../lib/expensePeriods'
import { cn } from '../../lib/cn'
import { Label, Select } from '../ui/Field'

// The period pills (K159) and the bar under them (plan 9O K160b, K161):
//   Week   – "‹ 9 Nov – 15 Nov 2026 ›"; the text goes back to this week
//   Month  – "‹ November 2026 ›"; the text opens the row: "Month", "Year",
//            "Show", "This month"
//   3 Months / 6 Months – no arrows; the text opens the row: "Month",
//            "Year", "Ending in" / "Starting in", "Show", Q1–Q4 or H1 H2,
//            "This month" (K160a)
//   Year   – no arrows; the text opens the row: "Year", "Show", the spans
//            "Last 12 months" … "All", "This year" (K160c)
// The row is inline under the bar (never a popup); nothing changes until
// "Show" or a quick button, and then it closes (also when the text is
// tapped again, or another pill or an arrow is used). Months after this
// one can't be picked (K160d).
//   view        – the period on screen (lib/expensePeriods)
//   onView      – (view) => show that period
//   firstMonth  – the first month with data (a month number)
export function PeriodPicker({ view, onView, firstMonth }) {
  const now = new Date()
  const [open, setOpen] = useState(false)
  const { pill } = view
  const arrows = pill === 'week' || pill === 'month'
  const current = monthNumber(now)
  const show = (next) => {
    setOpen(false)
    onView(next)
  }
  const step = (by) => (pill === 'week' ? { ...view, offset: view.offset + by } : { ...view, from: view.from + by, choice: null })
  const atNewest = pill === 'week' ? view.offset >= 0 : view.from >= current
  const text = formatView(view, now)
  const isDefault = sameView(view, defaultView(pill, now))

  return (
    <div className="space-y-2">
      <div className="flex gap-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full p-1 overflow-x-auto">
        {EXPENSE_PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => show(defaultView(p, now))}
            aria-pressed={pill === p}
            className={cn(
              'flex-1 whitespace-nowrap px-2.5 py-1.5 rounded-full text-xs font-bold transition-all duration-200',
              pill === p ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]'
            )}
          >
            {EXPENSE_PERIOD_LABELS[p]}
          </button>
        ))}
      </div>
      <div className={cn('flex items-center bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full p-1', arrows ? 'justify-between' : 'justify-center')}>
        {arrows && (
          <button
            onClick={() => show(step(-1))}
            aria-label="Previous period"
            className="p-1.5 rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
          >
            <ChevronLeft size={18} />
          </button>
        )}
        {pill === 'week' ? (
          <button
            onClick={() => show(defaultView('week', now))}
            disabled={view.offset === 0}
            title={view.offset === 0 ? undefined : 'Back to the current period'}
            className="text-xs font-bold text-[var(--color-text)] px-2 disabled:cursor-default"
          >
            {text}
          </button>
        ) : (
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="min-h-[30px] inline-flex items-center gap-1 text-xs font-bold text-[var(--color-text)] px-2"
          >
            {text}
            <ChevronDown size={14} aria-hidden="true" className={cn('text-[var(--color-text-muted)] transition-transform', open && 'rotate-180')} />
          </button>
        )}
        {arrows && (
          <button
            onClick={() => show(step(1))}
            disabled={atNewest}
            aria-label="Next period"
            className="p-1.5 rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-primary)] disabled:opacity-30 disabled:hover:text-[var(--color-text-muted)]"
          >
            <ChevronRight size={18} />
          </button>
        )}
      </div>
      {open && pill !== 'week' && (
        <div role="region" aria-label="Pick a period" className="p-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] space-y-3">
          {pill === 'month' && <MonthRow view={view} now={now} firstMonth={firstMonth} onShow={show} back={isDefault ? null : 'This month'} />}
          {(pill === '3months' || pill === '6months') && <SpanRow view={view} now={now} firstMonth={firstMonth} onShow={show} back={isDefault ? null : 'This month'} />}
          {pill === 'year' && <YearRow view={view} now={now} firstMonth={firstMonth} onShow={show} back={isDefault ? null : 'This year'} />}
        </div>
      )}
    </div>
  )
}

const rowButton = 'min-h-10 px-3 rounded-full inline-flex items-center text-xs font-bold border transition-all duration-200 disabled:opacity-40 disabled:cursor-default'
const onColors = 'bg-[var(--color-primary)]/15 text-[var(--color-text)] border-[var(--color-primary)]/40'
const offColors = 'border-[var(--color-border)] text-[var(--color-text-muted)]'

function Choice({ on, disabled = false, onClick, children }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={on} className={cn(rowButton, on ? onColors : offColors)}>
      {children}
    </button>
  )
}

function ShowButton({ onClick }) {
  return (
    <button type="button" onClick={onClick} className="min-h-10 px-4 rounded-2xl text-sm font-bold bg-[var(--color-primary)] hover:bg-[var(--color-primary-dark)] text-white">
      Show
    </button>
  )
}

// The small button back to the pill's default period.
function BackButton({ label, onClick }) {
  return (
    <button type="button" onClick={onClick} className="min-h-10 px-2 text-xs font-bold text-[var(--color-accent)]">
      {label}
    </button>
  )
}

// The "Month" and "Year" selects of the Month and 3 / 6 Months rows: the
// years with data (newest first, none after this one) and, in this year,
// the months up to this one (K160d).
function useMonthYear(view, now, firstMonth, startAt) {
  const years = dataYears(firstMonth, now)
  const current = monthNumber(now)
  const clampYear = (y) => Math.min(Math.max(y, years[years.length - 1]), years[0])
  const lastMonthOf = (y) => (y === now.getFullYear() ? now.getMonth() : 11)
  const initial = Math.min(startAt, current)
  const [year, setYearRaw] = useState(clampYear(Math.floor(initial / 12)))
  const [month, setMonth] = useState(Math.min(initial % 12, lastMonthOf(clampYear(Math.floor(initial / 12)))))
  const setYear = (y) => {
    setYearRaw(y)
    setMonth((m) => Math.min(m, lastMonthOf(y)))
  }
  const fields = (
    <div className="grid grid-cols-2 gap-2">
      <div className="min-w-0">
        <Label htmlFor="period-month">Month</Label>
        <Select id="period-month" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {FULL_MONTH_NAMES.slice(0, lastMonthOf(year) + 1).map((name, i) => (
            <option key={name} value={i}>
              {name}
            </option>
          ))}
        </Select>
      </div>
      <div className="min-w-0">
        <Label htmlFor="period-year">Year</Label>
        <Select id="period-year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
      </div>
    </div>
  )
  return { year, month, picked: year * 12 + month, fields }
}

function MonthRow({ view, now, firstMonth, onShow, back }) {
  const { picked, fields } = useMonthYear(view, now, firstMonth, view.from)
  return (
    <>
      {fields}
      <div className="flex items-center gap-2">
        <ShowButton onClick={() => onShow({ pill: 'month', from: picked, months: 1, choice: null })} />
        {back && <BackButton label={back} onClick={() => onShow(defaultView('month', now))} />}
      </div>
    </>
  )
}

// 3 Months / 6 Months (K160a): the span ending or starting in the picked
// month; "Starting in" this month is not offered (K160d). The quick
// buttons are the quarters / halves of the year in the "Year" select; one
// entirely after this month is disabled.
function SpanRow({ view, now, firstMonth, onShow, back }) {
  const { pill } = view
  // The selects start on the last month of the span on screen.
  const { year, picked, fields } = useMonthYear(view, now, firstMonth, view.from + view.months - 1)
  const [how, setHow] = useState('end')
  const current = monthNumber(now)
  const startingOff = picked >= current
  const chosen = startingOff ? 'end' : how
  return (
    <>
      {fields}
      <div className="space-y-1">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Ending or starting">
          <Choice on={chosen === 'end'} onClick={() => setHow('end')}>
            Ending in
          </Choice>
          <Choice on={chosen === 'start'} disabled={startingOff} onClick={() => setHow('start')}>
            Starting in
          </Choice>
        </div>
        {startingOff && <p className="text-[11px] text-[var(--color-text-muted)]">Use Month for this month only</p>}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={`Quick choices ${year}`}>
        {quickSpans(pill, year).map((q) => (
          <Choice key={q.choice} on={sameView(view, q)} disabled={q.from > current} onClick={() => onShow(q)}>
            {q.choice}
          </Choice>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <ShowButton onClick={() => onShow(spanFromMonth(pill, picked, chosen))} />
        {back && <BackButton label={back} onClick={() => onShow(defaultView(pill, now))} />}
      </div>
    </>
  )
}

// The Year pill (K160c): the calendar years with data, and the spans that
// give something no other choice gives.
function YearRow({ view, now, firstMonth, onShow, back }) {
  const choices = yearChoices(firstMonth, now)
  const years = choices.filter((c) => /^\d+$/.test(c.choice)).map((c) => Number(c.choice)).reverse()
  const spans = choices.filter((c) => !/^\d+$/.test(c.choice))
  const shownYear = /^\d+$/.test(view.choice ?? '') && years.includes(Number(view.choice)) ? Number(view.choice) : now.getFullYear()
  const [year, setYear] = useState(shownYear)
  return (
    <>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Label htmlFor="period-year">Year</Label>
          <Select id="period-year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </div>
        <ShowButton onClick={() => onShow(calendarYearView(year))} />
      </div>
      {spans.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Spans">
          {spans.map((c) => (
            <Choice key={c.choice} on={view.choice === c.choice && sameView(view, c.view)} onClick={() => onShow(c.view)}>
              {c.label}
            </Choice>
          ))}
        </div>
      )}
      {back && <BackButton label={back} onClick={() => onShow(defaultView('year', now))} />}
    </>
  )
}
