import { Wheat, Soup, CupSoda, Cookie, SprayCan, WashingMachine, Bath, Sparkles, Pill, Baby, PawPrint, House, Car, Snowflake, Tag } from 'lucide-react'

// Keyed by parent inventory category id.
const ICONS = {
  'pantry-staples': Wheat,
  canned: Soup,
  beverages: CupSoda,
  snacks: Cookie,
  cleaning: SprayCan,
  laundry: WashingMachine,
  toiletries: Bath,
  'personal-care': Sparkles,
  health: Pill,
  baby: Baby,
  pet: PawPrint,
  household: House,
  automotive: Car,
  misc: Snowflake,
}

export function CategoryIcon({ category, size = 16, className }) {
  const Icon = ICONS[category] || Tag
  return <Icon size={size} className={className} />
}
