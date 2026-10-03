import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// Rendering only: no effects run, so nothing is loaded from Supabase.
vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
const { Layout } = await import('../components/layout/Layout')
const { PlannerPage } = await import('./PlannerPage')
const { RecipesPage } = await import('./RecipesPage')
const { ProfilesPage } = await import('./ProfilesPage')
const { GroceryPage } = await import('./GroceryPage')
const { PantryPage } = await import('./PantryPage')
const { ExpensesPage } = await import('./ExpensesPage')

function render(path) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<PlannerPage />} />
          <Route path="recipes" element={<RecipesPage />} />
          <Route path="profiles" element={<ProfilesPage />} />
          <Route path="grocery" element={<GroceryPage />} />
          <Route path="pantry" element={<PantryPage />} />
          <Route path="expenses" element={<ExpensesPage />} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

describe('every page renders inside the layout', () => {
  it.each([
    ['/', 'Weekly Meal Plan'],
    ['/recipes', 'Recipes'],
    ['/profiles', 'Profiles'],
    ['/grocery', 'Grocery List'],
    ['/pantry', 'Home Inventory'],
    ['/expenses', 'Expenses'],
  ])('%s', (path, heading) => {
    const html = render(path)
    expect(html).toContain(heading)
    // The four tabs.
    for (const tab of ['Plan', 'Shop', 'Home', 'Money']) expect(html).toContain(`>${tab}</span>`)
  })

  it('shows Week / Recipes / Profiles tabs inside Plan', () => {
    const html = render('/recipes')
    expect(html).toContain('>Week</a>')
    expect(html).toContain('>Profiles</a>')
  })

  it('explains that deleting history keeps stock as it is', async () => {
    const { HistoryView } = await import('../components/inventory/HistoryView')
    const html = renderToStaticMarkup(<HistoryView />)
    expect(html).toContain('Deleting history only removes the record')
  })
})
