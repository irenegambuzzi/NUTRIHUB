import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDialog, confirmDialog, dismissToast, getDialog, getToasts, runToastAction, showToast, toastLoadError } from './feedback'

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
