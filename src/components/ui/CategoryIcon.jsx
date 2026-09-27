import { Utensils, Sparkles, SprayCan, Home, Bath, Tag } from 'lucide-react'

const ICONS = {
  Kitchen: Utensils,
  'Beauty Care': Sparkles,
  Cleaning: SprayCan,
  Home: Home,
  Bathroom: Bath,
}

export function CategoryIcon({ category, size = 16, className }) {
  const Icon = ICONS[category] || Tag
  return <Icon size={size} className={className} />
}
