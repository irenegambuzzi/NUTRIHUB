import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { getCurrentWeekStart } from '../lib/week'
import { WEEKDAYS, MEAL_TYPES } from '../data/constants'

function buildEmptyPlan() {
  const plan = {}
  for (const day of WEEKDAYS) {
    plan[day] = {}
    for (const meal of MEAL_TYPES) plan[day][meal] = null
  }
  return plan
}

export function useMealPlan() {
  const weekStart = useMemo(() => getCurrentWeekStart(), [])
  const [plan, setPlan] = useState(buildEmptyPlan)
  const [loading, setLoading] = useState(true)

  const fetchPlan = useCallback(async () => {
    const { data } = await supabase.from('meal_plan_entries').select('*').eq('week_start', weekStart)
    const next = buildEmptyPlan()
    if (data) {
      for (const entry of data) {
        next[entry.day_of_week][entry.meal_type] = entry
      }
    }
    setPlan(next)
    setLoading(false)
  }, [weekStart])

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
      const { data, error } = await supabase
        .from('meal_plan_entries')
        .upsert(
          { week_start: weekStart, day_of_week: day, meal_type: mealType, recipe_id: recipeId, custom_text: customText },
          { onConflict: 'week_start,day_of_week,meal_type' }
        )
        .select()
        .single()

      if (!error && data) {
        setPlan((prev) => ({ ...prev, [day]: { ...prev[day], [mealType]: data } }))
      }
      return { error }
    },
    [weekStart]
  )

  const clearMeal = useCallback(
    async (day, mealType) => {
      await supabase
        .from('meal_plan_entries')
        .delete()
        .match({ week_start: weekStart, day_of_week: day, meal_type: mealType })
      setPlan((prev) => ({ ...prev, [day]: { ...prev[day], [mealType]: null } }))
    },
    [weekStart]
  )

  const resetPlan = useCallback(async () => {
    await supabase.from('meal_plan_entries').delete().eq('week_start', weekStart)
    setPlan(buildEmptyPlan())
  }, [weekStart])

  return { plan, loading, weekStart, setMeal, clearMeal, resetPlan }
}
