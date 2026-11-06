// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'

// Round 6D (plan 9N): how the app finds out that supabase/032 has run.
const client = vi.hoisted(() => ({ supabase: {} }))
vi.mock('../lib/supabaseClient', () => client)
const { checkItemNames, forgetNamesForTest, useItemNamesReady } = await import('./useItemNamesReady')
const { setOnlineForTest } = await import('../lib/connection')

// A Supabase stand-in that answers `answer()` to a read, and counts them.
function fakeDb(answer) {
  const reads = []
  client.supabase = {
    from: (table) => ({
      select: (columns) => ({
        limit: async (n) => {
          reads.push([table, columns, n])
          return answer()
        },
      }),
    }),
  }
  return reads
}

const MISSING = { error: { code: '42703', message: 'column pantry_items.names does not exist' } }

beforeEach(() => {
  forgetNamesForTest()
  setOnlineForTest(true)
})
afterEach(() => {
  cleanup()
  setOnlineForTest(true)
})

describe('useItemNamesReady', () => {
  it('one small read of the column: it answers → true, also with no items at all', async () => {
    const reads = fakeDb(() => ({ data: [], error: null }))
    const { result } = renderHook(() => useItemNamesReady())
    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current).toBe(true))
    expect(reads).toEqual([['pantry_items', 'names', 1]])
  })

  it('the database says the column is not there → false, and it asks no more', async () => {
    const reads = fakeDb(() => MISSING)
    const { result, rerender } = renderHook(() => useItemNamesReady())
    await waitFor(() => expect(result.current).toBe(false))
    rerender()
    expect(reads).toHaveLength(1)
    const other = fakeDb(() => ({ error: { code: 'PGRST204', message: "Could not find the 'names' column" } }))
    expect(await checkItemNames()).toBe(false)
    expect(other).toHaveLength(1)
  })

  it('anything else → null: another error, or a read that throws', async () => {
    fakeDb(() => ({ error: { code: '500', message: 'boom' } }))
    expect(await checkItemNames()).toBeNull()
    client.supabase = {
      from: () => {
        throw new Error('down')
      },
    }
    expect(await checkItemNames()).toBeNull()
    const { result } = renderHook(() => useItemNamesReady())
    await act(async () => {})
    expect(result.current).toBeNull()
  })

  it('offline: nothing is read, null; read again when the connection comes back', async () => {
    const reads = fakeDb(() => ({ data: [], error: null }))
    setOnlineForTest(false)
    const { result } = renderHook(() => useItemNamesReady())
    await act(async () => {})
    expect(result.current).toBeNull()
    expect(reads).toHaveLength(0)
    expect(await checkItemNames()).toBeNull()
    act(() => setOnlineForTest(true))
    await waitFor(() => expect(result.current).toBe(true))
    expect(reads).toHaveLength(1)
  })

  it('rows that carry `names` tell by themselves, with no read; rows without it are read for', async () => {
    const reads = fakeDb(() => MISSING)
    const { result } = renderHook(() => useItemNamesReady([{ id: 'a', names: [] }]))
    expect(result.current).toBe(true)
    await act(async () => {})
    expect(reads).toHaveLength(0)
    forgetNamesForTest()
    const { result: older } = renderHook(() => useItemNamesReady([{ id: 'a' }]))
    await waitFor(() => expect(older.current).toBe(false))
    expect(reads).toHaveLength(1)
  })

  it('once true it stays known for this app start, on every screen, with no second read', async () => {
    const reads = fakeDb(() => ({ data: [], error: null }))
    expect(await checkItemNames()).toBe(true)
    const { result } = renderHook(() => useItemNamesReady())
    expect(result.current).toBe(true)
    fakeDb(() => MISSING)
    expect(await checkItemNames()).toBe(true)
    expect(reads).toHaveLength(1)
  })

  it('a screen waiting learns the answer from another one that asked', async () => {
    fakeDb(() => ({ error: { code: '500', message: 'boom' } }))
    const { result } = renderHook(() => useItemNamesReady())
    await act(async () => {})
    expect(result.current).toBeNull()
    fakeDb(() => ({ data: [], error: null }))
    await act(async () => {
      await checkItemNames()
    })
    expect(result.current).toBe(true)
  })
})
