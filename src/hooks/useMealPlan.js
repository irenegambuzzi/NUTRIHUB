import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { getCurrentWeekStart, legacyWeekStart } from '../lib/week'
import { attempt, deleteWithUndo, followUp, must } from '../lib/db'
import { toastLoadError } from '../lib/feedback'
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
  const [plan, setPlan] = useState(buildEmptyPlan)
  const [loading, setLoading] = useState(true)

  const fetchPlan = useCallback(async function fetchPlan() {
    if (!profileId) return
    const { data, error } = await supabase.from('meal_plan_entries').select('*').in('week_start', weekKeys).eq('profile_id', profileId)
    if (error) return toastLoadError(error, fetchPlan, 'meal_plan_entries')
    const next = buildEmptyPlan()
    const legacyFirst = [...data].sort((a, b) => (a.week_start === weekStart) - (b.week_start === weekStart))
    for (const entry of legacyFirst) {
      next[entry.day_of_week][entry.meal_type] = entry
    }
    setPlan(next)
    setLoading(false)
  }, [weekStart, weekKeys, profileId])

  useEffect(() => {
    fetchPlan()
    const channel = supabase
      .channel(`meal_plan_entries-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meal_plan_entries' }, fetchPlan)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [fetchPlan])

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
          setPlan((prev) => ({ ...prev, [day]: { ...prev[day], [mealType]: data } }))
        },
        { onFail: fetchPlan }
      )
      if (!result.error) {
        // The old Sunday-keyed copy of this slot is replaced, not kept.
        await followUp('the old copy of this meal', async () =>
          must(
            await supabase
              .from('meal_plan_entries')
              .delete()
              .match({ week_start: weekKeys[0], day_of_week: day, meal_type: mealType, profile_id: profileId })
          )
        )
      }
      return result
    },
    [weekStart, weekKeys, profileId, fetchPlan]
  )

  const clearMeal = useCallback(
    (day, mealType) =>
      attempt(
        async () => {
          must(
            await supabase
              .from('meal_plan_entries')
              .delete()
              .in('week_start', weekKeys)
              .match({ day_of_week: day, meal_type: mealType, profile_id: profileId })
          )
          setPlan((prev) => ({ ...prev, [day]: { ...prev[day], [mealType]: null } }))
        },
        { onFail: fetchPlan }
      ),
    [weekKeys, profileId, fetchPlan]
  )

  // Clears the week right away; Undo puts every meal back.
  const resetPlan = useCallback(
    () =>
      deleteWithUndo({
        message: 'Week cleared',
        remove: async () => {
          const rows = must(await supabase.from('meal_plan_entries').delete().in('week_start', weekKeys).eq('profile_id', profileId).select())
          setPlan(buildEmptyPlan())
          return rows
        },
        restore: async (rows) => {
          if (rows.length) must(await supabase.from('meal_plan_entries').upsert(rows))
          await fetchPlan()
        },
        onFail: fetchPlan,
      }),
    [weekKeys, profileId, fetchPlan]
  )

  return { plan, loading, weekStart, setMeal, clearMeal, resetPlan }
}
