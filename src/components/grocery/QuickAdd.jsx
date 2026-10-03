import { useMemo, useState } from 'react'
import { Plus, SlidersHorizontal } from 'lucide-react'
import { Card } from '../ui/Card'
import { Input } from '../ui/Field'
import { CategoryIcon } from '../ui/CategoryIcon'
import { cn } from '../../lib/cn'
import { DEFAULT_UNIT } from '../../data/constants'
import { guessCategory } from '../../lib/categoryGuess'
import { normName, payerLabel } from '../../lib/grocery'
import { stepQuantity } from '../../lib/inventory'
import { formatUnitPrice } from '../../lib/pricing'
import { showToast } from '../../lib/feedback'
import { buildSuggestions, matchSuggestions, readHistory, rememberAdded } from '../../lib/quickAdd'

// A sensible first quantity: 100 gr / ml, otherwise 1.
const firstQuantity = (unit) => (unit === 'gr' || unit === 'ml' ? 100 : 1)

// One box to add an item: type, pick a suggestion (or press Enter) and it's
// on the list with its category, unit, last price and payer. An item
// already on the list gets one more instead of a second entry.
export function QuickAdd({ items, pantryItems, parents, subsByParent, categoryName, addItem, updatePricing, totalFor, onMoreOptions }) {
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState(readHistory)

  const suggestions = useMemo(() => buildSuggestions(pantryItems, items, history), [pantryItems, items, history])
  const matches = matchSuggestions(suggestions, text)
  const isParent = (id) => parents.some((p) => p.id === id)
  const isSubOf = (parentId, id) => (subsByParent.get(parentId) || []).some((s) => s.id === id)

  // Picked suggestion, or what was typed (category guessed from the name).
  function entryFor(suggestion) {
    if (suggestion) return suggestion
    const name = text.trim()
    const known = suggestions.find((s) => normName(s.name) === normName(name))
    if (known) return known
    const guess = guessCategory(name)
    return { name, categoryId: guess?.categoryId, subcategoryId: guess?.subcategoryId, unit: DEFAULT_UNIT, price: 0, payer: 'shared' }
  }

  const add = async (suggestion) => {
    const entry = entryFor(suggestion)
    if (!entry.name || busy) return
    setBusy(true)
    const open = items.find((i) => !i.completed && normName(i.name) === normName(entry.name))
    if (open) {
      const quantity = stepQuantity(open.quantity, open.unit, 1)
      const { error } = await updatePricing(open, { quantity }, totalFor({ ...open, quantity }))
      if (!error) showToast({ message: `"${open.name}" was already on the list — now ${quantity} ${open.unit}` })
    } else {
      const categoryId = isParent(entry.categoryId) ? entry.categoryId : parents[0]?.id ?? null
      const subcategoryId = isSubOf(categoryId, entry.subcategoryId) ? entry.subcategoryId : null
      const unit = entry.unit || DEFAULT_UNIT
      const { error } = await addItem({
        name: entry.name,
        categoryId,
        subcategoryId,
        price: entry.price || 0,
        priceQty: entry.price ? entry.priceQty ?? null : null,
        priceUnit: entry.price ? entry.priceUnit ?? null : null,
        quantity: firstQuantity(unit),
        unit,
        payer: entry.payer || 'shared',
        pantryItemId: entry.pantryItemId ?? null,
      })
      if (!error) {
        const remembered = { name: entry.name, categoryId, subcategoryId, unit, price: entry.price || 0, priceQty: entry.priceQty ?? null, priceUnit: entry.priceUnit ?? null, payer: entry.payer || 'shared' }
        rememberAdded(remembered)
        setHistory(readHistory())
        showToast({ message: `Added "${entry.name}" · ${firstQuantity(unit)} ${unit}` })
      }
    }
    setBusy(false)
    setText('')
    setActive(0)
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Escape') {
      setText('')
    }
  }

  return (
    <Card className="rounded-3xl space-y-2">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          add(matches[active])
        }}
        className="flex gap-2"
      >
        <Input
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="Add an item… (e.g. milk)"
          aria-label="Add an item"
          aria-autocomplete="list"
          autoComplete="off"
          enterKeyHint="done"
          className="flex-1 text-base"
        />
        <button
          type="submit"
          disabled={!text.trim() || busy}
          aria-label="Add"
          className="shrink-0 w-11 rounded-2xl bg-[var(--color-primary)] text-white flex items-center justify-center disabled:opacity-40"
        >
          <Plus size={20} />
        </button>
      </form>

      {matches.length > 0 && (
        <ul role="listbox" className="divide-y divide-[var(--color-border)] rounded-2xl border border-[var(--color-border)] overflow-hidden">
          {matches.map((s, i) => {
            const onList = items.some((g) => !g.completed && normName(g.name) === normName(s.name))
            const price = formatUnitPrice({ price: s.price, price_qty: s.priceQty, price_unit: s.priceUnit, unit: s.unit })
            return (
              <li key={s.name} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onClick={() => add(s)}
                  onMouseEnter={() => setActive(i)}
                  className={cn('w-full flex items-center gap-3 px-3 py-2.5 text-left', i === active ? 'bg-[var(--color-surface-soft)]' : '')}
                >
                  <CategoryIcon category={s.categoryId} size={16} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-[var(--color-text)] truncate">{s.name}</span>
                    <span className="block text-[11px] text-[var(--color-text-muted)] truncate">
                      {[s.categoryId && categoryName(s.categoryId), s.unit, price, s.payer && payerLabel(s.payer)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {onList && <span className="text-[10px] font-bold text-[var(--color-accent)] shrink-0">on list · +1</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={() => onMoreOptions(text.trim())}
        className="flex items-center gap-1.5 text-xs font-bold text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
      >
        <SlidersHorizontal size={13} /> More options (category, quantity, price…)
      </button>
    </Card>
  )
}
