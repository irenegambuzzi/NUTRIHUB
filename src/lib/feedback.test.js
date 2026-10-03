import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  askDialog,
  closeDialog,
  confirmDialog,
  dialogErrors,
  dismissToast,
  getDialog,
  getToasts,
  parseNumber,
  runToastAction,
  showToast,
  toastLoadError,
} from './feedback'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  getToasts().forEach((t) => dismissToast(t.id))
  vi.useRealTimers()
})

describe('toasts', () => {
  it('disappear after their duration', () => {
    showToast({ message: 'Deleted', duration: 5000 })
    expect(getToasts()).toHaveLength(1)
    vi.advanceTimersByTime(4999)
    expect(getToasts()).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(getToasts()).toHaveLength(0)
  })

  it('run their action once and close', () => {
    const onClick = vi.fn()
    const id = showToast({ message: 'Deleted', action: { label: 'Undo', onClick } })
    runToastAction(id)
    runToastAction(id)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(getToasts()).toHaveLength(0)
  })

  it('replace a toast with the same key instead of piling up', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const retry = vi.fn()
    toastLoadError(new Error('offline'), retry, 'grocery_items')
    toastLoadError(new Error('offline'), retry, 'grocery_items')
    toastLoadError(new Error('offline'), retry, 'expenses')
    expect(getToasts()).toHaveLength(2)
    expect(getToasts()[0].action.label).toBe('Retry')
  })
})

describe('confirmDialog', () => {
  it('resolves with the choice and closes', async () => {
    const answer = confirmDialog({ title: 'Restore?', message: 'Overwrites items.' })
    expect(getDialog().title).toBe('Restore?')
    closeDialog(true)
    await expect(answer).resolves.toBe(true)
    expect(getDialog()).toBeNull()
  })

  it('cancels a dialog that is replaced by a new one', async () => {
    const first = confirmDialog({ title: 'First' })
    const second = confirmDialog({ title: 'Second' })
    await expect(first).resolves.toBe(false)
    closeDialog(false)
    await expect(second).resolves.toBe(false)
  })
})

describe('askDialog', () => {
  const fields = [
    { name: 'packSize', type: 'number', min: 0, required: true },
    { name: 'expiryDate', type: 'date' },
    { name: 'stock', type: 'choice', value: 'discard', options: [{ value: 'discard' }, { value: 'keep' }] },
  ]

  it('resolves with parsed values', async () => {
    const answer = askDialog({ title: 'Check off', fields })
    closeDialog({ packSize: '1,5', expiryDate: '', stock: 'keep' })
    await expect(answer).resolves.toEqual({ packSize: 1.5, expiryDate: null, stock: 'keep' })
  })

  it('resolves null when cancelled', async () => {
    const answer = askDialog({ title: 'Check off', fields })
    closeDialog(null)
    await expect(answer).resolves.toBeNull()
  })

  it('checks the values before closing', () => {
    expect(dialogErrors(fields, { packSize: '', expiryDate: '', stock: 'discard' })).toEqual({ packSize: 'Enter a number above 0.' })
    expect(dialogErrors(fields, { packSize: '0', stock: 'discard' })).toHaveProperty('packSize')
    expect(dialogErrors(fields, { packSize: 'abc', stock: 'discard' })).toHaveProperty('packSize')
    expect(dialogErrors(fields, { packSize: '500', stock: 'maybe' })).toEqual({ stock: 'Pick one.' })
    expect(dialogErrors(fields, { packSize: '500', expiryDate: '', stock: 'discard' })).toEqual({})
  })

  it('reads decimal commas and rejects text', () => {
    expect(parseNumber('2,5')).toBe(2.5)
    expect(parseNumber(' 12 ')).toBe(12)
    expect(parseNumber('12abc')).toBeNaN()
    expect(parseNumber('')).toBeNaN()
  })
})

describe('select fields', () => {
  it('insist on a choice when required', () => {
    const fields = [{ name: 'categoryId', type: 'select', required: true, options: [{ value: 'snacks', label: 'Snacks' }] }]
    expect(dialogErrors(fields, { categoryId: '' })).toEqual({ categoryId: 'Pick one.' })
    expect(dialogErrors(fields, { categoryId: 'snacks' })).toEqual({})
  })
})

