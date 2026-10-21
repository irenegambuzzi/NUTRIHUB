// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [] }) }))
vi.mock('../hooks/useFlow', () => ({ useFlow: () => ({ ready: false }) }))
vi.mock('../hooks/usePurchase', () => ({ usePurchase: () => ({ confirmPurchase: vi.fn(async () => ({ error: null })) }) }))
vi.mock('../hooks/useReceiptPhotos', () => ({ useReceiptPhotos: () => ({ photos: [], addPhoto: vi.fn(), deletePhoto: vi.fn() }) }))
const { ConfirmPurchase } = await import('./grocery/ConfirmPurchase')
const { lineTotal } = await import('../lib/pricing')

afterEach(cleanup)

const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const cartItem = (id, name, price, extra = {}) => ({ id, name, category_id: 'misc', quantity: 1, unit: 'pcs', price, price_qty: 1, price_unit: 'pcs', payer: 'shared', in_cart: true, completed: false, ...extra })
const setup = (cart, pantry = []) => {
  const edits = vi.fn(async () => ({}))
  render(<ConfirmPurchase cartItems={cart} pantryItems={pantry} categoryName={() => 'Misc'} totalOf={(i) => lineTotal(i, null)} updatePricing={edits} updatePayer={edits} toggleCart={edits} onClose={() => {}} />)
}
const paragraph = (text) => screen.getAllByText(text).find((el) => el.tagName === 'P')

describe('Confirm purchase: the coupon share is visible per item before confirming', () => {
  const cart = [cartItem('c1', 'Test one', 120), cartItem('c2', 'Test two', 60), cartItem('c3', 'Test three', 20)]

  it('€120 + €60 + €20 with a Purchase discount of −€50: each row says "€120.00 → €90.00 (coupon −€30.00)" in green', () => {
    setup(cart)
    expect(screen.queryByText(/coupon −/)).toBeNull()
    type('Purchase discount', '50')
    const first = paragraph('€120.00 → €90.00 (coupon −€30.00)')
    expect(first.className).toContain('text-emerald-300')
    expect(first.className).toContain('break-words')
    expect(paragraph('€60.00 → €45.00 (coupon −€15.00)')).toBeTruthy()
    expect(paragraph('€20.00 → €15.00 (coupon −€5.00)')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Confirm purchase/ }).textContent).toContain('€150.00')
  })

  it('the Purchase discount box repeats every item by name', () => {
    setup(cart)
    type('Purchase discount', '50')
    const box = within(screen.getByRole('list', { name: 'Each item after the purchase discount' }))
    expect(box.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Test one: €120.00 → €90.00 (coupon −€30.00)',
      'Test two: €60.00 → €45.00 (coupon −€15.00)',
      'Test three: €20.00 → €15.00 (coupon −€5.00)',
    ])
  })

  it('an item discount and the coupon: "€80.00 → €56.00 (−30%) · coupon −€x.xx → €y.yy"', () => {
    setup([cartItem('c1', 'Test sneakers', 80), cartItem('c2', 'Test socks', 44)])
    type('Discount for Test sneakers', '30')
    expect(screen.getByText('€80 → €56 (−30%)')).toBeTruthy()
    type('Purchase discount', '10')
    expect(paragraph('€80.00 → €56.00 (−30%) · coupon −€5.60 → €50.40')).toBeTruthy()
    expect(paragraph('€44.00 → €39.60 (coupon −€4.40)')).toBeTruthy()
  })

  it('a group: each variant line (its own entry, variants in the order of the group) shows its own share', () => {
    const pantry = [
      { id: 'grp', name: 'Patatine', is_group: true, unit: 'pcs', category_id: 'misc', min_stock: 0, current_stock: 0 },
      { id: 'v1', name: 'Teriyaki', group_id: 'grp', unit: 'pcs', category_id: 'misc', min_stock: 1, current_stock: 0 },
      { id: 'v2', name: 'Peperoncino', group_id: 'grp', unit: 'pcs', category_id: 'misc', min_stock: 1, current_stock: 0 },
    ]
    setup([cartItem('c1', 'Teriyaki', 2.49, { pantry_item_id: 'v1' }), cartItem('c2', 'Peperoncino', 1.99, { pantry_item_id: 'v2' })], pantry)
    expect(screen.getByRole('group', { name: 'Patatine (group)' })).toBeTruthy()
    type('Purchase discount', '1')
    const group = within(screen.getByRole('group', { name: 'Patatine (group)' }))
    const notes = group.getAllByText(/coupon −/).filter((el) => el.tagName === 'P')
    expect(notes.map((n) => n.textContent)).toEqual(['€1.99 → €1.55 (coupon −€0.44)', '€2.49 → €1.93 (coupon −€0.56)'])
  })
})
