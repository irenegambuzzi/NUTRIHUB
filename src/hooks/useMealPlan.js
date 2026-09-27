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

export function useMealPlan(profileId) {
  const weekStart = useMemo(() => getCurrentWeekStart(), [])
  const [plan, setPlan] = useState(buildEmptyPlan)
  const [loading, setLoading] = useState(true)

  const fetchPlan = useCallback(async () => {
    if (!profileId) return
    const { data } = await supabase
      .from('meal_plan_entries')
      .select('*')
      .eq('week_start', weekStart)
      .eq('profile_id', profileId)
    const next = buildEmptyPlan()
    if (data) {
      for (const entry of data) {
        next[entry.day_of_week][entry.meal_type] = entry
      }
    }
    setPlan(next)
    setLoading(false)
  }, [weekStart, profileId])

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
          { week_start: weekStart, day_of_week: day, meal_type: mealType, profile_id: profileId, recipe_id: recipeId, custom_text: customText },
          { onConflict: 'week_start,day_of_week,meal_type,profile_id' }
        )
        .select()
        .single()

      if (!error && data) {
        setPlan((prev) => ({ ...prev, [day]: { ...prev[day], [mealType]: data } }))
      }
      return { error }
    },
    [weekStart, profileId]
  )

  const clearMeal = useCallback(
    async (day, mealType) => {
      await supabase
        .from('meal_plan_entries')
        .delete()
        .match({ week_start: weekStart, day_of_week: day, meal_type: mealType, profile_id: profileId })
      setPlan((prev) => ({ ...prev, [day]: { ...prev[day], [mealType]: null } }))
    },
    [weekStart, profileId]
  )

  const resetPlan = useCallback(async () => {
    await supabase.from('meal_plan_entries').delete().eq('week_start', weekStart).eq('profile_id', profileId)
    setPlan(buildEmptyPlan())
  }, [weekStart, profileId])

  return { plan, loading, weekStart, setMeal, clearMeal, resetPlan }
}
