import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { attempt, deleteWithUndo, must } from '../lib/db'
import { toastLoadError } from '../lib/feedback'

export function useRecipes() {
  const [recipes, setRecipes] = useState([])

  const fetchRecipes = useCallback(async function fetchRecipes() {
    const { data, error } = await supabase.from('recipes').select('*').order('created_at', { ascending: false })
    if (error) return toastLoadError(error, fetchRecipes, 'recipes')
    setRecipes(data)
  }, [])

  useEffect(() => {
    fetchRecipes()
    const channel = supabase
      .channel(`recipes-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recipes' }, fetchRecipes)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [fetchRecipes])

  const addRecipe = useCallback(async ({ title, calories, instructions, isAiGenerated = false }) => {
    const { data, error } = await attempt(
      async () => must(await supabase.from('recipes').insert([{ title, calories, instructions, is_ai_generated: isAiGenerated }]).select())[0],
      { retry: false }
    )
    if (!error) setRecipes((prev) => [data, ...prev])
    return { data, error }
  }, [])

  // Deletes right away; Undo puts the recipe back and re-links the meal
  // plan entries that used it (the database unlinks them on delete).
  const deleteRecipe = useCallback(
    (recipe) =>
      deleteWithUndo({
        message: `Deleted "${recipe.title}"`,
        remove: async () => {
          const meals = must(await supabase.from('meal_plan_entries').select('id').eq('recipe_id', recipe.id))
          const [row] = must(await supabase.from('recipes').delete().eq('id', recipe.id).select())
          setRecipes((prev) => prev.filter((r) => r.id !== recipe.id))
          return { row, mealIds: meals.map((m) => m.id) }
        },
        restore: async ({ row, mealIds }) => {
          if (row) must(await supabase.from('recipes').upsert(row))
          if (mealIds.length) must(await supabase.from('meal_plan_entries').update({ recipe_id: recipe.id }).in('id', mealIds))
          await fetchRecipes()
        },
        onFail: fetchRecipes,
      }),
    [fetchRecipes]
  )

  return { recipes, addRecipe, deleteRecipe }
}
