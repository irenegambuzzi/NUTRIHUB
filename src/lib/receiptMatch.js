// Comparing a receipt with the cart before a purchase is confirmed — for
// later, when receipts can be read automatically (see RECEIPT_READERS in
// receipts.js). Nothing here runs yet; the confirm screen already has the
// place to show the result (ReceiptMismatches) and nothing is ever changed
// without the user approving each suggestion.

/**
 * A line read from a receipt.
 * @typedef {{ description: string, quantity?: number, unit?: string, amount: number }} ReceiptLine
 *
 * One difference between the receipt and the cart, with what to do.
 * @typedef {(
 *   | { kind: 'name', itemId: string, receipt: ReceiptLine, suggestion: { action: 'rename', name: string } }
 *   | { kind: 'quantity', itemId: string, receipt: ReceiptLine, suggestion: { action: 'adjust', quantity: number } }
 *   | { kind: 'price', itemId: string, receipt: ReceiptLine, suggestion: { action: 'adjust', total: number } }
 *   | { kind: 'not-in-cart', receipt: ReceiptLine, suggestion: { action: 'add', name: string, quantity: number, unit: string, total: number } }
 *   | { kind: 'not-on-receipt', itemId: string, suggestion: { action: 'remove' } }
 * )} ReceiptMismatch
 *
 * A matcher: { name, match(lines: ReceiptLine[], cart: object[]) → ReceiptMismatch[] }
 */
export const RECEIPT_MATCHERS = []

// The differences between a read receipt and the cart ([] until a matcher
// is added).
export function findMismatches(lines, cart) {
  const matcher = RECEIPT_MATCHERS[0]
  return matcher && lines?.length ? matcher.match(lines, cart) : []
}

// What applying one approved suggestion means, for the confirm screen to
// carry out with its usual actions (change the quantity or price, take an
// item out of the cart, add one).
export function suggestionChange(mismatch) {
  const { suggestion } = mismatch
  switch (suggestion.action) {
    case 'rename':
      return { type: 'update', itemId: mismatch.itemId, patch: { name: suggestion.name } }
    case 'adjust':
      return suggestion.total != null
        ? { type: 'price', itemId: mismatch.itemId, total: suggestion.total }
        : { type: 'update', itemId: mismatch.itemId, patch: { quantity: suggestion.quantity } }
    case 'remove':
      return { type: 'remove', itemId: mismatch.itemId }
    case 'add':
      return { type: 'add', item: { name: suggestion.name, quantity: suggestion.quantity, unit: suggestion.unit, total: suggestion.total } }
    default:
      return null
  }
}
