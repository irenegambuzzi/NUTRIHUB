import { useMemo, useState } from 'react'
import { AlertTriangle, Plus, Settings2, Trash2, X } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { DateField } from '../ui/DateField'
import { Input, Label, Select } from '../ui/Field'
import { DecimalHint, DecimalInput } from '../ui/DecimalInput'
import { CategoryFields } from '../inventory/CategoryFields'
import { OneTimeToggle } from '../inventory/OneTimeToggle'
import { UnitOptions } from '../grocery/shared'
import { ShopPicker } from './ShopPicker'
import { ExpenseCategoryManager } from './ExpenseCategoryPicker'
import { DEFAULT_UNIT, PAID_BY_OPTIONS } from '../../data/constants'
import { cn } from '../../lib/cn'
import { decimalProblem } from '../../lib/decimal'
import { localDateString } from '../../lib/expensePeriods'
import { normName } from '../../lib/grocery'
import { withGroupTotals } from '../../lib/groups'
import { money } from '../../lib/pricing'
import {
  addsToHome,
  budgetOf,
  emptyRow,
  homeItemFor,
  homeLocked,
  homeNote,
  listEntryFor,
  listEntryNote,
  moneyPurchasePayload,
  purchaseTotal,
  rowLine,
  rowProblem,
  savesAsPlainExpense,
} from '../../lib/moneyPurchase'
import { budgetMapStore, groceryStore, inventoryCategoryStore, orderStore, pantryStore } from '../../lib/stores'
import { useInventoryCategories } from '../../hooks/useInventoryCategories'
import { useCategorySuggestions } from '../../hooks/useCategorySuggestions'
import { recordMoneyPurchase } from '../../hooks/usePurchase'
import { addExpenseOnce } from '../../hooks/useExpenses'
import { useShops } from '../../hooks/useShops'

// MONEY "Add expense": one receipt. On top the store, date and payer of
// the whole purchase; below one row per item — name, the price as on the
// receipt, quantity and unit, the HOME item category (suggested from the
// name), the budget category (following the HOME category's mapping,
// changeable) and "Add to HOME". Everything inline, no popups.
// One row that is only an expense is saved as one plain expense, like the
// old form; anything else is one purchase (lib/moneyPurchase.js), saved
// with one press and undone with the toast's Undo.
// (Room is kept for later rounds: discounts per row and for the whole
// purchase, the trip marker and category chips go into these rows.)
export function PurchaseForm({ expenseCategories, mainCategories, subsOf, addCategory, renameCategory, moveCategory, deleteCategory, styleFor, onClose }) {
  // One id per form: pressing Save again after a dropped connection can't
  // save the purchase (or the expense) twice.
  const [id] = useState(() => crypto.randomUUID())
  const [shopId, setShopId] = useState('')
  const [date, setDate] = useState(localDateString)
  const [dateOk, setDateOk] = useState(true)
  const [paidBy, setPaidBy] = useState('shared')
  const [rows, setRows] = useState(() => [emptyRow(1)])
  const [nextKey, setNextKey] = useState(2)
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [managing, setManaging] = useState(null) // the row key whose budget category opened Manage
  const { ready: shopsReady } = useShops()

  const { parents, subsByParent, addCategory: addHomeCategory, addSubcategory } = useInventoryCategories()
  const { suggest, remember } = useCategorySuggestions({ parents, subsByParent })
  const { rows: inventoryRows } = inventoryCategoryStore.useRows()
  const { rows: mapRows } = budgetMapStore.useRows()
  const { rows: pantryRows } = pantryStore.useRows()
  const { rows: groceryItems } = groceryStore.useRows()
  const { rows: orders } = orderStore.useRows()
  const pantryItems = useMemo(() => withGroupTotals(pantryRows), [pantryRows])
  const orderedIds = useMemo(() => new Set(orders.filter((o) => o.status === 'on_the_way' && o.grocery_item_id).map((o) => o.grocery_item_id)), [orders])
  const budgetCtx = useMemo(() => ({ expenseCategories, inventoryCategories: inventoryRows, mapRows }), [expenseCategories, inventoryRows, mapRows])

  const lines = rows.map((row) => rowLine(row, pantryItems))
  const entryOf = (line) => listEntryFor(line.row.name, line.target ?? (line.known && !line.known.is_group ? line.known : null), groceryItems, orderedIds)
  const plain = savesAsPlainExpense(lines)
  const problems = lines.map((line) => rowProblem(line, { plain }))
  const total = purchaseTotal(lines)
  const formProblem = !dateOk ? 'Fix the date first (DD/MM/YYYY).' : problems.find(Boolean) ?? ''

  const change = (key, patch) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  // The name fills in the HOME category (until one is picked by hand) and
  // the unit of the HOME item (or group) with that name (until one is
  // picked), so its stock converts without asking.
  const changeName = (row, name) => {
    const patch = { name }
    if (!row.categoryTouched) {
      const pick = suggest(name)
      patch.categoryId = pick?.categoryId ?? ''
      patch.subcategoryId = pick?.subcategoryId ?? ''
      patch.suggested = Boolean(pick)
    }
    const known = homeItemFor(name, pantryItems)
    if (!row.unitTouched) patch.unit = known?.unit ?? DEFAULT_UNIT
    if (normName(name) !== normName(row.name)) patch.variantId = undefined
    change(row.key, patch)
  }

  const addRow = () => {
    setRows((all) => [...all, emptyRow(nextKey)])
    setNextKey((k) => k + 1)
  }

  const save = async () => {
    setTried(true)
    if (busy || formProblem) return
    setBusy(true)
    const { error } = plain ? await saveExpense(lines[0]) : await savePurchase()
    setBusy(false)
    if (error) return
    for (const { row } of lines) if (row.categoryTouched && row.categoryId && row.name.trim()) remember(row.name, row.categoryId, row.subcategoryId || null)
    onClose?.()
  }

  const saveExpense = (line) =>
    addExpenseOnce({
      id,
      categoryId: budgetOf(line.row, budgetCtx) || null,
      amount: line.total,
      description: line.row.name.trim(),
      paidBy,
      expenseDate: date,
      ...(shopsReady ? { shopId: shopId || null } : {}),
    })

  const savePurchase = () => {
    const payload = moneyPurchasePayload({
      id,
      date,
      at: new Date().toISOString(),
      shopId: shopsReady ? shopId : null,
      paidBy,
      lines,
      budgetFor: (line) => budgetOf(line.row, budgetCtx),
      entryOf,
    })
    return recordMoneyPurchase({ payload, restocked: lines.map((l) => l.target?.id).filter(Boolean) })
  }

  const managedRow = rows.find((r) => r.key === managing)
  const managedValue = managedRow ? budgetPick(budgetOf(managedRow, budgetCtx), expenseCategories) : { mainId: '', subId: '' }

  return (
    <>
      {managedRow && (
        <ExpenseCategoryManager
          value={managedValue}
          onChange={({ mainId, subId }) => change(managedRow.key, { budgetId: subId || mainId || '', budgetTouched: true })}
          categories={expenseCategories}
          styleFor={styleFor}
          addCategory={addCategory}
          renameCategory={renameCategory}
          moveCategory={moveCategory}
          deleteCategory={deleteCategory}
          onClose={() => setManaging(null)}
        />
      )}

      <Card className="space-y-3" data-unsaved={rows.some((r) => r.name || r.priceText) ? '' : undefined}>
        <div className="flex justify-between items-center">
          <p className="text-xs font-bold text-[var(--color-primary)] uppercase">Add an expense</p>
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--color-icon-muted)] hover:text-[var(--color-text)] p-1">
              <X size={16} />
            </button>
          )}
        </div>

        <ShopPicker value={shopId} onChange={setShopId} />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Date</Label>
            <DateField label="Date" required value={date} onChange={setDate} onValidity={setDateOk} />
          </div>
          <div>
            <Label>Paid by</Label>
            <Select value={paidBy} onChange={(e) => setPaidBy(e.target.value)} aria-label="Paid by">
              {PAID_BY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          {lines.map((line, index) => (
            <ItemRow
              key={line.row.key}
              index={index}
              line={line}
              listEntry={entryOf(line)}
              problem={tried ? problems[index] : ''}
              single={rows.length === 1}
              budgetId={budgetOf(line.row, budgetCtx)}
              mainCategories={mainCategories}
              subsOf={subsOf}
              parents={parents}
              subsByParent={subsByParent}
              onAddCategory={addHomeCategory}
              onAddSubcategory={addSubcategory}
              onName={(name) => changeName(line.row, name)}
              onChange={(patch) => change(line.row.key, patch)}
              onManageBudget={() => setManaging(line.row.key)}
              onRemove={rows.length > 1 ? () => setRows((all) => all.filter((r) => r.key !== line.row.key)) : null}
            />
          ))}
        </div>

        <button type="button" onClick={addRow} className="min-h-9 inline-flex items-center gap-1.5 text-xs font-bold text-[var(--color-accent)]">
          <Plus size={14} /> Add item
        </button>

        <div className="flex items-baseline justify-between border-t border-[var(--color-border)] pt-2">
          <span className="text-xs text-[var(--color-text-muted)]">
            {plain ? '1 expense' : `${rows.length} item${rows.length === 1 ? '' : 's'} · one purchase`}
          </span>
          <span className="text-lg font-mono font-extrabold text-[var(--color-accent)]">{money(total)}</span>
        </div>
        {tried && formProblem && (
          <p className="text-[11px] text-amber-300 flex items-center gap-1.5">
            <AlertTriangle size={12} /> {formProblem}
          </p>
        )}
        <div className="flex gap-2">
          {onClose && (
            <Button type="button" variant="ghost" onClick={onClose} className="flex-1">
              Cancel
            </Button>
          )}
          <Button type="button" onClick={save} disabled={busy} className="flex-1">
            <Plus size={16} /> {busy ? 'Saving…' : plain ? `Add expense · ${money(total)}` : `Save purchase · ${money(total)}`}
          </Button>
        </div>
      </Card>
    </>
  )
}

// { mainId, subId } of a budget category id, for the category manager.
function budgetPick(id, categories) {
  const c = categories.find((x) => x.id === id)
  if (!c) return { mainId: '', subId: '' }
  return c.parent_id ? { mainId: c.parent_id, subId: c.id } : { mainId: c.id, subId: '' }
}

// One item of the receipt.
function ItemRow({ index, line, listEntry, problem, single, budgetId, mainCategories, subsOf, parents, subsByParent, onAddCategory, onAddSubcategory, onName, onChange, onManageBudget, onRemove }) {
  const { row } = line
  const locked = homeLocked(row)
  const home = addsToHome(row)
  const entryNote = listEntryNote(line, listEntry)
  const label = (what) => (single ? what : `${what} of item ${index + 1}`)
  const badNumber = [row.priceText, row.quantityText, row.minText, row.packSizeText].find((t) => decimalProblem(t)) ?? ''

  return (
    <div role="group" aria-label={single ? 'Item' : `Item ${index + 1}`} className={cn('rounded-2xl border p-3 space-y-2', problem ? 'border-amber-400/60' : 'border-[var(--color-border)]')}>
      <div className="flex items-center gap-2">
        <Input placeholder={single ? 'What (e.g. Dinner out, Cat food)' : 'Item name'} value={row.name} onChange={(e) => onName(e.target.value)} aria-label={label('Name')} className="flex-1" />
        {onRemove && (
          <button type="button" onClick={onRemove} aria-label={label('Remove')} className="w-9 h-9 flex items-center justify-center text-[var(--color-icon-muted)] hover:text-rose-400 shrink-0">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <span className="text-xs text-[var(--color-text-muted)]">€</span>
          <DecimalInput value={row.priceText} onChange={(e) => onChange({ priceText: e.target.value })} placeholder="0.00" aria-label={label('Price')} className="w-24 text-sm p-2 text-right font-mono" />
        </div>
        <div className="flex items-center gap-1">
          <DecimalInput value={row.quantityText} onChange={(e) => onChange({ quantityText: e.target.value })} aria-label={label('Quantity')} className="w-16 text-sm p-2 text-right" />
          <Select value={row.unit} onChange={(e) => onChange({ unit: e.target.value, unitTouched: true })} aria-label={label('Unit')} className="w-auto text-xs p-2">
            <UnitOptions />
          </Select>
        </div>
      </div>
      <DecimalHint value={badNumber} />

      <div>
        <p className="text-[10px] font-bold uppercase text-[var(--color-text-muted)] mb-1">HOME item category</p>
        <CategoryFields
          categoryId={row.categoryId}
          subcategoryId={row.subcategoryId}
          parents={parents}
          subsByParent={subsByParent}
          onAddCategory={onAddCategory}
          onAddSubcategory={onAddSubcategory}
          onChange={(pick) => onChange({ categoryId: pick.categoryId, subcategoryId: pick.subcategoryId, categoryTouched: true, suggested: false })}
          suggested={row.suggested}
          labels={false}
        />
      </div>

      <div>
        <p className="text-[10px] font-bold uppercase text-[var(--color-text-muted)] mb-1">Budget category</p>
        <div className="flex gap-2">
          <Select value={budgetId} onChange={(e) => onChange({ budgetId: e.target.value, budgetTouched: true })} aria-label={label('Budget category')} className="flex-1">
            <option value="">Uncategorized</option>
            {mainCategories.map((main) => [
              <option key={main.id} value={main.id}>
                {main.name}
              </option>,
              ...subsOf(main.id).map((sub) => (
                <option key={sub.id} value={sub.id}>
                  {main.name} › {sub.name}
                </option>
              )),
            ])}
          </Select>
          <button type="button" onClick={onManageBudget} title="Add or delete budget categories" aria-label={label('Manage budget categories')} className="w-9 h-9 flex items-center justify-center rounded-2xl border border-[var(--color-border)] text-[var(--color-icon-muted)] shrink-0">
            <Settings2 size={14} />
          </button>
        </div>
        {!row.budgetTouched && row.categoryId && budgetId && <p className="text-[10px] text-[var(--color-text-muted)] mt-1">From the HOME category's budget mapping — change it if needed.</p>}
      </div>

      <label className={cn('flex items-start gap-2.5 min-h-9', locked ? 'opacity-60' : 'cursor-pointer')}>
        <input
          type="checkbox"
          checked={home}
          disabled={locked}
          onChange={(e) => onChange({ addToHome: e.target.checked })}
          aria-label={label('Add to HOME')}
          className="mt-0.5 w-4 h-4 accent-[var(--color-primary)] shrink-0"
        />
        <span className="text-xs text-[var(--color-text)]">
          <span className="font-bold">Add to HOME</span>
          <span className="block text-[11px] text-[var(--color-text-muted)]">{homeNote(line)}</span>
        </span>
      </label>

      {home && line.group && (
        <div className={cn('rounded-xl border p-2 space-y-1.5', line.needsVariant ? 'bg-amber-500/10 border-amber-400/30' : 'bg-[var(--color-surface-soft)] border-[var(--color-border)]')}>
          <p className="text-[11px] text-[var(--color-text-soft)]">Which variant of "{line.group.name}" gets this stock?</p>
          <Select value={line.target?.id ?? ''} onChange={(e) => onChange({ variantId: e.target.value || null })} aria-label={label('Variant')} className="text-xs p-2">
            <option value="">Choose a variant…</option>
            {line.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({v.current_stock} {v.unit})
              </option>
            ))}
          </Select>
          {line.variants.length === 0 && <p className="text-[11px] text-amber-200">This group has no variants yet — add one in HOME, or turn Add to HOME off.</p>}
        </div>
      )}

      {home && line.target && (line.needsPackSize || row.packSizeText) && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-400/30 p-2 space-y-1">
          <p className="text-[11px] text-amber-200">
            "{line.target.name}" is counted in {line.target.unit} in HOME. How many {line.target.unit} are in 1 {row.unit}?
          </p>
          <div className="flex items-center gap-1">
            <DecimalInput value={row.packSizeText} onChange={(e) => onChange({ packSizeText: e.target.value })} aria-label={label(`${line.target.unit} in 1 ${row.unit}`)} className="w-24 text-sm p-2" />
            <span className="text-xs text-[var(--color-text-muted)]">{line.target.unit}</span>
          </div>
        </div>
      )}

      {home && line.isNew && (
        <div className="space-y-1">
          <OneTimeToggle checked={row.oneTime} onChange={(oneTime) => onChange({ oneTime })} />
          {!row.oneTime && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--color-text-muted)]">Min</span>
              <DecimalInput value={row.minText} onChange={(e) => onChange({ minText: e.target.value })} aria-label={label('Minimum stock')} className="w-16 text-sm p-2 text-right" />
              <span className="text-[11px] text-[var(--color-text-muted)]">{row.unit} — below this it goes on the SHOP list</span>
            </div>
          )}
        </div>
      )}

      {entryNote && <p className="text-[11px] text-[var(--color-text-muted)]">{entryNote}</p>}
      {home && line.total === 0 && <p className="text-[11px] text-[var(--color-text-muted)]">Free: stock only, no expense.</p>}
      {problem && (
        <p className="text-[11px] text-amber-300 flex items-center gap-1.5">
          <AlertTriangle size={12} /> {problem}
        </p>
      )}
    </div>
  )
}
