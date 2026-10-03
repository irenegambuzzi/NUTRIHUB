import { useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input, Select } from '../components/ui/Field'
import { cn } from '../lib/cn'
import { useMealPlan } from '../hooks/useMealPlan'
import { useRecipes } from '../hooks/useRecipes'
import { useProfiles } from '../hooks/useProfiles'
import { WEEKDAYS, WEEKDAY_SHORT_LABELS, MEAL_TYPES, MEAL_TYPE_LABELS } from '../data/constants'

export function PlannerPage() {
  const { profiles } = useProfiles()
  const [selectedProfileId, setSelectedProfileId] = useState('irene')
  const { plan, loading, setMeal, clearMeal, resetPlan } = useMealPlan(selectedProfileId)
  const { recipes } = useRecipes()
  const [selectedDay, setSelectedDay] = useState('Monday')

  const dayPlan = plan[selectedDay]

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-extrabold text-[var(--color-primary)]">Weekly Meal Plan</h2>
        <Button variant="ghost" onClick={resetPlan} className="px-2.5 py-1 text-xs">
          <RefreshCw size={12} /> Reset
        </Button>
      </div>

      {profiles.length > 0 && (
        <div className="flex gap-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full p-1 w-fit">
          {profiles.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedProfileId(p.id)}
              className={cn(
                'px-4 py-1.5 rounded-full text-xs font-bold transition-all duration-200',
                selectedProfileId === p.id ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-muted)]'
              )}
            >
              {p.display_name}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-1 overflow-x-auto pb-1 text-xs">
        {WEEKDAYS.map((day) => (
          <button
            key={day}
            onClick={() => setSelectedDay(day)}
            className={cn(
              'px-4 py-2 rounded-full border font-bold transition-all duration-200 whitespace-nowrap',
              selectedDay === day
                ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-white shadow-sm'
                : 'bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-muted)]'
            )}
          >
            {WEEKDAY_SHORT_LABELS[day]}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-xs text-[var(--color-text-muted)]">Loading…</p>
      ) : (
        <Card className="space-y-4">
          <div className="border-b border-[var(--color-border)] pb-2">
            <span className="text-xs font-bold text-[var(--color-accent)] uppercase">Today&apos;s menu</span>
          </div>

          {MEAL_TYPES.map((mealType) => (
            <MealSlot
              key={`${mealType}-${dayPlan[mealType]?.id || 'empty'}`}
              mealType={mealType}
              entry={dayPlan[mealType]}
              recipes={recipes}
              onSetCustomText={(text) => setMeal(selectedDay, mealType, { customText: text })}
              onSelectRecipe={(recipeId) => setMeal(selectedDay, mealType, { recipeId })}
              onClear={() => clearMeal(selectedDay, mealType)}
            />
          ))}
        </Card>
      )}
    </div>
  )
}

function MealSlot({ mealType, entry, recipes, onSetCustomText, onSelectRecipe, onClear }) {
  const [text, setText] = useState(entry?.custom_text || '')

  const linkedRecipe = entry?.recipe_id ? recipes.find((r) => r.id === entry.recipe_id) : null

  return (
    <div className="bg-[var(--color-surface-soft)] p-3 rounded-xl border border-[var(--color-border)] space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-xs font-bold text-[var(--color-text)]">{MEAL_TYPE_LABELS[mealType]}</span>
        {entry && (
          <button onClick={onClear} className="text-[var(--color-icon-muted)] hover:text-rose-400">
            <X size={14} />
          </button>
        )}
      </div>

      {linkedRecipe ? (
        <div className="bg-[var(--color-accent-bg)] border border-[var(--color-accent-border)] rounded-lg p-2 text-xs font-semibold text-[var(--color-accent)] flex items-center gap-1.5">
          {linkedRecipe.title} ({linkedRecipe.calories} kcal)
        </div>
      ) : (
        <Input
          placeholder={`Plan ${MEAL_TYPE_LABELS[mealType].toLowerCase()}…`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => onSetCustomText(text)}
          className="text-xs"
        />
      )}

      {recipes.length > 0 && (
        <Select
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) onSelectRecipe(e.target.value)
          }}
          className="text-[11px] bg-[var(--color-accent-bg)] border-[var(--color-accent-border)] text-[var(--color-accent)] font-semibold p-1.5"
        >
          <option value="" disabled>
            + Choose from saved recipes…
          </option>
          {recipes.map((r) => (
            <option key={r.id} value={r.id}>
              🍳 {r.title} ({r.calories} kcal)
            </option>
          ))}
        </Select>
      )}
    </div>
  )
}
