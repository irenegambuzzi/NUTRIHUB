import { NavLink, Outlet } from 'react-router-dom'
import { Calendar, User, Home, ShoppingBag, BookOpen, Wallet } from 'lucide-react'
import { cn } from '../../lib/cn'

const NAV_ITEMS = [
  { to: '/', label: 'Planner', icon: Calendar },
  { to: '/profiles', label: 'Profiles', icon: User },
  { to: '/recipes', label: 'Recipes', icon: BookOpen },
  { to: '/grocery', label: 'Grocery', icon: ShoppingBag },
  { to: '/expenses', label: 'Expenses', icon: Wallet },
  { to: '/pantry', label: 'Pantry', icon: Home },
]

export function Layout() {
  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] font-sans md:flex">
      <header className="bg-[var(--color-surface)] border-b border-[var(--color-border)] p-4 sticky top-0 z-10 shadow-sm md:hidden">
        <h1 className="text-lg font-bold text-[var(--color-primary)]">Home & Nutri Hub</h1>
      </header>

      <aside className="hidden md:flex md:flex-col md:w-56 md:shrink-0 md:border-r md:border-[var(--color-border)] md:bg-[var(--color-surface)] md:p-4 md:sticky md:top-0 md:h-screen">
        <h1 className="text-lg font-bold text-[var(--color-primary)] mb-6 px-2">Home & Nutri Hub</h1>
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition',
                  isActive
                    ? 'bg-[var(--color-surface-soft)] text-[var(--color-primary)]'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-primary)]'
                )
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="flex-1 w-full max-w-4xl mx-auto p-4 md:p-8 pb-24 md:pb-8">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-[var(--color-surface)] border-t border-[var(--color-border)] p-2 z-20 shadow-lg md:hidden">
        <div className="grid grid-cols-6 gap-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center p-2 rounded-xl transition',
                  isActive ? 'text-[var(--color-primary)] bg-[var(--color-surface-soft)] font-bold' : 'text-[var(--color-text-muted)]'
                )
              }
            >
              <Icon size={18} />
              <span className="text-[9px] mt-1">{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
