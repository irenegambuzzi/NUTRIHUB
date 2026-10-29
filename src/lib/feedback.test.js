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
  setSessionErrorHandler,
  showToast,
  toastLoadError,
  toastSaveError,
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

  it('show the same load error once, however many lists fail, and Retry reloads them all', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const grocery = vi.fn()
    const expenses = vi.fn()
    toastLoadError(new Error('offline'), grocery, 'grocery_items')
    toastLoadError(new Error('offline'), grocery, 'grocery_items')
    toastLoadError(new Error('offline'), expenses, 'expenses')
    expect(getToasts()).toHaveLength(1)
    expect(getToasts()[0].action.label).toBe('Retry')
    runToastAction(getToasts()[0].id)
    expect(grocery).toHaveBeenCalledTimes(1)
    expect(expenses).toHaveBeenCalledTimes(1)
    toastLoadError(new Error('offline'), grocery, 'grocery_items')
    toastLoadError(new Error('boom'), expenses, 'expenses')
    expect(getToasts()).toHaveLength(2)
  })

  it('never show the same message twice at once', () => {
    showToast({ message: 'Saved offline', duration: 0 })
    showToast({ message: 'Saved offline', duration: 0 })
    expect(getToasts()).toHaveLength(1)
  })

  it('show two Undo toasts with the same text, each with its own timing and undoing only its own change', () => {
    const first = vi.fn()
    const second = vi.fn()
    const a = showToast({ message: 'Order moved to History', duration: 8000, action: { label: 'Undo', onClick: first } })
    vi.advanceTimersByTime(3000)
    const b = showToast({ message: 'Order moved to History', duration: 8000, action: { label: 'Undo', onClick: second } })
    expect(b).not.toBe(a)
    expect(getToasts().map((t) => t.message)).toEqual(['Order moved to History', 'Order moved to History'])
    runToastAction(b)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
    expect(getToasts().map((t) => t.id)).toEqual([a])
    vi.advanceTimersByTime(5000)
    expect(getToasts()).toHaveLength(0)
  })

  it('still drop a toast without Undo whose text is on screen (a plain one, or one with Retry), even beside an equal Undo toast', () => {
    const undo = vi.fn()
    showToast({ message: '3 orders grouped as one order', duration: 0, action: { label: 'Undo', onClick: undo } })
    showToast({ message: '3 orders grouped as one order', duration: 0 })
    expect(getToasts()).toHaveLength(1)
    const retry = vi.fn()
    const r1 = showToast({ message: "Couldn't save — check your connection.", tone: 'error', duration: 0, action: { label: 'Retry', onClick: retry } })
    const r2 = showToast({ message: "Couldn't save — check your connection.", tone: 'error', duration: 0, action: { label: 'Retry', onClick: vi.fn() } })
    expect(r2).toBe(r1)
    expect(getToasts()).toHaveLength(2)
  })

  it('leave an expired login to the session instead of a connection error', () => {
    setSessionErrorHandler((error) => /jwt expired/i.test(error.message))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    toastLoadError({ message: 'JWT expired' }, vi.fn(), 'expenses')
    toastSaveError({ message: 'JWT expired' }, vi.fn())
    expect(getToasts()).toHaveLength(0)
    setSessionErrorHandler(() => false)
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

