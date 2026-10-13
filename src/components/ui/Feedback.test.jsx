// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Feedback } from './Feedback'
import { askDialog, closeDialog } from '../../lib/feedback'

afterEach(() => {
  closeDialog(null)
  cleanup()
})

describe('a dialog with a date', () => {
  const open = () => {
    let answer
    act(() => {
      answer = askDialog({ title: 'Add a receipt photo', fields: [{ name: 'date', type: 'date', required: true, label: 'Shopping day', value: '2026-10-05' }], confirmLabel: 'Save' })
    })
    return answer
  }

  it('types the date like everywhere else and answers with the same YYYY-MM-DD', async () => {
    render(<Feedback />)
    const answer = open()
    const input = screen.getByLabelText('Shopping day')
    expect(input.value).toBe('05/10/2026')
    fireEvent.change(input, { target: { value: '101026' } })
    fireEvent.blur(input)
    expect(input.value).toBe('10/10/2026')
    fireEvent.click(screen.getByText('Save'))
    expect(await answer).toEqual({ date: '2026-10-10' })
  })

  it('does not accept an impossible date: it says what is wrong and waits', async () => {
    render(<Feedback />)
    const answer = open()
    const input = screen.getByLabelText('Shopping day')
    fireEvent.change(input, { target: { value: '31/04/2026' } })
    expect(screen.queryByText(/not a real date/)).toBeNull()
    fireEvent.click(screen.getByText('Save'))
    expect(screen.getByText('31/04/2026 is not a real date: April 2026 has 30 days.')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.change(input, { target: { value: '30/04/2026' } })
    fireEvent.click(screen.getByText('Save'))
    expect(await answer).toEqual({ date: '2026-04-30' })
  })
})
