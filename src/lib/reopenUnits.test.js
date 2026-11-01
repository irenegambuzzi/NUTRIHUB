import { describe, expect, it } from 'vitest'
import {
  arrivalFactor,
  arrivalNotTakenOutText,
  boughtUnits,
  keptNotTakenOutText,
  keptText,
  lineFactor,
  notTakenOutText,
  reopenNotes,
  stockFactor,
  takenOutQuantity,
  unarriveNote,
} from './reopenUnits'

// Plan 9M: the rules of supabase/031 as the app knows them, and what the
// toasts say after Reopen / Undo purchase and "Back on the way".

const pcs4 = { id: 'p', name: 'Plonk', unit: 'pcs', current_stock: 8, packaging_unit: 'pack', quantity_per_pack: 4 }
const line = (fields) => ({ id: 'l1', position: 1, pantry_item_id: 'p', pantry_created: false, stock_added: 1, stock_discarded: 0, stock_unit: null, unit: 'pack', log_ids: [], ...fields })

describe('the factor from the unit a stock was counted in to the item\'s unit now (K27)', () => {
  it('the same unit → 1; kg ↔ gr and L ↔ ml → 1000 / 0.001; the item\'s usual pack → its size; anything else → null', () => {
    expect(stockFactor('pcs', pcs4)).toBe(1)
    expect(stockFactor('kg', { unit: 'gr' })).toBe(1000)
    expect(stockFactor('gr', { unit: 'kg' })).toBe(0.001)
    expect(stockFactor('L', { unit: 'ml' })).toBe(1000)
    expect(stockFactor('ml', { unit: 'L' })).toBe(0.001)
    expect(stockFactor('pack', pcs4)).toBe(4)
    expect(stockFactor('pack', { unit: 'pcs' })).toBeNull()
    expect(stockFactor('box', pcs4)).toBeNull()
    expect(stockFactor('btl', { unit: 'pcs' })).toBeNull()
    expect(stockFactor('pack', { ...pcs4, quantity_per_pack: 0 })).toBeNull()
  })

  it('a line: its stock_unit (030), else its own "Bought" row\'s unit, else its own unit only when it is the item\'s', () => {
    expect(lineFactor(line({ stock_unit: 'pack' }), pcs4)).toBe(4)
    expect(lineFactor(line({ stock_unit: 'pcs' }), pcs4)).toBe(1)
    expect(lineFactor(line({}), pcs4, 'pack')).toBe(4)
    expect(lineFactor(line({}), pcs4, 'pcs')).toBe(1)
    expect(lineFactor(line({ unit: 'pcs' }), pcs4)).toBe(1)
    expect(lineFactor(line({ unit: 'pack' }), pcs4)).toBeNull()
  })

  it('the "Bought" row of each line, from the purchase\'s own history rows', () => {
    const logs = [
      { id: 'a', unit: 'btl', reason: 'discarded' },
      { id: 'b', unit: 'btl', reason: 'purchased' },
    ]
    expect(boughtUnits([line({ log_ids: ['a', 'b'] }), line({ id: 'l2', log_ids: [] })], logs)).toEqual(
      new Map([
        ['l1', 'btl'],
        ['l2', null],
      ])
    )
  })

  it('an arrival: the unit of its own history row, or the item\'s when that row is gone', () => {
    expect(arrivalFactor({ unit: 'pack' }, pcs4)).toBe(4)
    expect(arrivalFactor(null, pcs4)).toBe(1)
    expect(arrivalFactor({ unit: 'pack' }, { unit: 'pcs' })).toBeNull()
  })
})

describe('the notes after Reopen / Undo purchase', () => {
  it('the exact texts', () => {
    expect(keptText('Plonk', '4 pcs')).toBe('"Plonk" stays in HOME — it also got stock or an order from elsewhere; this purchase\'s 4 pcs were taken out.')
    expect(keptText('Plonk', '')).toBe('"Plonk" stays in HOME — it also got stock or an order from elsewhere.')
    expect(notTakenOutText('Fizz')).toBe('"Fizz": this purchase\'s stock couldn\'t be taken out (its unit changed) — check it in HOME.')
    expect(keptNotTakenOutText('Plonk')).toBe('"Plonk" stays in HOME — it also got stock or an order from elsewhere; this purchase\'s stock couldn\'t be taken out (its unit changed) — check it in HOME.')
    expect(arrivalNotTakenOutText('Soap')).toBe('"Soap": this arrival\'s stock couldn\'t be taken out (its unit changed) — check it in HOME.')
  })

  it('a created item still there afterwards was kept (031): this purchase\'s stock in the item\'s unit now (1 pack = 4 → 4 pcs)', () => {
    const lines = [line({ pantry_created: true, stock_unit: 'pack' })]
    expect(reopenNotes({ lines, before: [{ ...pcs4, current_stock: 12 }], after: [pcs4] })).toEqual([keptText('Plonk', '4 pcs')])
    expect(reopenNotes({ lines: [line({ pantry_created: true, stock_unit: 'pack', unit: 'pack' })], before: [{ ...pcs4, unit: 'pack', packaging_unit: null, current_stock: 3 }], after: [{ ...pcs4, unit: 'pack', current_stock: 2 }] })).toEqual([keptText('Plonk', '1 pack')])
    expect(reopenNotes({ lines: [line({ pantry_created: true, stock_added: 0 })], before: [pcs4], after: [pcs4] })).toEqual([keptText('Plonk', '')])
  })

  it('a created item kept whose stock can\'t be converted: kept, nothing taken out', () => {
    const lines = [line({ pantry_created: true, stock_unit: 'pack' })]
    const item = { ...pcs4, packaging_unit: null, quantity_per_pack: null, current_stock: 2 }
    expect(reopenNotes({ lines, before: [item], after: [item] })).toEqual([keptNotTakenOutText('Plonk')])
  })

  it('a created item gone afterwards (as always before 031, and untouched with 031): nothing to say', () => {
    expect(reopenNotes({ lines: [line({ pantry_created: true, stock_unit: 'pack' })], before: [pcs4], after: [] })).toEqual([])
  })

  it('an existing item that can\'t be converted: named only when its stock is what 031 leaves, not what the database before 031 makes of it', () => {
    const gum = { id: 'p', name: 'Gum', unit: 'pcs', current_stock: 2, packaging_unit: null, quantity_per_pack: null }
    const lines = [line({ stock_unit: 'pack' })]
    expect(reopenNotes({ lines, before: [gum], after: [gum] })).toEqual([notTakenOutText('Gum')])
    expect(reopenNotes({ lines, before: [gum], after: [{ ...gum, current_stock: 1 }] })).toEqual([])
    // At 0 before: both would leave 0, nothing to say.
    expect(reopenNotes({ lines, before: [{ ...gum, current_stock: 0 }], after: [{ ...gum, current_stock: 0 }] })).toEqual([])
  })

  it('an existing item that converts, or has no unit change: nothing to say', () => {
    expect(reopenNotes({ lines: [line({ stock_unit: 'pack' })], before: [pcs4], after: [{ ...pcs4, current_stock: 4 }] })).toEqual([])
    expect(reopenNotes({ lines: [line({ stock_unit: 'pcs', stock_added: 3 })], before: [pcs4], after: [{ ...pcs4, current_stock: 5 }] })).toEqual([])
  })

  it('reads the unit of a line before 030 from its own "Bought" row', () => {
    const gum = { id: 'p', name: 'Gum', unit: 'pcs', current_stock: 2, packaging_unit: null, quantity_per_pack: null }
    const lines = [line({ log_ids: ['b'] })]
    expect(reopenNotes({ lines, before: [gum], after: [gum], logs: [{ id: 'b', unit: 'pack', reason: 'purchased' }] })).toEqual([notTakenOutText('Gum')])
    expect(reopenNotes({ lines: [line({ unit: 'pcs', log_ids: ['b'] })], before: [gum], after: [{ ...gum, current_stock: 1 }], logs: [{ id: 'b', unit: 'pcs', reason: 'purchased' }] })).toEqual([])
  })
})

describe('the note after "Back on the way" / the Arrived Undo', () => {
  const soap = { id: 's', name: 'Soap', unit: 'pcs', current_stock: 3, packaging_unit: null, quantity_per_pack: null }
  const order = { stock_added: 1 }

  it('nothing taken out (031) → said; taken out in the old numbers (021) or converted → nothing', () => {
    expect(unarriveNote({ order, before: soap, after: soap, log: { unit: 'pack' } })).toBe(arrivalNotTakenOutText('Soap'))
    expect(unarriveNote({ order, before: soap, after: { ...soap, current_stock: 2 }, log: { unit: 'pack' } })).toBeNull()
    expect(unarriveNote({ order, before: { ...soap, current_stock: 12, packaging_unit: 'pack', quantity_per_pack: 4 }, after: { ...soap, current_stock: 8 }, log: { unit: 'pack' } })).toBeNull()
    expect(unarriveNote({ order: { stock_added: 0 }, before: soap, after: soap, log: { unit: 'pack' } })).toBeNull()
    expect(unarriveNote({ order, before: null, after: null, log: null })).toBeNull()
  })

  it('what really came out, in the item\'s unit', () => {
    expect(takenOutQuantity({ unit: 'pcs', current_stock: 12 }, { current_stock: 8 })).toBe('4 pcs')
    expect(takenOutQuantity({ unit: 'gr', current_stock: 1500 }, { current_stock: 500 })).toBe('1000 gr')
    expect(takenOutQuantity({ unit: 'pcs', current_stock: 3 }, { current_stock: 3 })).toBe('')
  })
})
