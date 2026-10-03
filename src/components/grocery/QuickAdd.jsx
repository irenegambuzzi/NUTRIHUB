import { useMemo, useState } from 'react'
import { Plus, SlidersHorizontal } from 'lucide-react'
import { Card } from '../ui/Card'
import { Input } from '../ui/Field'
import { CategoryIcon } from '../ui/CategoryIcon'
import { cn } from '../../lib/cn'
import { DEFAULT_UNIT } from '../../data/constants'
import { useCategorySuggestions } from '../../hooks/useCategorySuggestions'
import { normName, payerLabel } from '../../lib/grocery'
import { stepQuantity } from '../../lib/inventory'
import { formatUnitPrice } from '../../lib/pricing'
import { askDialog, showToast } from '../../lib/feedback'
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
  const { suggest, remember } = useCategorySuggestions({ parents, subsByParent })

  const suggestions = useMemo(() => buildSuggestions(pantryItems, items, history), [pantryItems, items, history])
  const matches = matchSuggestions(suggestions, text)
  const isParent = (id) => parents.some((p) => p.id === id)
  const isSubOf = (parentId, id) => (subsByParent.get(parentId) || []).some((s) => s.id === id)

  // Picked suggestion, or what was typed. Its category comes from what was
  // remembered for the name, the pantry or the keywords; if there's none,
  // the user is asked (and the answer remembered).
  async function entryFor(suggestion) {
    const name = (suggestion?.name ?? text).trim()
    const known = suggestion ?? suggestions.find((s) => normName(s.name) === normName(name))
    const entry = known ?? { name, unit: DEFAULT_UNIT, price: 0, payer: 'shared' }
    const pick = suggest(name) ?? (isParent(entry.categoryId) ? { categoryId: entry.categoryId, subcategoryId: entry.subcategoryId } : null)
    if (pick) return { ...entry, categoryId: pick.categoryId, subcategoryId: pick.subcategoryId }
    const answer = await askDialog({
      title: `Which category is "${name}"?`,
      message: "It isn't in the list yet. The app will remember your choice for next time.",
      fields: [{ name: 'categoryId', type: 'select', required: true, placeholder: 'Choose a category…', options: parents.map((p) => ({ value: p.id, label: p.name })) }],
      confirmLabel: 'Add',
    })
    if (!answer) return null
    remember(name, answer.categoryId, null)
    return { ...entry, categoryId: answer.categoryId, subcategoryId: null }
  }

  const add = async (suggestion) => {
    if (busy || !(suggestion?.name ?? text).trim()) return
    setBusy(true)
    const entry = await entryFor(suggestion)
    if (!entry) return setBusy(false)
    const open = items.find((i) => !i.completed && normName(i.name) === normName(entry.name))
    if (open) {
      const quantity = stepQuantity(open.quantity, open.unit, 1)
      const { error } = await updatePricing(open, { quantity }, totalFor({ ...open, quantity }))
      if (!error) showToast({ message: `"${open.name}" was already on the list — now ${quantity} ${open.unit}` })
    } else {
      const { categoryId } = entry
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
    <Card className="rounded-3xl space-y-2" data-unsaved={text.trim() ? '' : undefined}>
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
