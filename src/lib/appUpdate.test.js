import { describe, expect, it } from 'vitest'
import { isSafeToReload, shouldAutoUpdate } from './appUpdate'

// A stand-in for the page: what has unsaved input, and what's focused.
const page = ({ unsaved = false, focused = null } = {}) => ({
  querySelector: (sel) => (sel === '[data-unsaved]' && unsaved ? {} : null),
  activeElement: focused ? { tagName: focused, isContentEditable: false } : { tagName: 'BODY', isContentEditable: false },
})

describe('updating to a new version', () => {
  it('is safe when nothing is waiting, open or being typed', () => {
    expect(isSafeToReload({ queue: [], syncing: false, dialog: null, toasts: [], doc: page() })).toBe(true)
  })

  it('waits while offline changes are queued or being sent', () => {
    expect(isSafeToReload({ queue: [{ id: 'op' }], syncing: false, dialog: null, doc: page() })).toBe(false)
    expect(isSafeToReload({ queue: [], syncing: true, dialog: null, doc: page() })).toBe(false)
  })

  it('waits while a dialog or a screen with unsaved input is open, or something is being typed', () => {
    expect(isSafeToReload({ queue: [], syncing: false, dialog: { title: 'x' }, doc: page() })).toBe(false)
    expect(isSafeToReload({ queue: [], syncing: false, dialog: null, doc: page({ unsaved: true }) })).toBe(false)
    expect(isSafeToReload({ queue: [], syncing: false, dialog: null, doc: page({ focused: 'INPUT' }) })).toBe(false)
    expect(isSafeToReload({ queue: [], syncing: false, dialog: null, toasts: [], doc: page({ focused: 'BUTTON' }) })).toBe(true)
  })

  it('never reloads while a toast still offers Undo', () => {
    const undo = [{ id: 1, message: 'Purchase confirmed', action: { label: 'Undo' } }]
    expect(isSafeToReload({ queue: [], syncing: false, dialog: null, toasts: undo, doc: page() })).toBe(false)
    expect(isSafeToReload({ queue: [], syncing: false, dialog: null, toasts: [{ id: 2, message: 'Saved' }], doc: page() })).toBe(true)
  })

  it('updates by itself only when safe and nobody is looking, or the app was just opened', () => {
    expect(shouldAutoUpdate({ safe: true, hidden: true, justOpened: false })).toBe(true)
    expect(shouldAutoUpdate({ safe: true, hidden: false, justOpened: true })).toBe(true)
    expect(shouldAutoUpdate({ safe: true, hidden: false, justOpened: false })).toBe(false)
    expect(shouldAutoUpdate({ safe: false, hidden: true, justOpened: true })).toBe(false)
  })
})
