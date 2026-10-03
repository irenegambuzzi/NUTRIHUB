import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input, Textarea } from '../components/ui/Field'
import { useRecipes } from '../hooks/useRecipes'

export function RecipesPage() {
  const { recipes, addRecipe, deleteRecipe } = useRecipes()

  const [title, setTitle] = useState('')
  const [calories, setCalories] = useState('')
  const [instructions, setInstructions] = useState('')

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!title.trim()) return
    const { error } = await addRecipe({
      title,
      calories: parseInt(calories, 10) || 400,
      instructions,
    })
    // On failure the toast explains and the form keeps what was typed.
    if (error) return
    setTitle('')
    setCalories('')
    setInstructions('')
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-extrabold text-[var(--color-primary)]">Recipes</h2>

      <form onSubmit={handleAdd}>
        <Card className="space-y-3">
          <p className="text-xs font-bold text-[var(--color-primary)] uppercase">Add a recipe</p>
          <Input placeholder="Recipe title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input type="number" placeholder="Calories per serving (kcal)" value={calories} onChange={(e) => setCalories(e.target.value)} />
          <Textarea placeholder="Ingredients and steps…" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          <Button type="submit" className="w-full">
            Save recipe
          </Button>
        </Card>
      </form>

      <div className="space-y-3">
        {recipes.length === 0 ? (
          <Card className="text-center">
            <p className="text-xs font-bold text-[var(--color-text)]">No recipes yet</p>
          </Card>
        ) : (
          recipes.map((r) => <RecipeCard key={r.id} recipe={r} onDelete={deleteRecipe} />)
        )}
      </div>
    </div>
  )
}

function RecipeCard({ recipe, onDelete }) {
  return (
    <Card className="space-y-2 relative">
      <div className="flex justify-between items-start pr-6">
        <h3 className="text-sm font-bold text-[var(--color-text)]">{recipe.title}</h3>
        <span className="text-xs font-mono font-bold text-[var(--color-accent)] bg-[var(--color-surface-soft)] px-2 py-0.5 rounded-md border border-[var(--color-border)]">
          {recipe.calories} kcal
        </span>
      </div>
      {recipe.instructions && (
        <div className="text-xs text-[var(--color-text-soft)] leading-relaxed bg-[var(--color-surface-soft)] p-3 rounded-xl border border-[var(--color-border)] space-y-1">
          <p className="font-bold text-[10px] text-[var(--color-text-muted)] uppercase">Instructions:</p>
          <p>{recipe.instructions}</p>
        </div>
      )}
      <button
        onClick={() => onDelete(recipe)}
        className="absolute top-3 right-3 text-[var(--color-icon-muted)] hover:text-rose-400 transition"
      >
        <Trash2 size={15} />
      </button>
    </Card>
  )
}
