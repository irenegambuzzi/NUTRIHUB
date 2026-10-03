import { useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { getCurrentWeekStart, legacyWeekStart } from '../lib/week'
import { attempt, deleteWithUndo, followUp, must } from '../lib/db'
import { mealPlanWeek } from '../lib/stores'
import { WEEKDAYS, MEAL_TYPES } from '../data/constants'

function buildEmptyPlan() {
  const plan = {}
  for (const day of WEEKDAYS) {
    plan[day] = {}
    for (const meal of MEAL_TYPES) plan[day][meal] = null
  }
  return plan
}

export function useMealPlan(profileId) {
  const weekStart = useMemo(() => getCurrentWeekStart(), [])
  // Weeks saved before the time zone fix are keyed by the Sunday before.
  // They're still read; anything saved now uses the Monday and wins.
  const weekKeys = useMemo(() => [legacyWeekStart(weekStart), weekStart], [weekStart])
  const store = mealPlanWeek(weekKeys.join(','))
  const { rows, loaded } = store.useRows()
  const loading = !loaded
  const fetchPlan = store.refresh

  // This person's meals; an old Sunday-keyed copy is used only where the
  // Monday-keyed week has nothing for that slot.
  const plan = useMemo(() => {
    const next = buildEmptyPlan()
    const legacyFirst = rows.filter((e) => e.profile_id === profileId).sort((a, b) => (a.week_start === weekStart) - (b.week_start === weekStart))
    for (const entry of legacyFirst) next[entry.day_of_week][entry.meal_type] = entry
    return next
  }, [rows, profileId, weekStart])

  const setMeal = useCallback(
    async (day, mealType, { recipeId = null, customText = null }) => {
      const result = await attempt(
        async () => {
          const data = must(
            await supabase
              .from('meal_plan_entries')
              .upsert(
                { week_start: weekStart, day_of_week: day, meal_type: mealType, profile_id: profileId, recipe_id: recipeId, custom_text: customText },
                { onConflict: 'week_start,day_of_week,meal_type,profile_id' }
              )
              .select()
              .single()
          )
          store.upsertLocal([data])
        },
        { onFail: fetchPlan }
      )
      if (!result.error) {
        // The old Sunday-keyed copy of this slot is replaced, not kept.
        await followUp('the old copy of this meal', async () => {
          const removed = must(
            await supabase
              .from('meal_plan_entries')
              .delete()
              .match({ week_start: weekKeys[0], day_of_week: day, meal_type: mealType, profile_id: profileId })
              .select('id')
          )
          store.removeLocal(removed.map((r) => r.id))
        })
      }
      return result
    },
    [weekStart, weekKeys, profileId, fetchPlan, store]
  )

  const clearMeal = useCallback(
    (day, mealType) =>
      attempt(
        async () => {
          const removed = must(
            await supabase
              .from('meal_plan_entries')
              .delete()
              .in('week_start', weekKeys)
              .match({ day_of_week: day, meal_type: mealType, profile_id: profileId })
              .select('id')
          )
          store.removeLocal(removed.map((r) => r.id))
        },
        { onFail: fetchPlan }
      ),
    [weekKeys, profileId, fetchPlan, store]
  )

  // Clears the week right away; Undo puts every meal back.
  const resetPlan = useCallback(
    () =>
      deleteWithUndo({
        message: 'Week cleared',
        remove: async () => {
          const rows = must(await supabase.from('meal_plan_entries').delete().in('week_start', weekKeys).eq('profile_id', profileId).select())
          store.removeLocal(rows.map((r) => r.id))
          return rows
        },
        restore: async (rows) => {
          if (rows.length) must(await supabase.from('meal_plan_entries').upsert(rows))
          await fetchPlan()
        },
        onFail: fetchPlan,
      }),
    [weekKeys, profileId, fetchPlan, store]
  )

  return { plan, loading, weekStart, setMeal, clearMeal, resetPlan }
}
