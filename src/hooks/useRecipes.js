import { useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { attempt, deleteWithUndo, must } from '../lib/db'
import { recipeStore } from '../lib/stores'

export function useRecipes() {
  const { rows: recipes } = recipeStore.useRows()
  const fetchRecipes = recipeStore.refresh

  const addRecipe = useCallback(async ({ title, calories, instructions, isAiGenerated = false }) => {
    const { data, error } = await attempt(
      async () => must(await supabase.from('recipes').insert([{ title, calories, instructions, is_ai_generated: isAiGenerated }]).select())[0],
      { retry: false }
    )
    if (!error) recipeStore.upsertLocal([data])
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
          recipeStore.removeLocal([recipe.id])
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
