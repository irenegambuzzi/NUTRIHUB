import { parseLocalDate } from './week'

// Questions asked while checking off a grocery item, as askDialog options.

// The list unit can't be converted to the pantry unit (e.g. 2 pack of
// rice counted in gr): ask how much one list unit holds.
export function packSizeDialog({ name, unit, baseUnit }) {
  return {
    title: `How big is 1 ${unit}?`,
    message: `"${name}" is counted in ${baseUnit} in the pantry, but is on the list in ${unit}.`,
    fields: [{ name: 'packSize', type: 'number', label: `${baseUnit} in 1 ${unit}`, unit: baseUnit, min: 0, required: true, placeholder: 'e.g. 500' }],
    confirmLabel: 'Check off',
  }
}

// The pantry item has expired: throw the expired stock away or keep it,
// how much was really bought (starts at the list quantity) and the expiry
// date of what was bought (optional).
export function expiredDialog({ name, stock, unit, expiryDate, quantity, listUnit }) {
  const since = expiryDate ? ` on ${parseLocalDate(expiryDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''
  const fields = []
  if (stock > 0) {
    fields.push({
      name: 'stock',
      type: 'choice',
      value: 'discard',
      options: [
        { value: 'discard', label: `Throw away the expired ${stock} ${unit}`, hint: 'Stock becomes just what you bought.' },
        { value: 'keep', label: `Keep the ${stock} ${unit}`, hint: "They're added to what you bought and get the new date." },
      ],
    })
  }
  fields.push({
    name: 'quantity',
    type: 'number',
    label: 'Quantity bought',
    unit: listUnit,
    min: 0,
    required: true,
    value: String(quantity ?? 1),
  })
  fields.push({ name: 'expiryDate', type: 'date', label: 'Expiry date of what you bought (optional)' })
  return {
    title: `"${name}" has expired`,
    message: stock > 0 ? `The ${stock} ${unit} in the pantry expired${since}.` : `Its expiry date${since} has passed.`,
    fields,
    confirmLabel: 'Check off',
  }
}

// The dialog's answer as toggleComplete's `expired` option.
export function expiredChoice(values) {
  return { discard: values.stock === 'discard', expiryDate: values.expiryDate || null }
}
