import { decimalProblem, parseDecimal } from './decimal'

// Discounts (NOTE 6), as pure rules so every one can be tested.
//
// A price is typed as on the receipt (the NORMAL price). A line may have its
// own discount in % or €; the whole purchase may have a coupon in % or €.
// Per-item discounts come first; the coupon is then spread over the lines
// in proportion to what each costs AFTER its own discount. What is recorded
// (the expense) is always what was really paid.
//
// A discount is { kind: 'percent' | 'amount', value } — the same words the
// database uses (shopping_trip_items.item_discount_kind, orders.discount_kind,
// shopping_trips.coupon_kind).

export const round2 = (n) => Math.round(n * 100) / 100

const KINDS = ['percent', 'amount']

// What the user typed ({ kind, text }) as a discount, or null when nothing
// is typed or it is 0. A text that isn't a number gives null as well (the
// problem is reported by discountProblem).
export function parseDiscount({ kind = 'percent', text = '' } = {}) {
  const value = parseDecimal(text)
  return Number.isFinite(value) && value > 0 && KINDS.includes(kind) ? { kind, value } : null
}

// How much a discount takes off `list`, rounded to cents (never more than
// `list`). 30 % of €80 → €24; €25 off €120 → €25.
export function discountOff(list, discount) {
  if (!discount || !(list > 0)) return 0
  const off = discount.kind === 'percent' ? (list * discount.value) / 100 : discount.value
  return round2(Math.min(off, list))
}

// What is paid after the discount: €80 −30 % → €56; €120 −€25 → €95.
export const applyDiscount = (list, discount) => round2(list - discountOff(list, discount))

// Why a typed discount can't be used for a price of `list` ('' when it can,
// or when nothing is typed). A percent above 100 and an amount above the
// price are refused, never cut down silently.
export function discountProblem(list, { kind = 'percent', text = '' } = {}) {
  const typed = String(text ?? '').trim()
  if (!typed) return ''
  if (decimalProblem(typed)) return 'Type the discount as a number, like 30 or 2,50.'
  const value = parseDecimal(typed)
  if (kind === 'percent' && value > 100) return "A discount can't be more than 100%."
  if (kind === 'amount' && Number.isFinite(list) && value > round2(list)) return `The discount (${euro(value)}) is bigger than the price (${euro(list)}).`
  return ''
}

// "€80" for whole amounts, "€2.50" otherwise; `exact` always shows cents
// ("€6.00"), as the purchase history does.
function euro(n, exact = false) {
  const value = round2(Number(n) || 0)
  return !exact && Number.isInteger(value) ? `€${value}` : `€${value.toFixed(2)}`
}

// "30" → "30", "12.5" → "12.5"
const plain = (n) => String(round2(n))

// "−30%" / "−€25": the discount as it is written.
export function discountText(discount, exact = false) {
  if (!discount) return ''
  return discount.kind === 'percent' ? `−${plain(discount.value)}%` : `−${euro(discount.value, exact)}`
}

// The line as shown: "€80 → €56 (−30%)", "€120 → €95 (−€25)". `exact`
// (the history of a saved purchase): "€6.00 → €3.00 (−50%)". '' without a
// discount.
export function discountLabel(list, paid, discount, { exact = false } = {}) {
  if (!discount) return ''
  // Whole euros read best ("€80 → €56"), but one amount with cents shows
  // cents on all of them ("€2.50 → €2.00 (−€0.50)").
  const amounts = [list, paid, discount.kind === 'amount' ? discount.value : 0]
  const cents = exact || amounts.some((n) => !Number.isInteger(round2(Number(n) || 0)))
  return `${euro(list, cents)} → ${euro(paid, cents)} (${discountText(discount, cents)})`
}

// The coupon as it is written on the purchase row: "−€50" / "−10%".
export const couponText = (coupon) => discountText(coupon)

// The coupon's total in €: a percent of what the lines cost after their own
// discounts, or the amount (never more than that total).
export function couponTotal(afterItems, coupon) {
  const sum = round2(afterItems.reduce((s, a) => s + (a > 0 ? a : 0), 0))
  return discountOff(sum, coupon)
}

// Spreads the coupon over the lines. `amounts`: what each line costs after
// its own discount. Every share is that line's part of the coupon, rounded
// to cents; the cents left over go to the LAST line, so the shares add up
// to the coupon exactly. A line can never get more than it costs: what the
// last line can't take goes to the line before it, and so on. A line that
// costs €0 gets 0. → { total, shares }
export function spreadCoupon(amounts, coupon) {
  const costs = amounts.map((a) => (a > 0 ? round2(a) : 0))
  const total = couponTotal(costs, coupon)
  const sum = round2(costs.reduce((s, a) => s + a, 0))
  const shares = costs.map((a) => (sum > 0 ? round2((total * a) / sum) : 0))
  let rest = round2(total - shares.reduce((s, x) => s + x, 0))
  for (let i = shares.length - 1; i >= 0 && rest !== 0; i--) {
    const room = rest > 0 ? round2(costs[i] - shares[i]) : -shares[i]
    const move = rest > 0 ? Math.min(rest, room) : Math.max(rest, room)
    shares[i] = round2(shares[i] + move)
    rest = round2(rest - move)
  }
  return { total, shares }
}

// Prices a whole purchase.
//   entries   [{ list, discount: { kind, text } }] — `list` is the price as
//             typed (NaN / null while it isn't a number: that line takes no
//             part in the coupon and has no paid amount yet)
//   coupon    { kind, text } | null — the purchase discount as typed
// → {
//     lines: [{ list, discount, itemPaid, share, paid, problem }]
//     coupon: { kind, value } | null   what was typed, if usable
//     couponTotal, couponProblem, paidTotal, listTotal, problem
//   }
// `problem` is the first thing wrong ('' when all is fine): then nothing
// should be saved.
export function priceLines(entries, coupon = null) {
  const lines = entries.map(({ list, discount }) => {
    const known = Number.isFinite(list)
    const problem = discountProblem(list, discount)
    const parsed = problem ? null : parseDiscount(discount)
    const itemPaid = known ? applyDiscount(round2(list), parsed) : NaN
    return { list: known ? round2(list) : NaN, discount: parsed, itemPaid, share: 0, paid: itemPaid, problem }
  })
  const couponProblem = discountProblem(Infinity, coupon ?? undefined)
  const parsedCoupon = couponProblem ? null : parseDiscount(coupon ?? undefined)
  const { total, shares } = spreadCoupon(lines.map((l) => l.itemPaid), parsedCoupon)
  lines.forEach((line, i) => {
    if (!Number.isFinite(line.itemPaid)) return
    line.share = shares[i]
    line.paid = round2(line.itemPaid - shares[i])
  })
  return {
    lines,
    coupon: parsedCoupon,
    couponTotal: total,
    couponProblem,
    paidTotal: round2(lines.reduce((s, l) => s + (Number.isFinite(l.paid) ? l.paid : 0), 0)),
    listTotal: round2(lines.reduce((s, l) => s + (Number.isFinite(l.list) ? l.list : 0), 0)),
    problem: lines.find((l) => l.problem)?.problem ?? couponProblem,
  }
}

// What a purchase line sends to confirm_shopping_trip besides its paid
// amount: the normal price, its own discount and its part of the coupon.
// Only what exists is sent.
export function lineDiscountFields(priced) {
  const fields = Number.isFinite(priced.list) ? { list_total: priced.list } : {}
  if (priced.discount) {
    fields.item_discount_kind = priced.discount.kind
    fields.item_discount_value = priced.discount.value
  }
  if (priced.share > 0) fields.coupon_share = priced.share
  return fields
}

// The coupon fields of the purchase itself (none without a coupon).
export function couponFields(priced) {
  if (!priced.coupon || !(priced.couponTotal > 0)) return {}
  return { coupon_kind: priced.coupon.kind, coupon_value: priced.coupon.value, coupon_total: priced.couponTotal }
}

// A saved line's discount as a discount ({ kind, value }) or null.
export const lineDiscount = (line) =>
  line?.item_discount_kind && Number(line.item_discount_value) > 0 ? { kind: line.item_discount_kind, value: Number(line.item_discount_value) } : null

// What a saved purchase line says about its price, for the opened purchase
// row: "€6.00 → €3.00 (−50%)", with the coupon share when there was one
// ("€6.00 → €3.00 (−50%) · coupon −€1.50" — then the amount paid is the
// expense). '' when the line had no discount at all (or no normal price
// was kept). The expense amount itself is shown separately and may have
// been edited by hand since: this text describes the receipt, not the edit.
export function lineHistory(line) {
  const list = Number(line?.list_total)
  if (!line || line.list_total == null || !Number.isFinite(list)) return ''
  const discount = lineDiscount(line)
  const share = Number(line.coupon_share) > 0 ? round2(Number(line.coupon_share)) : 0
  if (!discount && !share) return ''
  const afterItem = applyDiscount(list, discount)
  const coupon = share ? `coupon −${euro(share, true)}` : ''
  if (!discount) return `${euro(list, true)} → ${euro(round2(afterItem - share), true)} (${coupon})`
  return `${discountLabel(list, afterItem, discount, { exact: true })}${coupon ? ` · ${coupon}` : ''}`
}

// "(coupon −€50)" / "(coupon −10%)" for a purchase row, '' without a coupon.
export function purchaseCouponNote(trip) {
  if (!trip?.coupon_kind || !(Number(trip.coupon_total) > 0)) return ''
  return `(coupon ${couponText({ kind: trip.coupon_kind, value: Number(trip.coupon_value) })})`
}
