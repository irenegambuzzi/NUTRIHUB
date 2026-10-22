// Small built-in list of names that mean nearly the same, used when a new
// category's name is already taken: the app then offers the synonym as a
// free name (it is always checked again, and never applied by itself).
// key (a name, as the app compares names) → synonyms, best first.
export const CATEGORY_SYNONYMS = {
  gifts: ['Souvenirs', 'Presents'],
  restaurant: ['Dining', 'Eating out'],
  electronics: ['Gadgets', 'Tech'],
  clothes: ['Apparel', 'Clothing'],
  snacks: ['Treats', 'Nibbles'],
  drinks: ['Beverages', 'Refreshments'],
  car: ['Vehicle', 'Auto'],
  travel: ['Journeys', 'Getaways'],
  books: ['Reading', 'Literature'],
  toys: ['Games', 'Play'],
  pets: ['Animals', 'Pet care'],
  health: ['Wellness', 'Medical'],
  beauty: ['Cosmetics', 'Grooming'],
  garden: ['Outdoor', 'Yard'],
  sport: ['Fitness', 'Exercise'],
  music: ['Audio', 'Sounds'],
  coffee: ['Caffeine', 'Espresso'],
  cleaning: ['Housekeeping', 'Tidying'],
  tools: ['Hardware', 'Equipment'],
  stationery: ['Office supplies', 'Paperwork'],
}
