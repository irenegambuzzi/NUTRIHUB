// Test data only (not used by the app): the HOME categories as they are
// live, from the Supabase export of 21/10/2026 (tmp-export/1_home.csv, not
// in git), and what supabase/024, 025 (plus the Beauty Care sub made in
// the app, renamed Hair Care by 025) and 026 do to them.
const row = ([id, name, parent_id]) => ({ id, name, parent_id })

// [id, name, parent_id] on 21/10/2026.
export const LIVE_HOME_CATEGORIES = [
  ['appliances', 'Home & Appliances', null],
  ['bakery', 'Bakery & Bread', null],
  ['beverages', 'Beverages', null],
  ['canned', 'Canned & Preserved Goods', null],
  ['cleaning', 'Cleaning Supplies', null],
  ['dairy', 'Dairy & Eggs', null],
  ['deli', 'Deli & Cold Cuts', null],
  ['frozen', 'Frozen Food', null],
  ['health', 'Health & Medicine', null],
  ['household', 'Household Supplies', null],
  ['laundry', 'Laundry Supplies', null],
  ['meat', 'Meat & Seafood', null],
  ['misc', 'Miscellaneous / Seasonal', null],
  ['pantry-staples', 'Pantry Staples', null],
  ['personal-care', 'Beauty Care', null],
  ['pet', 'Pet Supplies', null],
  ['produce', 'Fruit & Vegetables', null],
  ['snacks', 'Snacks', null],
  ['toiletries', 'Toiletries', null],
  ['appliances:air', 'Air & Climate', 'appliances'],
  ['appliances:cleaning', 'Cleaning Appliances', 'appliances'],
  ['appliances:electronics', 'Electronics & Work Equipment', 'appliances'],
  ['appliances:kitchen', 'Kitchen Appliances', 'appliances'],
  ['appliances:kitchenware', 'Kitchenware & Utensils', 'appliances'],
  ['bakery:bread', 'Bread', 'bakery'],
  ['bakery:crispbread', 'Rusks & Breadsticks', 'bakery'],
  ['bakery:pastries', 'Pastries & Cakes', 'bakery'],
  ['beverages:alcohol', 'Beer & Wine', 'beverages'],
  ['beverages:coffee-tea', 'Coffee & Tea', 'beverages'],
  ['beverages:juice-soda', 'Juice & Soft Drinks', 'beverages'],
  ['beverages:milk', 'Milk & Plant Milk', 'beverages'],
  ['beverages:water', 'Water', 'beverages'],
  ['canned:fish-meat', 'Canned Fish & Meat', 'canned'],
  ['canned:jams', 'Jams & Spreads', 'canned'],
  ['canned:legumes', 'Beans & Legumes', 'canned'],
  ['canned:vegetables', 'Canned Vegetables', 'canned'],
  ['cleaning:dish', 'Dishwashing', 'cleaning'],
  ['cleaning:surface', 'Surface Cleaners', 'cleaning'],
  ['cleaning:tools', 'Sponges & Cloths', 'cleaning'],
  ['dairy:butter', 'Butter & Margarine', 'dairy'],
  ['dairy:cheese', 'Cheese', 'dairy'],
  ['dairy:eggs', 'Eggs', 'dairy'],
  ['dairy:milk', 'Milk & Cream', 'dairy'],
  ['dairy:yogurt', 'Yogurt & Desserts', 'dairy'],
  ['deli:cold-cuts', 'Cold Cuts', 'deli'],
  ['deli:fresh-pasta', 'Fresh Pasta', 'deli'],
  ['deli:ready', 'Ready Meals & Dips', 'deli'],
  ['frozen:fish', 'Frozen Fish', 'frozen'],
  ['frozen:ice-cream', 'Ice Cream', 'frozen'],
  ['frozen:meals', 'Frozen Meals & Pizza', 'frozen'],
  ['frozen:vegetables', 'Frozen Fruit & Vegetables', 'frozen'],
  ['health:first-aid', 'First Aid', 'health'],
  ['health:medicine', 'Medicine', 'health'],
  ['health:vitamins', 'Vitamins & Supplements', 'health'],
  ['household:bags', 'Trash Bags', 'household'],
  ['household:batteries', 'Batteries & Bulbs', 'household'],
  ['household:paper', 'Paper Towels & Foil', 'household'],
  ['01386438-f2d4-418b-bcd6-082874075213', 'Color Care', 'laundry'],
  ['e8e447c7-3b68-4eee-81e8-86915839565f', 'Perfume', 'laundry'],
  ['laundry:detergent', 'Detergent', 'laundry'],
  ['laundry:softener', 'Fabric Softener', 'laundry'],
  ['laundry:stain', 'Stain Removers', 'laundry'],
  ['meat:beef', 'Beef & Meat', 'meat'],
  ['meat:poultry', 'Chicken & Poultry', 'meat'],
  ['meat:seafood', 'Fish & Seafood', 'meat'],
  ['misc:gifts', 'Gifts & Party', 'misc'],
  ['misc:seasonal', 'Seasonal', 'misc'],
  ['pantry-staples:baking', 'Flour & Baking', 'pantry-staples'],
  ['pantry-staples:cereal', 'Cereal & Breakfast', 'pantry-staples'],
  ['pantry-staples:grains', 'Rice & Grains', 'pantry-staples'],
  ['pantry-staples:oils', 'Oils & Vinegar', 'pantry-staples'],
  ['pantry-staples:pasta', 'Pasta & Noodles', 'pantry-staples'],
  ['pantry-staples:sauces', 'Sauces & Condiments', 'pantry-staples'],
  ['pantry-staples:spices', 'Spices & Seasonings', 'pantry-staples'],
  ['pantry-staples:sweeteners', 'Sugar & Sweeteners', 'pantry-staples'],
  ['dd8d720d-b911-4f55-af65-661ac7685eeb', 'Cotton Pads & Buds', 'personal-care'],
  ['personal-care:deodorant', 'Deodorant', 'personal-care'],
  ['personal-care:makeup', 'Makeup', 'personal-care'],
  ['personal-care:skin', 'Skincare', 'personal-care'],
  ['3d924169-d334-44ee-947a-3e3a498706fc', 'Pet Treats & Care', 'pet'],
  ['pet:food', 'Pet Food', 'pet'],
  ['pet:litter', 'Litter & Hygiene', 'pet'],
  ['produce:fruit', 'Fresh Fruit', 'produce'],
  ['produce:herbs', 'Fresh Herbs', 'produce'],
  ['produce:potatoes', 'Potatoes, Onions & Garlic', 'produce'],
  ['produce:salad', 'Salad & Leafy Greens', 'produce'],
  ['produce:vegetables', 'Fresh Vegetables', 'produce'],
  ['snacks:nuts', 'Nuts & Dried Fruit', 'snacks'],
  ['snacks:savory', 'Savory Snacks', 'snacks'],
  ['snacks:sweet', 'Sweet Snacks', 'snacks'],
  ['toiletries:hair', 'Shampoo & Conditioner', 'toiletries'],
  ['toiletries:oral', 'Oral Care', 'toiletries'],
  ['toiletries:paper', 'Toilet Paper & Tissues', 'toiletries'],
  ['toiletries:soap', 'Soap & Shower Gel', 'toiletries'],
].map(row)

// What 024 adds.
export const HOME_CATEGORIES_024 = [
  ['baby', 'Baby', null],
  ['baby:diapers', 'Diapers', 'baby'],
  ['baby:wipes', 'Baby Wipes', 'baby'],
  ['baby:food', 'Baby Food', 'baby'],
  ['baby:formula', 'Formula', 'baby'],
  ['baby:care', 'Baby Care', 'baby'],
  ['baby:feeding', 'Feeding', 'baby'],
  ['personal-care:perfume', 'Perfume', 'personal-care'],
  ['frozen:meat', 'Frozen Meat', 'frozen'],
  ['toiletries:feminine', 'Feminine Care', 'toiletries'],
  ['pantry-staples:world', 'World Foods', 'pantry-staples'],
  ['household:stationery', 'Stationery', 'household'],
  ['household:car-care', 'Car Care', 'household'],
  ['household:air', 'Air Fresheners', 'household'],
  ['household:pest', 'Pest Control', 'household'],
  ['household:garden', 'Plants & Garden', 'household'],
].map(row)

// What 025 adds (and the Hair Care sub, made in the app on 24/10).
export const HOME_CATEGORIES_025 = [
  ['appliances:textiles', 'Home Textiles', 'appliances'],
  ['appliances:decor', 'Home Decor', 'appliances'],
  ['3ff635c0-7fd1-46ff-ac49-8e408c032398', 'Hair Care', 'personal-care'],
].map(row)

// What 026 adds.
export const HOME_CATEGORIES_026 = [
  ['appliances:clothing', 'Clothing', 'appliances'],
  ['appliances:footwear', 'Footwear', 'appliances'],
  ['appliances:accessories', 'Accessories', 'appliances'],
  ['appliances:pet', 'Pet Accessories & Toys', 'appliances'],
  ['appliances:glasses', 'Glasses', 'appliances'],
  ['appliances:furniture', 'Furniture', 'appliances'],
  ['health:contact-lenses', 'Contact Lenses', 'health'],
  ['laundry:machine-care', 'Washing Machine Care', 'laundry'],
].map(row)

// The HOME categories before 026 (after 024 and 025) and after it (two
// renames, Gifts & Party under Durables).
export const HOME_BEFORE_026 = [...LIVE_HOME_CATEGORIES, ...HOME_CATEGORIES_024, ...HOME_CATEGORIES_025]
export const HOME_AFTER_026 = [...HOME_BEFORE_026, ...HOME_CATEGORIES_026].map((c) => {
  if (c.id === 'appliances') return { ...c, name: 'Durables' }
  if (c.id === 'appliances:electronics') return { ...c, name: 'Electronics' }
  if (c.id === 'misc:gifts') return { ...c, parent_id: 'appliances' }
  return c
})

// { parents, subsByParent } as useInventoryCategories gives them (every
// main, the Durables tree too), for the keyword and chip functions.
export function homeTree(categories) {
  const parents = categories.filter((c) => !c.parent_id)
  return { parents, subsByParent: new Map(parents.map((p) => [p.id, categories.filter((c) => c.parent_id === p.id)])) }
}
