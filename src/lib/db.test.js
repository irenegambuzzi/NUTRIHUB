import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attempt, deleteWithUndo, followUp, inSteps, must } from './db'
import { SAVE_ERROR, dismissToast, getToasts, runToastAction } from './feedback'

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))
afterEach(() => {
  getToasts().forEach((t) => dismissToast(t.id))
  vi.restoreAllMocks()
})

const lastToast = () => getToasts().at(-1)

describe('must', () => {
  it('returns data or throws the error', () => {
    expect(must({ data: [1], error: null })).toEqual([1])
    const error = { message: 'offline' }
    expect(() => must({ data: null, error })).toThrow(expect.objectContaining({ message: 'offline' }))
  })
})

describe('inSteps', () => {
  it('undoes finished steps, newest first, when a later step fails', async () => {
    const order = []
    await expect(
      inSteps(async (onFail) => {
        onFail(() => order.push('undo expense'))
        onFail(() => order.push('undo check mark'))
        throw new Error('stock failed')
      })
    ).rejects.toMatchObject({ message: 'stock failed', rolledBack: true })
    expect(order).toEqual(['undo check mark', 'undo expense'])
  })

  it('reports when an undo failed too', async () => {
    await expect(
      inSteps(async (onFail) => {
        onFail(() => {
          throw new Error('offline')
        })
        throw new Error('stock failed')
      })
    ).rejects.toMatchObject({ rolledBack: false })
  })

  it('returns the result when every step works', async () => {
    const undo = vi.fn()
    await expect(inSteps(async (onFail) => (onFail(undo), 'done'))).resolves.toBe('done')
    expect(undo).not.toHaveBeenCalled()
  })
})

describe('attempt', () => {
  it('shows the save error with Retry, and Retry runs it again', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('saved')
    const onFail = vi.fn()
    const result = await attempt(fn, { onFail })
    expect(result.error.message).toBe('offline')
    expect(onFail).toHaveBeenCalled()
    expect(lastToast()).toMatchObject({ message: SAVE_ERROR, tone: 'error', action: { label: 'Retry' } })
    await expect(runToastAction(lastToast().id)).resolves.toEqual({ data: 'saved', error: null })
  })

  it('offers no Retry for forms or half-undone changes', async () => {
    await attempt(() => Promise.reject(new Error('offline')), { retry: false })
    expect(lastToast().action).toBeNull()
    const halfDone = Object.assign(new Error('offline'), { rolledBack: false })
    await attempt(() => Promise.reject(halfDone))
    expect(lastToast().action).toBeNull()
  })

  it('shows nothing when it works', async () => {
    await expect(attempt(async () => 42)).resolves.toEqual({ data: 42, error: null })
    expect(getToasts()).toHaveLength(0)
  })
})

describe('followUp', () => {
  it('says what is missing and retries just that step', async () => {
    const step = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce()
    expect(await followUp('the stock history', step)).toBe(false)
    expect(lastToast().message).toContain('the stock history')
    await runToastAction(lastToast().id)
    expect(step).toHaveBeenCalledTimes(2)
    expect(getToasts()).toHaveLength(0)
  })
})

describe('deleteWithUndo', () => {
  it('deletes, then Undo restores exactly what was removed', async () => {
    const rows = [{ id: 'a', name: 'Milk', price: 1.2 }]
    const restore = vi.fn()
    const result = await deleteWithUndo({ message: 'Removed "Milk"', remove: async () => rows, restore })
    expect(result.error).toBeNull()
    expect(lastToast()).toMatchObject({ message: 'Removed "Milk"', action: { label: 'Undo' } })
    await runToastAction(lastToast().id)
    expect(restore).toHaveBeenCalledWith(rows)
  })

  it('keeps Undo available only for about 5 seconds', async () => {
    vi.useFakeTimers()
    await deleteWithUndo({ remove: async () => [], restore: vi.fn() })
    vi.advanceTimersByTime(5000)
    expect(getToasts()).toHaveLength(0)
    vi.useRealTimers()
  })

  it('shows Retry when the delete fails, without an Undo', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('offline'))
    const onFail = vi.fn()
    expect((await deleteWithUndo({ remove, restore: vi.fn(), onFail })).error.message).toBe('offline')
    expect(onFail).toHaveBeenCalled()
    expect(lastToast()).toMatchObject({ tone: 'error', action: { label: 'Retry' } })
  })

  it('offers Retry when the undo fails', async () => {
    const restore = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce()
    await deleteWithUndo({ remove: async () => ['row'], restore })
    await runToastAction(lastToast().id)
    expect(lastToast()).toMatchObject({ tone: 'error', action: { label: 'Retry' } })
    await runToastAction(lastToast().id)
    expect(restore).toHaveBeenCalledTimes(2)
    expect(restore).toHaveBeenLastCalledWith(['row'])
  })
})
