import { describe, expect, it } from 'vitest'
import { addableVariants, groupsToTidy, planGroupEntries, shopUnits, spareEntryIds, unitItem, variantPurchase } from './groupShop'

const group = { id: 'g', name: 'Chips & Snacks', is_group: true, category_id: 'snacks', min_stock: 4 }
const variant = (id, current_stock, extra = {}) => ({ id, name: id, current_stock, unit: 'pcs', group_id: 'g', category_id: 'snacks', ...extra })
const entry = (id, pantry_item_id, extra = {}) => ({ id, name: pantry_item_id, pantry_item_id, auto_generated: true, in_cart: false, completed: false, created_at: '2026-10-19', ...extra })

const peperoncino = variant('Chips - Patatine Peperoncino', 0)
const teriyaki = variant('Patatine teriyaki', 0)
const lays = variant('Lays', 5)
const pantry = new Map([group, peperoncino, teriyaki, lays].map((p) => [p.id, p]))
const pantryOf = (e) => pantry.get(e.pantry_item_id) ?? null
const groupOf = (e) => {
  const p = pantryOf(e)
  return p?.is_group ? p : p?.group_id ? pantry.get(p.group_id) : null
}

describe('the SHOP list as cards', () => {
  it('shows exactly one card per group "to buy", with a row per variant, where its first entry was', () => {
    const list = [entry('milk', 'milk-item'), entry('e1', teriyaki.id), entry('rice', 'rice-item'), entry('e2', peperoncino.id)]
    const units = shopUnits(list, groupOf, pantryOf)
    expect(units.map((u) => u.key)).toEqual(['milk', 'group:g:buy', 'rice'])
    expect(units[1].entries.map((e) => e.id)).toEqual(['e2', 'e1'])
  })

  it('a variant in the cart goes to the group\'s card in the cart; the card "to buy" keeps the others', () => {
    const units = shopUnits([entry('e1', teriyaki.id), entry('e2', peperoncino.id, { in_cart: true })], groupOf, pantryOf)
    expect(units.map((u) => [u.key, u.entries.map((e) => e.name)])).toEqual([
      ['group:g:buy', ['Patatine teriyaki']],
      ['group:g:cart', ['Chips - Patatine Peperoncino']],
    ])
  })

  it('inside the card: variants at 0 first, then from the lowest stock up; a group-level entry from before last', () => {
    const extra = variant('Amica', 2)
    pantry.set(extra.id, extra)
    const units = shopUnits([entry('old', 'g', { name: 'Chips & Snacks' }), entry('l', lays.id), entry('a', extra.id), entry('t', teriyaki.id)], groupOf, pantryOf)
    expect(units).toHaveLength(1)
    expect(units[0].entries.map((e) => e.id)).toEqual(['t', 'a', 'l', 'old'])
    pantry.delete(extra.id)
  })

  it('a card is placed in the shop by its group', () => {
    const [card] = shopUnits([entry('e1', teriyaki.id)], groupOf, pantryOf)
    expect(unitItem(card)).toEqual({ name: 'Chips & Snacks', category_id: 'snacks' })
  })
})

describe('"+ Add another variant"', () => {
  it('offers the variants with stock that are not on the list yet', () => {
    const withVariants = { ...group, variants: [peperoncino, teriyaki, lays, variant('Amica', 1)] }
    expect(addableVariants(withVariants, new Set(['Amica'])).map((v) => v.id)).toEqual(['Lays'])
  })

  it('asks for 1 of the purchase unit', () => {
    expect(variantPurchase(variant('x', 0, { packaging_unit: 'pack', quantity_per_pack: 6 }))).toEqual({ quantity: 1, unit: 'pack' })
    expect(variantPurchase(variant('x', 0, { packaging_unit: 'pack', quantity_per_pack: null }))).toEqual({ quantity: 1, unit: 'pcs' })
  })
})

describe('planGroupEntries', () => {
  it('adds an entry for each variant at 0 that has none, never for the group', () => {
    const plan = planGroupEntries({ group, variants: [peperoncino, teriyaki, lays], open: [entry('e1', teriyaki.id)] })
    expect(plan).toEqual({ remove: [], add: [peperoncino] })
  })

  it('never removes an entry typed by hand', () => {
    const plan = planGroupEntries({ group, variants: [lays], open: [entry('byHand', lays.id, { auto_generated: false }), entry('old', 'g', { auto_generated: false })] })
    expect(plan.remove).toEqual([])
  })
})

describe('spareEntryIds', () => {
  it('keeps the oldest automatic entry, or none of them next to another entry', () => {
    expect(spareEntryIds([entry('b', 'x', { created_at: '2' }), entry('a', 'x', { created_at: '1' })])).toEqual(['b'])
    expect(spareEntryIds([entry('a', 'x'), entry('cart', 'x', { in_cart: true })])).toEqual(['a'])
    expect(spareEntryIds([entry('a', 'x'), entry('ordered', 'x')], new Set(['ordered']))).toEqual(['a'])
    expect(spareEntryIds([entry('a', 'x')])).toEqual([])
  })
})

describe('which groups need tidying (worked out on the phone)', () => {
  const rows = [group, peperoncino, teriyaki, lays]
  const tidy = (entries, ordered = new Set()) => groupsToTidy({ entries, pantryRows: rows, ordered })

  it('nothing when every variant at 0 has exactly one entry', () => {
    expect(tidy([entry('e1', peperoncino.id), entry('e2', teriyaki.id, { in_cart: true })])).toEqual([])
  })

  it('an old group-level entry still "to buy" (also two of them)', () => {
    expect(tidy([entry('old1', 'g'), entry('old2', 'g'), entry('e1', peperoncino.id), entry('e2', teriyaki.id)])).toEqual(['g'])
  })

  it('not for a group-level entry in the cart, on the way or bought (those are never touched)', () => {
    const entries = [entry('cart', 'g', { in_cart: true }), entry('ordered', 'g'), entry('bought', 'g', { completed: true }), entry('e1', peperoncino.id), entry('e2', teriyaki.id)]
    expect(tidy(entries, new Set(['ordered']))).toEqual([])
  })

  it('a variant at 0 without an entry, or with two', () => {
    expect(tidy([entry('e1', peperoncino.id)])).toEqual(['g'])
    expect(tidy([entry('e1', peperoncino.id), entry('e2', teriyaki.id), entry('e3', teriyaki.id)])).toEqual(['g'])
  })

  it('not for a one-time variant at 0', () => {
    const rowsOneTime = [group, { ...peperoncino, one_time: true }, teriyaki]
    expect(groupsToTidy({ entries: [entry('e2', teriyaki.id)], pantryRows: rowsOneTime })).toEqual([])
  })
})
