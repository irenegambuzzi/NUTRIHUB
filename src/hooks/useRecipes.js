import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export function useRecipes() {
  const [recipes, setRecipes] = useState([])

  const fetchRecipes = useCallback(async () => {
    const { data } = await supabase.from('recipes').select('*').order('created_at', { ascending: false })
    if (data) setRecipes(data)
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
    const { data, error } = await supabase
      .from('recipes')
      .insert([{ title, calories, instructions, is_ai_generated: isAiGenerated }])
      .select()

    if (!error && data) setRecipes((prev) => [data[0], ...prev])
    return { data: data?.[0], error }
  }, [])

  const deleteRecipe = useCallback(async (id) => {
    await supabase.from('recipes').delete().eq('id', id)
    setRecipes((prev) => prev.filter((r) => r.id !== id))
  }, [])

  return { recipes, addRecipe, deleteRecipe }
}
