import { useMemo, useState } from 'react'
import { Plus, SlidersHorizontal } from 'lucide-react'
import { Card } from '../ui/Card'
import { Input } from '../ui/Field'
import { CategoryChips } from '../ui/CategoryChips'
import { CategoryIcon } from '../ui/CategoryIcon'
import { cn } from '../../lib/cn'
import { DEFAULT_UNIT } from '../../data/constants'
import { useCategorySuggestions } from '../../hooks/useCategorySuggestions'
import { normName, payerLabel } from '../../lib/grocery'
import { isDurable } from '../../lib/inventory'
import { formatUnitPrice } from '../../lib/pricing'
import { showToast } from '../../lib/feedback'
import { buildSuggestions, matchSuggestions, readHistory, rememberAdded, suggestionFrom } from '../../lib/quickAdd'
import { addMore, addedMessage, exactKey, matchHomeItems, shopEntryFor, pickLabel } from '../../lib/similarItems'
import { AlreadyListed, CreateNewHint, SimilarItemsQuestion } from '../ui/SimilarItemsPrompt'

// A sensible first quantity: 100 gr / ml, otherwise 1.
const firstQuantity = (unit) => (unit === 'gr' || unit === 'ml' ? 100 : 1)

// One box to add an item: type, pick a suggestion (or press Enter) and it's
// on the list with its category, unit, last price and payer.
// The similar-name safety net (plan 9G) runs first on the name: the same
// name as a HOME item uses that item; a similar one asks inline ("Similar
// item in HOME: …") and nothing is added until a button is pressed; an
// item already on the list (to buy, in the cart or ordered online) asks
// too, instead of making a second entry. `homeItems`: every HOME item
// (variants and finished 1× items too); `openEntries`: the open entries,
// those ordered online included (`orderedIds`).
export function QuickAdd({ items, pantryItems, homeItems = pantryItems, openEntries = items, orderedIds = new Set(), parents, subsByParent, categoryName, addItem, updatePricing, totalFor, onMoreOptions }) {
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  // The open question: { kind: 'similar', name, options } or { kind:
  // 'listed', found, item, source } (see similarItems.js).
  const [question, setQuestion] = useState(null)
  // "Create new" was pressed for this name (its exactKey): the next press
  // adds it as typed; a changed name is checked again.
  const [createNewKey, setCreateNewKey] = useState(null)
  const [history, setHistory] = useState(readHistory)
  const { suggest, suggestions, remember } = useCategorySuggestions({ parents, subsByParent })
  // The chip tapped for what is typed (cleared when the text changes).
  const [picked, setPicked] = useState(null)
  const chips = text.trim() ? suggestions(text) : []

  const suggestionList = useMemo(() => buildSuggestions(pantryItems, items, history), [pantryItems, items, history])
  const matches = matchSuggestions(suggestionList, text)
  const isParent = (id) => parents.some((p) => p.id === id)
  const isSubOf = (parentId, id) => (subsByParent.get(parentId) || []).some((s) => s.id === id)

  const findSuggestion = (name) => suggestionList.find((s) => normName(s.name) === normName(name))

  // Picked suggestion, or what was typed. Its category is the chip tapped,
  // else what was remembered for the name, the pantry or the keywords. With
  // none of these the item is added without a category (grey "No category",
  // tap it to choose) — nothing is asked and nothing is guessed.
  function entryFor(suggestion) {
    const name = (suggestion?.name ?? text).trim()
    const known = suggestion ?? findSuggestion(name)
    const entry = known ?? { name, unit: DEFAULT_UNIT, price: 0, payer: 'shared' }
    const tapped = !suggestion && picked
    const pick = tapped || suggest(name) || (isParent(entry.categoryId) ? { categoryId: entry.categoryId, subcategoryId: entry.subcategoryId } : null)
    return { ...entry, categoryId: pick?.categoryId ?? null, subcategoryId: pick?.subcategoryId ?? null, tapped: Boolean(tapped) }
  }
  const reset = () => {
    setText('')
    setPicked(null)
    setActive(0)
    setQuestion(null)
    setCreateNewKey(null)
  }

  // The add button, Enter or a suggestion tapped. Checks in this order: a
  // durable (its category in the Durables tree) skips the HOME check; the
  // same name as a HOME item uses it; a similar name asks; nothing alike
  // adds as before (the suggestion picked, else the first one listed, else
  // what was typed). Then: already on the list?
  const submit = (suggestion = null) => {
    const name = (suggestion?.name ?? text).trim()
    if (busy || !name) return
    const creating = exactKey(name) === createNewKey
    if (!creating && !isDurable({ category_id: entryFor(suggestion).categoryId })) {
      const { exact, similar } = matchHomeItems(name, homeItems)
      if (exact) return listCheck(exact)
      if (similar.length) {
        const options = similar.map(({ item }) => ({ item, label: pickLabel(item, shopEntryFor({ item, name: item.name }, openEntries, { orderedIds })?.state) }))
        return setQuestion({ kind: 'similar', name, options })
      }
    }
    const chosen = suggestion ?? (creating ? null : matches[active]) ?? null
    const home = chosen?.source === 'pantry' ? homeItems.find((p) => p.id === chosen.pantryItemId) ?? null : null
    listCheck(home, chosen)
  }

  // Already on the list (linked to the HOME item, or an entry without one
  // with a matching name)? Then ask; else add.
  const listCheck = (item, suggestion = null) => {
    const source = item ? suggestionFrom(item, 'pantry') : suggestion
    const found = shopEntryFor({ item, name: (source?.name ?? text).trim() }, openEntries, { orderedIds })
    if (found) return setQuestion({ kind: 'listed', found, item, source })
    add(source, item)
  }

  // One more of the entry already on the list (to buy or in the cart).
  const addOneMore = async (entry) => {
    setBusy(true)
    const quantity = addMore(entry).total
    const { error } = await updatePricing(entry, { quantity }, totalFor({ ...entry, quantity }))
    setBusy(false)
    if (error) return
    showToast({ message: `"${entry.name}" was already on the list — now ${quantity} ${entry.unit}` })
    reset()
  }

  const add = async (suggestion, homeItem = null) => {
    if (busy || !(suggestion?.name ?? text).trim()) return
    setBusy(true)
    const entry = entryFor(suggestion)
    const { categoryId } = entry
    const subcategoryId = categoryId && isSubOf(categoryId, entry.subcategoryId) ? entry.subcategoryId : null
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
      if (entry.tapped && categoryId) remember(entry.name, categoryId, subcategoryId, { chips })
      showToast({ message: homeItem ? addedMessage(homeItem) : `Added "${entry.name}" · ${firstQuantity(unit)} ${unit}${categoryId ? '' : ' · no category yet'}` })
    }
    setBusy(false)
    reset()
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
          // An arrow key moved to a suggestion: that one; else the name typed.
          submit(active > 0 ? matches[active] : null)
        }}
        className="flex gap-2"
      >
        <Input
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setPicked(null)
            setActive(0)
            setQuestion(null)
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

      {question?.kind === 'similar' && (
        <SimilarItemsQuestion
          name={question.name}
          options={question.options}
          busy={busy}
          onPick={(item) => listCheck(item)}
          onCreateNew={() => {
            setCreateNewKey(exactKey(question.name))
            setQuestion(null)
          }}
        />
      )}
      {question?.kind === 'listed' && (
        <AlreadyListed
          found={question.found}
          busy={busy}
          onOk={reset}
          // An order online can't change: a new entry "to buy" instead.
          actionLabel={question.found.state === 'ordered' ? 'Add anyway' : addMore(question.found.entry).label}
          onAction={() => (question.found.state === 'ordered' ? add(question.source, question.item) : addOneMore(question.found.entry))}
        />
      )}
      {createNewKey && !question && <CreateNewHint />}

      <CategoryChips
        mode="home"
        name={text}
        chips={chips}
        selected={picked}
        onPick={(pick) => setPicked({ categoryId: pick.categoryId, subcategoryId: pick.subcategoryId ?? null })}
      />

      {matches.length > 0 && !question && (
        <ul role="listbox" className="divide-y divide-[var(--color-border)] rounded-2xl border border-[var(--color-border)] overflow-hidden">
          {matches.map((s, i) => {
            const onList = items.some((g) => !g.completed && normName(g.name) === normName(s.name))
            const price = formatUnitPrice({ price: s.price, price_qty: s.priceQty, price_unit: s.priceUnit, unit: s.unit })
            return (
              <li key={s.name} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onClick={() => submit(s)}
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
                  {onList && <span className="text-[10px] font-bold text-[var(--color-accent)] shrink-0">on list</span>}
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
