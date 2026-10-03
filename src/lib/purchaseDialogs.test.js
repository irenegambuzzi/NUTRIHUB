import { describe, expect, it } from 'vitest'
import { expiredChoice, expiredDialog, packSizeDialog } from './purchaseDialogs'

describe('expiredDialog', () => {
  it('offers to throw the expired stock away (the default) or keep it, plus an optional date', () => {
    const dialog = expiredDialog({ name: 'Yogurt', stock: 2, unit: 'pcs', expiryDate: '2026-09-28', quantity: 4, listUnit: 'pcs' })
    expect(dialog.message).toMatch(/^The 2 pcs in the pantry expired on 28 Sep/)
    const [choice, , date] = dialog.fields
    expect(choice.value).toBe('discard')
    expect(choice.options.map((o) => o.value)).toEqual(['discard', 'keep'])
    expect(date).toMatchObject({ name: 'expiryDate', type: 'date' })
    expect(date.required).toBeFalsy()
  })

  it('asks how much was really bought, starting at the list quantity', () => {
    const dialog = expiredDialog({ name: 'TEST3', stock: 3, unit: 'pack', expiryDate: '2026-09-28', quantity: 3, listUnit: 'pack' })
    expect(dialog.fields.find((f) => f.name === 'quantity')).toMatchObject({ type: 'number', value: '3', unit: 'pack', min: 0, required: true })
  })

  it("doesn't ask what to do with stock when nothing is left to throw away", () => {
    const dialog = expiredDialog({ name: 'Yogurt', stock: 0, unit: 'pcs', expiryDate: '2026-09-28', quantity: 1, listUnit: 'pcs' })
    expect(dialog.fields.map((f) => f.name)).toEqual(['quantity', 'expiryDate'])
  })
})

describe('expiredChoice', () => {
  it('turns the answer into the check-off option', () => {
    expect(expiredChoice({ stock: 'discard', expiryDate: '2026-10-20' })).toEqual({ discard: true, expiryDate: '2026-10-20' })
    expect(expiredChoice({ stock: 'keep', expiryDate: null })).toEqual({ discard: false, expiryDate: null })
    expect(expiredChoice({ expiryDate: null })).toEqual({ discard: false, expiryDate: null })
  })
})

describe('packSizeDialog', () => {
  it('asks for a required number above 0 in the pantry unit', () => {
    const dialog = packSizeDialog({ name: 'Rice', unit: 'pack', baseUnit: 'gr' })
    expect(dialog.title).toBe('How big is 1 pack?')
    expect(dialog.fields[0]).toMatchObject({ name: 'packSize', type: 'number', min: 0, required: true, unit: 'gr' })
  })
})
