import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Calendar, Home, ShoppingBag, Wallet } from 'lucide-react'
import { cn } from '../../lib/cn'
import { Feedback } from '../ui/Feedback'
import { SyncStatus } from './SyncStatus'
import { UpdateBanner } from './UpdateBanner'

// Four sections; Plan also holds Recipes and Profiles as its own tabs.
const SECTIONS = [
  {
    label: 'Plan',
    icon: Calendar,
    to: '/',
    pages: [
      { to: '/', label: 'Week' },
      { to: '/recipes', label: 'Recipes' },
      { to: '/profiles', label: 'Profiles' },
    ],
  },
  { label: 'Shop', icon: ShoppingBag, to: '/grocery', pages: [{ to: '/grocery', label: 'Grocery' }] },
  { label: 'Home', icon: Home, to: '/pantry', pages: [{ to: '/pantry', label: 'Pantry' }] },
  { label: 'Money', icon: Wallet, to: '/expenses', pages: [{ to: '/expenses', label: 'Expenses' }] },
]

const sectionOf = (path) => SECTIONS.find((s) => s.pages.some((p) => p.to === path)) ?? SECTIONS[0]

export function Layout() {
  const { pathname } = useLocation()
  const section = sectionOf(pathname)

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] font-sans md:flex">
      {/* Mobile header; the top padding keeps it clear of the status bar
          when opened full screen from the home screen. */}
      <header className="bg-[var(--color-surface)] border-b border-[var(--color-border)] px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] sticky top-0 z-10 shadow-sm md:hidden flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-[var(--color-primary)]">Home & Nutri Hub</h1>
        <SyncStatus />
      </header>

      <aside className="hidden md:flex md:flex-col md:w-56 md:shrink-0 md:border-r md:border-[var(--color-border)] md:bg-[var(--color-surface)] md:p-4 md:sticky md:top-0 md:h-screen">
        <h1 className="text-lg font-bold text-[var(--color-primary)] mb-6 px-2">Home & Nutri Hub</h1>
        <nav className="flex flex-col gap-1">
          {SECTIONS.map(({ label, icon: Icon, to, pages }) => (
            <div key={label}>
              <NavLink
                to={to}
                end
                className={() =>
                  cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition',
                    section.label === label
                      ? 'bg-[var(--color-surface-soft)] text-[var(--color-primary)]'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-primary)]'
                  )
                }
              >
                <Icon size={18} />
                {label}
              </NavLink>
              {pages.length > 1 && (
                <div className="flex flex-col ml-9 mt-0.5 mb-1">
                  {pages.map((p) => (
                    <NavLink
                      key={p.to}
                      to={p.to}
                      end
                      className={({ isActive }) =>
                        cn(
                          'px-2 py-1.5 rounded-lg text-xs font-semibold transition',
                          isActive ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-primary)]'
                        )
                      }
                    >
                      {p.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
        <SyncStatus className="mt-auto self-start" />
      </aside>

      <main className="flex-1 w-full max-w-4xl mx-auto p-4 md:p-8 pb-[calc(env(safe-area-inset-bottom)+7rem)] md:pb-8">
        {/* A section with several pages (Plan) gets tabs on phones. */}
        {section.pages.length > 1 && (
          <div className="md:hidden flex bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full p-1 mb-4 text-sm font-bold">
            {section.pages.map((p) => (
              <NavLink
                key={p.to}
                to={p.to}
                end
                className={({ isActive }) =>
                  cn(
                    'flex-1 text-center px-3 py-2 rounded-full transition-all duration-200',
                    isActive ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-muted)]'
                  )
                }
              >
                {p.label}
              </NavLink>
            ))}
          </div>
        )}
        <Outlet />
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-[var(--color-surface)] border-t border-[var(--color-border)] px-2 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] z-20 shadow-lg md:hidden">
        <div className="grid grid-cols-4 gap-1">
          {SECTIONS.map(({ label, icon: Icon, to }) => (
            <NavLink
              key={label}
              to={to}
              end
              className={() =>
                cn(
                  'flex flex-col items-center gap-1 py-2 rounded-2xl transition',
                  section.label === label ? 'text-[var(--color-primary)] bg-[var(--color-surface-soft)] font-bold' : 'text-[var(--color-text-muted)] font-semibold'
                )
              }
            >
              <Icon size={24} />
              <span className="text-xs">{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      <UpdateBanner />
      <Feedback />
    </div>
  )
}
