import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { getCurrentWeekStart, legacyWeekStart } from '../lib/week'
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

  const fetchPlan = useCallback(async () => {
    if (!profileId) return
    const { data } = await supabase
      .from('meal_plan_entries')
      .select('*')
      .in('week_start', weekKeys)
      .eq('profile_id', profileId)
    const next = buildEmptyPlan()
    if (data) {
      const legacyFirst = [...data].sort((a, b) => (a.week_start === weekStart) - (b.week_start === weekStart))
      for (const entry of legacyFirst) {
        next[entry.day_of_week][entry.meal_type] = entry
      }
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
        // The old Sunday-keyed copy of this slot is replaced, not kept.
        await supabase
          .from('meal_plan_entries')
          .delete()
          .match({ week_start: weekKeys[0], day_of_week: day, meal_type: mealType, profile_id: profileId })
      }
      return { error }
    },
    [weekStart, weekKeys, profileId]
  )

  const clearMeal = useCallback(
    async (day, mealType) => {
      await supabase
        .from('meal_plan_entries')
        .delete()
        .in('week_start', weekKeys)
        .match({ day_of_week: day, meal_type: mealType, profile_id: profileId })
      setPlan((prev) => ({ ...prev, [day]: { ...prev[day], [mealType]: null } }))
    },
    [weekKeys, profileId]
  )

  const resetPlan = useCallback(async () => {
    await supabase.from('meal_plan_entries').delete().in('week_start', weekKeys).eq('profile_id', profileId)
    setPlan(buildEmptyPlan())
  }, [weekKeys, profileId])

  return { plan, loading, weekStart, setMeal, clearMeal, resetPlan }
}
