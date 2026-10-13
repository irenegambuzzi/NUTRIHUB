// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { DateField } from './DateField'

afterEach(cleanup)

// A DateField with its saved value shown next to it.
function Harness({ initial = '', required = false, onValidity }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <DateField label="Date" value={value} onChange={setValue} onValidity={onValidity} required={required} />
      <output data-testid="saved">{value}</output>
    </>
  )
}
const field = () => screen.getByLabelText('Date')
const type = (text) => fireEvent.change(field(), { target: { value: text } })
const leave = () => fireEvent.blur(field())
const saved = () => screen.getByTestId('saved').textContent

describe('the shared date field', () => {
  it('puts slashes in while digits are typed', () => {
    render(<Harness />)
    type('10102026')
    expect(field().value).toBe('10/10/2026')
    expect(saved()).toBe('2026-10-10')
  })

  it.each([
    ['10102026', '10/10/2026', '2026-10-10'],
    ['101026', '10/10/2026', '2026-10-10'],
    ['10-10-2026', '10/10/2026', '2026-10-10'],
    ['10.10.26', '10/10/2026', '2026-10-10'],
    ['1/2/26', '01/02/2026', '2026-02-01'],
  ])('%s shows %s after leaving the field and saves %s', (typed, shown, iso) => {
    render(<Harness />)
    type(typed)
    leave()
    expect(field().value).toBe(shown)
    expect(saved()).toBe(iso)
    expect(screen.queryByText(/not a real date|Incomplete/)).toBeNull()
  })

  it('never shows an error while typing, only after leaving, for an impossible date', () => {
    render(<Harness />)
    type('31/04/2026')
    expect(screen.queryByText(/not a real date/)).toBeNull()
    expect(field().getAttribute('aria-invalid')).toBe('false')
    leave()
    expect(screen.getByText('31/04/2026 is not a real date: April 2026 has 30 days.')).toBeTruthy()
    expect(field().getAttribute('aria-invalid')).toBe('true')
    // Typing again takes the message away until the field is left again.
    type('30/04/2026')
    expect(screen.queryByText(/not a real date/)).toBeNull()
  })

  it('says an incomplete date is incomplete, only after leaving', () => {
    render(<Harness />)
    type('10/10/202')
    expect(screen.queryByText(/Incomplete/)).toBeNull()
    leave()
    expect(screen.getByText(/Incomplete date/)).toBeTruthy()
  })

  it('tells the form while the text is not a real date, so it can hold back saving', () => {
    const seen = []
    render(<Harness initial="2026-10-05" onValidity={(ok) => seen.push(ok)} />)
    expect(field().value).toBe('05/10/2026')
    type('10/10/202')
    expect(seen.at(-1)).toBe(false)
    expect(saved()).toBe('2026-10-05')
    type('10/10/2026')
    expect(seen.at(-1)).toBe(true)
  })

  it('shows an existing saved date unchanged, and can remove an optional one', () => {
    render(<Harness initial="2024-02-29" />)
    expect(field().value).toBe('29/02/2024')
    fireEvent.click(screen.getByLabelText('Remove date'))
    expect(field().value).toBe('')
    expect(saved()).toBe('')
  })

  it('a required date has no remove button, keeps its value when emptied and asks for a date', () => {
    const onValidity = vi.fn()
    render(<Harness initial="2026-10-05" required onValidity={onValidity} />)
    expect(screen.queryByLabelText('Remove date')).toBeNull()
    type('')
    expect(saved()).toBe('2026-10-05')
    expect(onValidity).toHaveBeenLastCalledWith(false)
    leave()
    expect(screen.getByText(/Enter a date/)).toBeTruthy()
  })

  it('takes a date from the calendar picker', () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('Pick date from the calendar'), { target: { value: '2026-12-24' } })
    expect(field().value).toBe('24/12/2026')
    expect(saved()).toBe('2026-12-24')
  })
})
