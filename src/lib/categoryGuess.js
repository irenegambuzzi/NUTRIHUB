// Top-level alternatives, longest first, so "vacuum cleaner" is tried
// before "vacuum" (a regex stops at the first alternative that matches).
function longestFirst(pattern) {
  const parts = []
  let depth = 0
  let current = ''
  for (const ch of pattern) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === '|' && depth === 0) {
      parts.push(current)
      current = ''
    } else current += ch
  }
  parts.push(current)
  return parts.sort((a, b) => b.length - a.length).join('|')
}

// Guesses a parent category and sub-category from an item name, using
// keywords in English, Italian and Indonesian. Keep the keyword lists in
// sync with the rules in supabase/006_backfill_inventory_data.sql.
const RULES = [
  ['beverages', 'beverages:alcohol', 'beer|birra|bir|radler|wine|vino|prosecco|spritz|aperol|gin|vodka|rum|whisk(e)?y'],
  ['beverages', 'beverages:coffee-tea', 'coffee|caff[eè]|kopi|tea|t[eè]|teh|espresso'],
  ['beverages', 'beverages:milk', 'milk|latte|susu'],
  ['beverages', 'beverages:juice-soda', 'juice|succo|jus|soda|cola|coca|fanta|sprite|tonic'],
  ['beverages', 'beverages:water', 'water|acqua|air'],
  ['canned', 'canned:jams', 'peanut butter|jam|marmellata|confettura|selai|nutella|spread|crema spalmabile'],
  ['canned', 'canned:fish-meat', 'tuna|tonno|sarden|sardine|kornet|corned'],
  ['canned', 'canned:legumes', 'beans|fagioli|ceci|chickpeas|lenticchie|lentils'],
  ['canned', 'canned:vegetables', 'pelati|passata|acar|pickles?'],
  ['pantry-staples', 'pantry-staples:oils', 'oil|olio|minyak|vinegar|aceto|cuka'],
  ['pantry-staples', 'pantry-staples:sweeteners', 'honey|miele|madu|sugar|zucchero|gula|syrup|sciroppo'],
  ['pantry-staples', 'pantry-staples:sauces', 'sauce|salsa|ketchup|mayo(nnaise)?|mustard|senape|miso|kecap|sambal'],
  ['pantry-staples', 'pantry-staples:grains', 'rice|riso|beras|oats|avena|quinoa|couscous'],
  ['pantry-staples', 'pantry-staples:pasta', 'pasta|spaghetti|penne|noodles?|mie|ramen'],
  ['pantry-staples', 'pantry-staples:baking', 'flour|farina|tepung|yeast|lievito|baking'],
  [
    'pantry-staples',
    'pantry-staples:spices',
    'seasoning|spices?|pepper|pepe|peperoncino|paprika|salt|sale|garam|merica|bumbu|powder|leaves|nutmeg|coriander|turmeric|timo|thyme|parsley|prezzemolo|basil|basilico|oregano|origano|rosemary|rosmarino|cloves|chill?i?|curry|cumin|cumino|cinnamon|cannella|mix',
  ],
  // After spices, so "Beef Mix Seasoning" stays a spice.
  ['meat', 'meat:poultry', 'chicken|pollo|ayam|poultry|turkey|tacchino|duck|anatra|bebek|wings'],
  [
    'meat',
    'meat:seafood',
    'fish|pesce|ikan|seafood|salmon|salmone|cod|merluzzo|baccal[aà]|shrimps?|prawns?|gamber[ie]|gamberetti|udang|squid|calamari|cumi|mussels|cozze|kerang|clams|vongole|octopus|polpo|branzino|orata',
  ],
  [
    'meat',
    'meat:beef',
    'beef|manzo|sapi|daging|steak|bistecca|meat|carne|pork|maiale|babi|lamb|agnello|kambing|mince|minced|ground beef|sausages?|salsiccia|bacon|pancetta|ham|prosciutto|salame|burgers?|hamburger|vitello|veal',
  ],
  ['snacks', 'snacks:sweet', 'biscuits?|biscotti|biskuit|cookies?|chocolate|cioccolat[oa]|cokelat|candy|caramelle|permen'],
  ['snacks', 'snacks:savory', 'chips|patatine|crackers?|keripik|snack'],
  ['snacks', 'snacks:nuts', 'nuts|almonds?|mandorle|noci|arachidi|pistacchi'],
  ['laundry', 'laundry:softener', 'softener|ammorbidente|pelembut'],
  ['laundry', 'laundry:detergent', 'laundry|bucato|detersivo lavatrice|deterjen|pewangi cucian'],
  ['cleaning', 'cleaning:dish', 'dish|piatti|lavastoviglie|sabun cuci piring'],
  ['cleaning', 'cleaning:tools', 'sponge|spugn[ae]|spons|cloth|panno|pel'],
  ['cleaning', 'cleaning:surface', 'cleaner|pembersih|sgrassatore|bleach|candeggina|cairan'],
  ['toiletries', 'toiletries:oral', 'toothpaste|toothbrush|dentifricio|spazzolino|sikat gigi|pasta gigi|floss'],
  ['toiletries', 'toiletries:hair', 'shampoo|sampo|conditioner|balsamo'],
  ['toiletries', 'toiletries:soap', 'soap|sapone|bagnoschiuma|shower gel|sabun'],
  ['toiletries', 'toiletries:paper', 'toilet paper|carta igienica|tissues?|fazzoletti|tisu'],
  ['personal-care', 'personal-care:deodorant', 'deodorant|deodorante|deodoran'],
  ['personal-care', 'personal-care:makeup', 'lipstick|lipstik|rossetto|makeup|mascara|parfum|perfume|profumo'],
  ['personal-care', 'personal-care:skin', 'cream|crema|krim|serum|lotion|sunscreen'],
  ['health', 'health:vitamins', 'vitamins?|vitamine|integratore|supplements?'],
  ['health', 'health:first-aid', 'plaster|cerotti|plester|bandage|perban|garza'],
  ['health', 'health:medicine', 'medicine|obat|tachipirina|paracetamol|ibuprofen|aspirin[ae]?|moment|oki'],
  ['pet', 'pet:food', 'pet food|cat food|dog food|crocchette|makanan hewan'],
  ['pet', 'pet:litter', 'litter|lettiera|pasir kucing'],
  ['household', 'household:batteries', 'batter(y|ies)|batterie|baterai|bulbs?|lampadin[ae]|lampu'],
  ['household', 'household:bags', 'trash bags?|sacchi|kantong sampah'],
  ['household', 'household:paper', 'paper towels?|scottex|carta (forno|stagnola|alluminio)|foil|cling'],
  // Durable one-off purchases, last so consumables win (e.g. "carta forno").
  [
    'appliances',
    'appliances:kitchen',
    'oven|forno|microwave|microonde|kettle|bollitore|toaster|tostapane|blender|frullatore|mixer|planetaria|coffee machine|macchina (del )?caff[eè]|air fryer|friggitrice|fridge|refrigerator|frigorifero|kulkas|freezer|congelatore|dishwasher|rice cooker|slow cooker|induction|piano cottura',
  ],
  [
    'appliances',
    'appliances:kitchenware',
    'frying pan|saucepan|padella|pentola|wajan|panci|wok|knife|knives|coltell[io]|pisau|cutting board|tagliere|spatula|mestolo|ladle|colander|scolapasta|baking tray|teglia|food containers?|contenitor[ei]|tupperware|cutlery|posate|plates|glasses|bicchieri',
  ],
  ['appliances', 'appliances:cleaning', 'vacuum|aspirapolvere|vacuum cleaner|robot (vacuum|aspirapolvere)|steam mop|lavapavimenti|vaporetto'],
  [
    'appliances',
    'appliances:air',
    'air purifier|purificatore|depuratore|fan|ventilatore|kipas|heater|stufa|termoventilatore|dehumidifier|deumidificatore|humidifier|umidificatore|air conditioner|condizionatore|climatizzatore',
  ],
  [
    'appliances',
    'appliances:electronics',
    'laptop|notebook|computer|monitor|keyboard|tastiera|mouse|printer|stampante|headphones|cuffie|webcam|router|charger|caricatore|desk|scrivania|office chair|sedia (da )?ufficio|power bank|hard disk|ssd',
  ],
].map(([categoryId, subcategoryId, pattern]) => ({
  categoryId,
  subcategoryId,
  // Word boundaries (letter-aware, so accented words work) keep "tea"
  // from matching "steak".
  regex: new RegExp(`(^|[^\\p{L}])(${longestFirst(pattern)})(?=$|[^\\p{L}])`, 'iu'),
}))

// A multi-word phrase beats single keywords ("vacuum cleaner" is an
// appliance, not a cleaner; "air purifier" isn't water; "pasta gigi" is
// toothpaste). Otherwise the first matching rule wins.
export function guessCategory(name) {
  const trimmed = (name || '').trim()
  if (trimmed.length < 2) return null
  let first = null
  let phrase = null
  for (const rule of RULES) {
    const match = rule.regex.exec(trimmed)?.[2]
    if (!match) continue
    first ??= rule
    if (match.includes(' ') && (!phrase || match.length > phrase.length)) phrase = { rule, length: match.length }
  }
  const rule = phrase?.rule ?? first
  return rule ? { categoryId: rule.categoryId, subcategoryId: rule.subcategoryId } : null
}
