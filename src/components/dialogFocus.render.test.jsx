// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

// Plan 9J, K15: the keyboard in a question (askDialog / confirmDialog) —
// the confirm button has the focus (unless a drop-down, date or number
// field takes it), Tab and Shift+Tab go round inside the question,
// Escape is Cancel, and afterwards the focus goes back to the button (or,
// answered with the keyboard, the drop-down) it came from. And K14: equal
// toasts with Retry are all shown, in a column that scrolls past ~45 % of
// the screen.
vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('../hooks/useShops', () => ({ useShops: () => ({ ready: false, missing: false, shops: [], byId: new Map() }) }))
vi.mock('../hooks/useFlow', () => ({ FLOW_NOTICE: '', useFlow: () => ({ ready: false }) }))
vi.mock('../hooks/useCategorySuggestions', () => ({
  useCategorySuggestions: () => ({ suggest: () => null, suggestions: () => [], budgetSuggestions: () => [], remember: vi.fn(), rememberBudget: vi.fn() }),
}))

const { Feedback } = await import('./ui/Feedback')
const { ItemEditor } = await import('./inventory/ItemEditor')
const { askDialog, closeDialog, confirmDialog, dismissToast, getToasts, toastSaveError } = await import('../lib/feedback')

afterEach(() => {
  act(() => closeDialog(null))
  getToasts().forEach((t) => dismissToast(t.id))
  cleanup()
  vi.restoreAllMocks()
})

const question = () => screen.getByRole('dialog')
const focused = () => document.activeElement
const tab = (shiftKey = false) => fireEvent.keyDown(focused() ?? document.body, { key: 'Tab', shiftKey })
const choices = {
  title: 'Cancel or return "Rain Jacket"?',
  fields: [
    {
      name: 'kind',
      type: 'choice',
      label: 'Mark it as',
      value: 'cancelled',
      options: [
        { value: 'cancelled', label: 'Cancelled' },
        { value: 'returned', label: 'Returned' },
      ],
    },
  ],
  confirmLabel: 'Move to History',
}

describe('the focus in a question', () => {
  it('a question with choices: the confirm button has it; Tab goes round inside (the checked choice, Cancel, confirm, and back)', async () => {
    render(<Feedback />)
    act(() => void askDialog(choices))
    const confirm = await screen.findByRole('button', { name: 'Move to History' })
    expect(focused()).toBe(confirm)
    tab()
    expect(focused()).toBe(within(question()).getAllByRole('radio')[0])
    tab()
    expect(focused()).toBe(within(question()).getByRole('button', { name: 'Cancel' }))
    tab()
    expect(focused()).toBe(confirm)
    tab(true)
    tab(true)
    expect(focused()).toBe(within(question()).getAllByRole('radio')[0])
    tab(true)
    expect(focused()).toBe(confirm)
  })

  it('a drop-down first keeps the focus for itself, as before', async () => {
    render(<Feedback />)
    act(() => void askDialog({ title: 'Which store?', fields: [{ name: 'shop', type: 'select', options: [{ value: 'a', label: 'Zooplus' }] }] }))
    await screen.findByText('Which store?')
    expect(focused().tagName).toBe('SELECT')
  })

  it('Escape is Cancel', async () => {
    render(<Feedback />)
    let answer
    act(() => void askDialog(choices).then((a) => (answer = a)))
    await screen.findByText('Cancel or return "Rain Jacket"?')
    fireEvent.keyDown(focused(), { key: 'Escape' })
    await waitFor(() => expect(answer).toBeNull())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('afterwards the focus goes back to the button the question came from — never to a text field', async () => {
    render(
      <>
        <button type="button">Back on the way</button>
        <input aria-label="Name" />
        <Feedback />
      </>
    )
    const opener = screen.getByRole('button', { name: 'Back on the way' })
    opener.focus()
    let done
    act(() => void confirmDialog({ title: 'Put "Desk Lamp" back on the way?', confirmLabel: 'Put back on the way' }).then((ok) => (done = ok)))
    fireEvent.click(await screen.findByRole('button', { name: 'Put back on the way' }))
    await waitFor(() => expect(done).toBe(true))
    expect(focused()).toBe(opener)

    const field = screen.getByLabelText('Name')
    field.focus()
    act(() => void confirmDialog({ title: 'Log out?', confirmLabel: 'Log out' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(focused()).not.toBe(field)
  })
})

describe('Home → Items → "Flour" (in gr) → "Edit item" → Unit → kg', () => {
  const flour = { id: 'p-flour', name: 'Flour', category_id: 'pantry-staples', unit: 'gr', current_stock: 500, min_stock: 250, created_at: '2026-10-15T08:00:00Z' }
  const unitSelect = () => [...document.querySelectorAll('select')].find((s) => s.value === 'gr' || s.value === 'kg')

  it('Tab can never reach "Save changes" behind the question; Enter answers the question, and the editor stays open, unsaved', async () => {
    const onSave = vi.fn(async () => ({ error: null }))
    render(
      <>
        <ItemEditor item={flour} parents={[]} subsByParent={new Map()} onSave={onSave} onClose={() => {}} />
        <Feedback />
      </>
    )
    const select = unitSelect()
    select.focus()
    fireEvent.keyDown(select, { key: 'ArrowDown' })
    fireEvent.change(select, { target: { value: 'kg' } })
    await screen.findByText('Count "Flour" in kg instead of gr?')
    const change = within(question()).getByRole('button', { name: 'Change unit' })
    expect(focused()).toBe(change)
    const save = screen.getByRole('button', { name: 'Save changes' })
    for (let i = 0; i < 8; i++) {
      tab(i % 3 === 2)
      expect(question().contains(focused())).toBe(true)
      expect(focused()).not.toBe(save)
    }
    // Back on "Change unit", Enter (the browser submits the question's form).
    while (focused() !== change) tab()
    fireEvent.keyDown(change, { key: 'Enter' })
    fireEvent.submit(change.closest('form'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(unitSelect().value).toBe('kg')
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Edit item')).toBeTruthy()
    // Answered with the keyboard: the focus is back on the Unit drop-down.
    expect(focused()).toBe(unitSelect())
  })
})

describe('toasts with Retry (K14)', () => {
  it('two equal ones are both shown, each with its own Retry, in a column with a height limit that scrolls', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<Feedback />)
    const first = vi.fn()
    const second = vi.fn()
    act(() => {
      toastSaveError({ message: 'Load failed' }, first)
      toastSaveError({ message: 'Load failed' }, second)
    })
    const retries = await screen.findAllByRole('button', { name: 'Retry' })
    expect(retries).toHaveLength(2)
    fireEvent.click(retries[1])
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
    const column = document.querySelector('[data-toasts]')
    expect(column.className).toContain('max-h-[45vh]')
    expect(column.className).toContain('overflow-y-auto')
    expect(column.className).toContain('overflow-x-hidden')
  })
})
