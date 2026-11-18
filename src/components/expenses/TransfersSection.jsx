import { useState } from 'react'
import { ArrowLeftRight, Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { ClosedBar } from '../ui/ClosedBar'
import { DateField } from '../ui/DateField'
import { Input, Label } from '../ui/Field'
import { DecimalHint, DecimalInput } from '../ui/DecimalInput'
import { cn } from '../../lib/cn'
import { moneyText } from '../../lib/decimal'
import { localDateString } from '../../lib/expensePeriods'
import { ACCOUNT_OPTIONS, JOINT } from '../../lib/payers'
import { KIND_START, KIND_TRANSFER, TRANSFERS_NOTICE, euro, kindOf, transferProblem, transferRow, transferText } from '../../lib/transfers'
import { parseLocalDate } from '../../lib/week'
import { addTransfer, deleteTransfer, updateTransfer } from '../../hooks/useTransfers'

const JOINT_LABEL = ACCOUNT_OPTIONS.find((o) => o.value === JOINT)?.label ?? JOINT

// Money → "Transfers" (plan 9P K228–K231), between Income and Orders:
// money moved between the three accounts, and Joint's starting balance.
// Never an expense or income; not affected by the person pills (a
// transfer has two sides).
//   rows      – the transfers of the period on screen
//   allRows   – every transfer (the one starting balance, K229)
//   ready     – supabase/033 there: true / false / null (not known yet)
//   jointNow  – Joint's BALANCE at the end of the period, as the Joint card
//               computes it, or null while not known (the line is hidden)
export function TransfersSection({ rows, allRows, ready, jointNow }) {
  // The inline card: null, { kind: 'add' }, or { kind: 'edit', row }.
  const [form, setForm] = useState(null)
  // Closed each time Money opens; kept open through a new period or pill.
  const [listOpen, setListOpen] = useState(false)
  const close = () => setForm(null)

  return (
    <section className="space-y-4">
      <div className="flex justify-between items-center gap-2">
        <h2 className="text-xl font-extrabold text-[var(--color-primary)]">Transfers</h2>
        {ready === true && !form && (
          <Button variant="ghost" onClick={() => setForm({ kind: 'add' })} className="min-h-9 px-3 py-1.5 text-xs">
            <Plus size={14} /> Add transfer
          </Button>
        )}
      </div>

      {ready === false && <p className="text-xs text-[var(--color-text-muted)]">{TRANSFERS_NOTICE}</p>}

      {ready === true && (
        <>
          {jointNow !== null && (
            <p className="text-xs text-[var(--color-text-muted)]">
              {JOINT_LABEL} now <span className="font-mono">{euro(jointNow).replace('€-', '−€')}</span>
            </p>
          )}

          {form && <TransferForm key={form.row?.id ?? 'add'} initial={form.row ?? null} allRows={allRows} onClose={close} />}

          <div className="space-y-2">
            <ClosedBar icon={ArrowLeftRight} label={`Transfers (${rows.length})`} open={listOpen} onToggle={() => setListOpen((v) => !v)} />
            {listOpen &&
              (rows.length === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)] px-1">No transfers in this period.</p>
              ) : (
                rows.map((t) => (
                  <div key={t.id} className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-sm text-xs p-3 flex justify-between items-center gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-[var(--color-text)] break-words">{transferText(t)}</p>
                      <span className="text-[10px] text-[var(--color-text-muted)] block">{parseLocalDate(t.transfer_date).toLocaleDateString('en-GB')}</span>
                      {t.note && <span className="text-[10px] text-[var(--color-text-muted)] block break-words">{t.note}</span>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="font-mono font-bold text-[var(--color-text)] mr-1">{euro(t.amount)}</span>
                      <button
                        type="button"
                        onClick={() => setForm({ kind: 'edit', row: t })}
                        className="text-[var(--color-icon-muted)] hover:text-[var(--color-primary)] transition w-9 h-9 flex items-center justify-center"
                        title="Edit transfer"
                        aria-label="Edit transfer"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteTransfer(t.id)}
                        className="text-[var(--color-icon-muted)] hover:text-red-400 transition w-9 h-9 flex items-center justify-center"
                        title="Delete transfer"
                        aria-label="Delete transfer"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))
              ))}
          </div>
        </>
      )}
    </section>
  )
}

// The pills of one side (From / To): the accounts, none lit at the start.
function AccountPills({ label, value, onChange, disabledValue = null }) {
  return (
    <div>
      <Label>{label}</Label>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
        {ACCOUNT_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            disabled={o.value === disabledValue}
            onClick={() => onChange(o.value)}
            className={cn(
              'min-h-9 px-3 rounded-full text-xs font-bold border transition-all disabled:opacity-40',
              value === o.value ? 'bg-[var(--color-accent)] border-transparent text-white' : 'border-[var(--color-border)] text-[var(--color-text)]'
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// "Add transfer" / "Edit transfer" (K231): inline, no popup. Edit is the
// same card filled in; a row keeps its kind. One id per form, so a second
// press (or Retry) saves once.
function TransferForm({ initial, allRows, onClose }) {
  const [id] = useState(() => initial?.id ?? crypto.randomUUID())
  const [kind, setKind] = useState(initial ? kindOf(initial) : KIND_TRANSFER)
  const [date, setDate] = useState(initial?.transfer_date ?? localDateString())
  const [dateOk, setDateOk] = useState(true)
  const [from, setFrom] = useState(initial?.from_code ?? '')
  const [to, setTo] = useState(initial && initial.from_code ? initial.to_code : '')
  const [amountText, setAmountText] = useState(initial ? moneyText(initial.amount) : '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const start = kind === KIND_START

  const chooseFrom = (value) => {
    setFrom(value)
    // The "To" pill equal to "From" can't be chosen.
    if (to === value) setTo('')
    setProblem('')
  }

  const save = async (e) => {
    e.preventDefault()
    if (busy) return
    const values = { kind, from, to, amountText, date, dateOk, note }
    const found = transferProblem(values, { rows: allRows, editingId: initial?.id ?? null, today: localDateString() })
    setProblem(found)
    if (found) return
    setBusy(true)
    const row = transferRow(values)
    const { error } = initial ? await updateTransfer(initial, row) : await addTransfer(id, row)
    setBusy(false)
    // On failure the toast explains and the form keeps what was typed.
    if (!error) onClose()
  }

  return (
    <Card className="space-y-3">
      <form onSubmit={save} data-unsaved={amountText || note ? '' : undefined} className="space-y-3">
        <div className="flex justify-between items-center">
          <p className="text-xs font-bold text-[var(--color-primary)] uppercase">{initial ? 'Edit transfer' : 'Add transfer'}</p>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] w-9 h-9 flex items-center justify-center">
            <X size={16} />
          </button>
        </div>

        {!initial && (
          <div role="group" aria-label="Kind" className="flex flex-wrap gap-1.5">
            {[
              { value: KIND_TRANSFER, label: 'Transfer' },
              { value: KIND_START, label: 'Starting balance' },
            ].map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={kind === o.value}
                onClick={() => {
                  setKind(o.value)
                  setProblem('')
                }}
                className={cn(
                  'min-h-9 px-3 rounded-full text-xs font-bold border transition-all',
                  kind === o.value ? 'bg-[var(--color-primary)] border-transparent text-white' : 'border-[var(--color-border)] text-[var(--color-text)]'
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}

        <div>
          <Label>Date</Label>
          <DateField label="Date" required value={date} onChange={(v) => { setDate(v); setProblem('') }} onValidity={setDateOk} />
        </div>

        {start ? (
          <p className="text-xs text-[var(--color-text-muted)]">
            To <b className="text-[var(--color-text)]">{JOINT_LABEL}</b>
          </p>
        ) : (
          <>
            <AccountPills label="From" value={from} onChange={chooseFrom} />
            <AccountPills label="To" value={to} onChange={(v) => { setTo(v); setProblem('') }} disabledValue={from || null} />
          </>
        )}

        <div>
          <Label>Amount (€)</Label>
          <DecimalInput value={amountText} onChange={(e) => { setAmountText(e.target.value); setProblem('') }} aria-label="Amount (€)" placeholder="0.00" />
          <DecimalHint value={amountText} />
        </div>

        <div>
          <Label>Note (optional)</Label>
          <Input placeholder="e.g. Deposit for the groceries" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note (optional)" />
        </div>

        {problem && <p className="text-xs text-red-400">{problem}</p>}

        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose} className="flex-1 min-h-9">
            Cancel
          </Button>
          <Button type="submit" disabled={busy} className="flex-1 min-h-9">
            {initial ? <Check size={16} /> : <Plus size={16} />} {start ? 'Save starting balance' : 'Save transfer'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
