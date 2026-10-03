import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setOnlineForTest } from './connection'
import { enqueue, flush, getQueue, registerHandler, resetQueueForTest, setAfterSync } from './offlineQueue'
import { dismissToast, getToasts } from './feedback'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  resetQueueForTest()
})
afterEach(() => {
  getToasts().forEach((t) => dismissToast(t.id))
  setOnlineForTest(true)
  vi.restoreAllMocks()
})

describe('offline queue', () => {
  it('keeps only the last change with the same key', () => {
    setOnlineForTest(false)
    enqueue('quantity', { id: 'a', quantity: 2 }, { key: 'a' })
    enqueue('quantity', { id: 'b', quantity: 1 }, { key: 'b' })
    enqueue('quantity', { id: 'a', quantity: 3 }, { key: 'a' })
    expect(getQueue().map((op) => op.payload)).toEqual([
      { id: 'b', quantity: 1 },
      { id: 'a', quantity: 3 },
    ])
  })

  it('waits while offline and sends everything in order once back online', async () => {
    const sent = []
    registerHandler('stock', async (p) => sent.push(p.n))
    const afterSync = vi.fn()
    setAfterSync(afterSync)
    setOnlineForTest(false)
    enqueue('stock', { n: 1 })
    enqueue('stock', { n: 2 })
    await flush()
    expect(sent).toEqual([])
    setOnlineForTest(true) // triggers a flush
    await vi.waitFor(() => expect(getQueue()).toHaveLength(0))
    expect(sent).toEqual([1, 2])
    expect(afterSync).toHaveBeenCalled()
  })

  it('stops at a network failure and keeps the change for later', async () => {
    const handler = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue()
    registerHandler('stock', handler)
    setOnlineForTest(false)
    enqueue('stock', { n: 1 })
    enqueue('stock', { n: 2 })
    setOnlineForTest(true)
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1))
    expect(getQueue()).toHaveLength(2)
    await flush()
    expect(getQueue()).toHaveLength(0)
    expect(handler).toHaveBeenCalledTimes(3)
  })

  it('drops a change Supabase refuses, says which, and goes on', async () => {
    const sent = []
    registerHandler('stock', async (p) => {
      if (p.n === 1) throw new Error('permission denied')
      sent.push(p.n)
    })
    setOnlineForTest(false)
    enqueue('stock', { n: 1 }, { label: 'the stock of "Milk"' })
    enqueue('stock', { n: 2 })
    setOnlineForTest(true)
    await vi.waitFor(() => expect(getQueue()).toHaveLength(0))
    expect(sent).toEqual([2])
    expect(getToasts().at(-1).message).toContain('the stock of "Milk"')
  })
})

describe('sending offline changes needs a login', async () => {
  const { setFlushGate } = await import('./offlineQueue')
  it('keeps them until a session starts', async () => {
    const sent = []
    registerHandler('stock', async (p) => sent.push(p.n))
    setOnlineForTest(false)
    enqueue('stock', { n: 1 })
    let signedIn = false
    setFlushGate(() => signedIn)
    setOnlineForTest(true)
    await flush()
    expect(sent).toEqual([])
    expect(getQueue()).toHaveLength(1)
    signedIn = true
    await flush()
    expect(sent).toEqual([1])
    setFlushGate(() => true)
  })
})
