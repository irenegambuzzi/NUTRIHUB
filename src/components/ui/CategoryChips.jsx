import { useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Input, Select } from './Field'
import { cn } from '../../lib/cn'
import { categoryPath } from '../../lib/categoryNames'
import { sortCategories } from '../../lib/categoryOrder'
import { checkNewName, defaultNewBudget, titleCase } from '../../lib/newCategory'
import { useCategoryCreation } from '../../hooks/useCategoryCreation'

const NEW_MAIN = ''

const chipClass = (on) =>
  cn(
    'min-h-9 px-3 rounded-full border text-xs font-bold text-left',
    on ? 'bg-[var(--color-primary)] border-transparent text-white' : 'bg-[var(--color-surface-soft)] border-[var(--color-border)] text-[var(--color-text-soft)]'
  )

// Is this chip what the form has now?
function isPicked(chip, selected) {
  if (!selected) return false
  if (chip.expenseCategoryId) return chip.expenseCategoryId === selected.expenseCategoryId
  return Boolean(chip.categoryId) && chip.categoryId === selected.categoryId && (chip.subcategoryId || '') === (selected.subcategoryId || '')
}

// 1–3 category chips under an item name, then "+ New category" (NOTE 4 and
// 5). `chips` come from the one suggestion door (lib/categorySuggest.js).
// Tapping a chip calls onPick({ categoryId, subcategoryId, expenseCategoryId });
// so does a category made with the row below, which opens inline (no popup),
// only adds, and says when a name is already used.
//   mode       'home' (a HOME item category; the budget category follows its
//              mapping) or 'budget' (a MONEY row not added to HOME: a budget
//              category only)
//   proposals  [{ parentId, name }] — a "✚ New" chip with a proposed name
//              (the AI in round 8). Nothing passes any yet, so none shows.
export function CategoryChips(props) {
  return String(props.name ?? '').trim() ? <ChipsAndNewRow {...props} /> : null
}

function ChipsAndNewRow({ mode = 'home', name, chips = [], selected = null, onPick, proposals = [], className }) {
  const creation = useCategoryCreation()
  const [draft, setDraft] = useState(null) // null = closed, else { name, parentId, budgetId, budgetTouched }
  const [busy, setBusy] = useState(false)
  const home = mode === 'home'
  const typed = String(name ?? '').trim()

  const categories = home ? creation.homeCategories : creation.expenseCategories
  const mains = home ? creation.homeMains : creation.moneyMains
  const mainName = draft?.parentId ? categories.find((c) => c.id === draft.parentId)?.name ?? null : null

  const check = useMemo(() => (draft ? checkNewName({ kind: home ? 'home' : 'money', name: draft.name, categories, mainName }) : null), [draft, home, categories, mainName])

  // HOME: the budget category follows the name and the main until it is
  // changed by hand.
  const budgetId = draft ? (draft.budgetTouched ? draft.budgetId : defaultNewBudget({ name: draft.name, parentId: draft.parentId || null, ctx: creation.ctx }) ?? '') : ''

  const open = (proposal = null) => {
    const first = chips[0]
    const firstMain = home ? first?.categoryId : categories.find((c) => c.id === first?.expenseCategoryId)?.parent_id ?? first?.expenseCategoryId
    const parentId = proposal ? proposal.parentId ?? NEW_MAIN : mains.some((m) => m.id === firstMain) ? firstMain : NEW_MAIN
    setDraft({ name: proposal?.name ?? titleCase(typed), parentId, budgetId: '', budgetTouched: false })
  }

  const pickExisting = (category) => {
    const chip = home
      ? { categoryId: category.parent_id || category.id, subcategoryId: category.parent_id ? category.id : null, expenseCategoryId: null }
      : { categoryId: null, subcategoryId: null, expenseCategoryId: category.id }
    onPick?.({ ...chip, source: 'name', label: categoryPath(categories, category) })
    setDraft(null)
  }

  const create = async () => {
    if (!draft || check.problem || busy) return
    setBusy(true)
    const args = { name: draft.name.trim(), parentId: draft.parentId || null }
    const { error, pick } = home ? await creation.createHome({ ...args, budgetId }) : await creation.createMoney(args)
    setBusy(false)
    if (error) return
    onPick?.({ ...pick, source: 'new', label: draft.name.trim() })
    setDraft(null)
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={home ? 'Suggested categories' : 'Suggested budget categories'}>
        {chips.map((chip) => (
          <button key={`${chip.categoryId}|${chip.subcategoryId}|${chip.expenseCategoryId}`} type="button" onClick={() => onPick?.(chip)} aria-pressed={isPicked(chip, selected)} className={chipClass(isPicked(chip, selected))}>
            {chip.label}
          </button>
        ))}
        {proposals.map((p) => (
          <button key={`${p.parentId}|${p.name}`} type="button" onClick={() => open(p)} className={chipClass(false)}>
            {p.parentId ? `${categories.find((c) => c.id === p.parentId)?.name ?? ''} › ` : ''}✚ {p.name}
          </button>
        ))}
        {!draft && (
          <button type="button" onClick={() => open()} className="min-h-9 px-2 inline-flex items-center gap-1 text-xs font-bold text-[var(--color-accent)]">
            <Plus size={13} /> New category
          </button>
        )}
      </div>

      {draft && (
        <div role="group" aria-label="New category" className="rounded-2xl border border-[var(--color-border)] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase text-[var(--color-text-muted)]">{home ? 'New HOME category' : 'New budget category (not added to HOME)'}</p>
            <button type="button" onClick={() => setDraft(null)} aria-label="Cancel new category" className="text-[var(--color-icon-muted)] p-1">
              <X size={14} />
            </button>
          </div>
          <Input
            autoFocus
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="Category name"
            aria-label="New category name"
            aria-invalid={Boolean(check.problem)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                create()
              }
            }}
          />
          <Select value={draft.parentId} onChange={(e) => setDraft((d) => ({ ...d, parentId: e.target.value }))} aria-label="Where the new category goes">
            <option value={NEW_MAIN}>New main category</option>
            {mains.map((m) => (
              <option key={m.id} value={m.id}>
                Sub-category of {m.name}
              </option>
            ))}
          </Select>
          {home && (
            <div>
              <p className="text-[10px] font-bold uppercase text-[var(--color-text-muted)] mb-1">Budget category</p>
              <Select value={budgetId} onChange={(e) => setDraft((d) => ({ ...d, budgetId: e.target.value, budgetTouched: true }))} aria-label="Budget category of the new category">
                <option value="">Uncategorized</option>
                {creation.moneyMains.map((main) => [
                  <option key={main.id} value={main.id}>
                    {main.name}
                  </option>,
                  ...sortCategories(creation.expenseCategories.filter((c) => c.parent_id === main.id)).map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {main.name} › {sub.name}
                    </option>
                  )),
                ])}
              </Select>
            </div>
          )}

          {check.problem && draft.name.trim() && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-rose-400">{check.problem}</p>
              {check.suggestions.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-[var(--color-text-muted)]">Free names:</span>
                  {check.suggestions.map((s) => (
                    <button key={s} type="button" onClick={() => setDraft((d) => ({ ...d, name: s }))} className={chipClass(false)}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {check.similar.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-[var(--color-text-muted)]">Similar category exists:</span>
              {check.similar.map((category) => (
                <button key={category.id} type="button" onClick={() => pickExisting(category)} className={chipClass(false)}>
                  Use {categoryPath(categories, category)}
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <button type="button" onClick={() => setDraft(null)} className="flex-1 min-h-9 rounded-2xl border border-[var(--color-border)] text-xs font-bold text-[var(--color-text-soft)]">
              Cancel
            </button>
            <button
              type="button"
              onClick={create}
              disabled={Boolean(check.problem) || busy}
              className="flex-1 min-h-9 rounded-2xl bg-[var(--color-primary)] text-white text-xs font-bold disabled:opacity-40"
            >
              {busy ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
