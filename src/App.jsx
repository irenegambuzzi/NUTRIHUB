import { Routes, Route } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { AuthGate } from './components/auth/AuthGate'
import { PlannerPage } from './pages/PlannerPage'
import { ProfilesPage } from './pages/ProfilesPage'
import { RecipesPage } from './pages/RecipesPage'
import { GroceryPage } from './pages/GroceryPage'
import { ExpensesPage } from './pages/ExpensesPage'
import { PantryPage } from './pages/PantryPage'

export default function App() {
  return (
    <AuthGate>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<PlannerPage />} />
          <Route path="profiles" element={<ProfilesPage />} />
          <Route path="recipes" element={<RecipesPage />} />
          <Route path="grocery" element={<GroceryPage />} />
          <Route path="expenses" element={<ExpensesPage />} />
          <Route path="pantry" element={<PantryPage />} />
        </Route>
      </Routes>
    </AuthGate>
  )
}
