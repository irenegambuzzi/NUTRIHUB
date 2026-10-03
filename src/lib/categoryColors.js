// Bring!-style category color chips, tuned for a dark background:
// vivid solid badges + soft translucent tints for chips. Classes are
// written out in full (not interpolated) so Tailwind's scanner picks
// them up at build time.
const PALETTE = {
  orange: { bg: 'bg-orange-500/15', text: 'text-orange-300', border: 'border-orange-500/30', solid: 'bg-orange-500' },
  pink: { bg: 'bg-pink-500/15', text: 'text-pink-300', border: 'border-pink-500/30', solid: 'bg-pink-500' },
  violet: { bg: 'bg-violet-500/15', text: 'text-violet-300', border: 'border-violet-500/30', solid: 'bg-violet-500' },
  teal: { bg: 'bg-teal-500/15', text: 'text-teal-300', border: 'border-teal-500/30', solid: 'bg-teal-500' },
  sky: { bg: 'bg-sky-500/15', text: 'text-sky-300', border: 'border-sky-500/30', solid: 'bg-sky-500' },
  amber: { bg: 'bg-amber-500/15', text: 'text-amber-300', border: 'border-amber-500/30', solid: 'bg-amber-500' },
  rose: { bg: 'bg-rose-500/15', text: 'text-rose-300', border: 'border-rose-500/30', solid: 'bg-rose-500' },
  emerald: { bg: 'bg-emerald-500/15', text: 'text-emerald-300', border: 'border-emerald-500/30', solid: 'bg-emerald-500' },
}

// Same rotation, as real hex values for chart libraries (recharts
// can't render Tailwind utility classes as fill colors).
const HEX = {
  orange: '#f97316',
  pink: '#ec4899',
  violet: '#8b5cf6',
  teal: '#14b8a6',
  sky: '#0ea5e9',
  amber: '#f59e0b',
  rose: '#f43f5e',
  emerald: '#10b981',
}

const ROTATION = ['orange', 'pink', 'violet', 'teal', 'sky', 'amber', 'rose', 'emerald']

export function colorForIndex(i) {
  return PALETTE[ROTATION[i % ROTATION.length]]
}

export function hexForIndex(i) {
  return HEX[ROTATION[i % ROTATION.length]]
}

export function colorByName(name) {
  return PALETTE[name] || PALETTE.teal
}

// Keyed by parent inventory category id.
export const INVENTORY_CATEGORY_COLORS = {
  'pantry-staples': 'orange',
  meat: 'rose',
  canned: 'amber',
  beverages: 'sky',
  snacks: 'pink',
  cleaning: 'violet',
  laundry: 'sky',
  toiletries: 'teal',
  'personal-care': 'pink',
  health: 'rose',
  baby: 'amber',
  pet: 'orange',
  household: 'teal',
  appliances: 'sky',
  automotive: 'violet',
  misc: 'emerald',
  produce: 'emerald',
  dairy: 'sky',
  bakery: 'amber',
  deli: 'pink',
  frozen: 'teal',
}

export function inventoryCategoryColor(categoryId) {
  return colorByName(INVENTORY_CATEGORY_COLORS[categoryId])
}
