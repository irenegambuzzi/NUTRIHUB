// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MoneyCategorySelect } from './MoneyCategorySelect'
import { categoryTree } from '../../lib/moneyList'

afterEach(cleanup)

// Stored in any order: the picker shows mains and subs A–Z, catch-alls last.
const categories = [
  { id: 'other', name: 'Other', parent_id: null },
  { id: 'trips', name: 'Trips & Holidays', parent_id: null },
  { id: 'trips:transport', name: 'Transport', parent_id: 'trips' },
  { id: 'trips:accommodation', name: 'Accommodation', parent_id: 'trips' },
  { id: 'trips:flights', name: 'Flights', parent_id: 'trips' },
  { id: 'bank', name: 'Bank & Fee', parent_id: null },
  { id: 'family', name: 'Family Support', parent_id: null },
]
const tree = categoryTree(categories)

// A form holding one category id, as the real forms do.
function Form({ start = '', onChange = () => {}, ...props }) {
  const [value, setValue] = useState(start)
  return (
    <MoneyCategorySelect
      value={value}
      onChange={(id, pick) => {
        setValue(id ?? '')
        onChange(id, pick)
      }}
      mainCategories={tree.mainCategories}
      subsOf={tree.subsOf}
      {...props}
    />
  )
}
const optionsOf = (label) => [...screen.getByLabelText(label).querySelectorAll('option')].map((o) => o.textContent)
const main = () => screen.getByLabelText('Budget category')
const sub = () => screen.getByLabelText('Budget category: sub-category')

describe('MoneyCategorySelect: main | sub, like HOME item category', () => {
  it('lists the mains A–Z with Other last, after "Uncategorized"', () => {
    render(<Form />)
    expect(optionsOf('Budget category')).toEqual(['Uncategorized', 'Bank & Fee', 'Family Support', 'Trips & Holidays', 'Other'])
  })

  it('lists the subs A–Z after "No sub-category"; a main without subs (or none) has a disabled right select', () => {
    render(<Form />)
    expect(sub().disabled).toBe(true)
    expect(optionsOf('Budget category: sub-category')).toEqual(['No sub-category'])
    fireEvent.change(main(), { target: { value: 'trips' } })
    expect(sub().disabled).toBe(false)
    expect(optionsOf('Budget category: sub-category')).toEqual(['No sub-category', 'Accommodation', 'Flights', 'Transport'])
    fireEvent.change(main(), { target: { value: 'family' } })
    expect(sub().disabled).toBe(true)
  })

  it('a main and then a sub give the right id (the sub when there is one)', () => {
    const onChange = vi.fn()
    render(<Form onChange={onChange} />)
    fireEvent.change(main(), { target: { value: 'trips' } })
    expect(onChange).toHaveBeenLastCalledWith('trips', { mainId: 'trips', subId: '' })
    fireEvent.change(sub(), { target: { value: 'trips:flights' } })
    expect(onChange).toHaveBeenLastCalledWith('trips:flights', { mainId: 'trips', subId: 'trips:flights' })
    fireEvent.change(sub(), { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith('trips', { mainId: 'trips', subId: '' })
  })

  it('changing the main resets the sub to "No sub-category"', () => {
    const onChange = vi.fn()
    render(<Form start="trips:flights" onChange={onChange} />)
    fireEvent.change(main(), { target: { value: 'bank' } })
    expect(onChange).toHaveBeenLastCalledWith('bank', { mainId: 'bank', subId: '' })
    expect(sub().value).toBe('')
  })

  it('an existing value (a sub id) opens with both columns filled', () => {
    render(<Form start="trips:transport" />)
    expect(main().value).toBe('trips')
    expect(sub().value).toBe('trips:transport')
  })

  it('"Uncategorized" gives null', () => {
    const onChange = vi.fn()
    render(<Form start="trips:flights" onChange={onChange} />)
    fireEvent.change(main(), { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith(null, { mainId: '', subId: '' })
  })

  it('the mapping screen keeps its default option first; income has no empty option', () => {
    render(<Form emptyLabel="Default: Groceries" label="Budget category for Dairy" />)
    expect(optionsOf('Budget category for Dairy')[0]).toBe('Default: Groceries')
    cleanup()
    render(<Form start="bank" emptyLabel={null} label="Income category" />)
    expect(optionsOf('Income category')).toEqual(['Bank & Fee', 'Family Support', 'Trips & Holidays', 'Other'])
  })

  it('the sliders button opens the manager; without onManage there is none', () => {
    const onManage = vi.fn()
    render(<Form onManage={onManage} />)
    fireEvent.click(screen.getByRole('button', { name: 'Manage budget categories' }))
    expect(onManage).toHaveBeenCalledTimes(1)
    cleanup()
    render(<Form />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
