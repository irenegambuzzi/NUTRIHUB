import {
  Apple,
  Baby,
  Bath,
  Car,
  Cookie,
  Croissant,
  CupSoda,
  Drumstick,
  Ham,
  House,
  IceCreamCone,
  Microwave,
  Milk,
  PawPrint,
  Pill,
  Snowflake,
  Soup,
  Sparkles,
  SprayCan,
  Tag,
  WashingMachine,
  Wheat,
} from 'lucide-react'

// Keyed by parent inventory category id.
const ICONS = {
  'pantry-staples': Wheat,
  meat: Drumstick,
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
  appliances: Microwave,
  automotive: Car,
  misc: Snowflake,
  produce: Apple,
  dairy: Milk,
  bakery: Croissant,
  deli: Ham,
  frozen: IceCreamCone,
}

export function CategoryIcon({ category, size = 16, className }) {
  const Icon = ICONS[category] || Tag
  return <Icon size={size} className={className} />
}
