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
// keywords in English, Italian and Indonesian. A null sub-category means
// only the parent is known.
//
// Each rule is [categoryId, subcategoryId, keywords, options]:
//   weak  – short or ambiguous words ("air", "te", "sale") that only count
//           when they are the whole name, e.g. "Air 1.5 L" but not
//           "air freshener".
//   kind  – words that name what the product is ("seasoning", "bumbu"),
//           so "Beef Mix Seasoning" is a spice, not beef.
// The order only breaks ties within the same parent category.
//
// supabase/006_backfill_inventory_data.sql used an older version of
// these keywords for its one-time backfill.
const RULES = [
  ['beverages', 'beverages:alcohol', 'beer|birra|bir|radler|wine|vino|prosecco|spritz|aperol|gin|vodka|rum|whisk(e)?y'],
  [
    'beverages',
    'beverages:coffee-tea',
    'coffee|caff[eè]|kopi|tea|tè|teh|espresso|cappuccino|cialde|green tea|black tea|herbal tea|t[eè] (verde|nero|freddo|al limone|alla pesca)|tisana|infuso|camomilla',
    { weak: 'te' },
  ],
  ['beverages', 'beverages:milk', 'milk|latte|susu'],
  ['beverages', 'beverages:juice-soda', 'juice|succo|jus|soda|cola|coca|fanta|sprite|tonic|acqua tonica|tonic water'],
  [
    'beverages',
    'beverages:water',
    'water|acqua|mineral water|sparkling water|acqua (naturale|frizzante|minerale|gassata)|air mineral|air putih',
    { weak: 'air' },
  ],
  ['canned', 'canned:jams', 'peanut butter|jam|marmellata|confettura|selai|nutella|spread|crema spalmabile'],
  ['canned', 'canned:fish-meat', 'tuna|tonno|sarden|sardine|kornet|corned'],
  ['canned', 'canned:legumes', 'beans|fagioli|ceci|chickpeas|lenticchie|lentils'],
  ['canned', 'canned:vegetables', "pelati|passata|acar|pickles?|sott'olio|all'olio|sottaceti"],
  ['pantry-staples', 'pantry-staples:oils', 'oil|olio|minyak|vinegar|aceto|cuka|olive oil|olio (extra vergine|evo|di oliva|di semi)'],
  ['pantry-staples', 'pantry-staples:sweeteners', 'honey|miele|madu|sugar|zucchero|gula|syrup|sciroppo'],
  ['pantry-staples', 'pantry-staples:sauces', 'sauce|salsa|ketchup|mayo(nnaise)?|mustard|senape|miso|kecap|sambal|pesto|soy sauce|salsa di soia'],
  ['pantry-staples', 'pantry-staples:grains', 'rice|riso|beras|oats|avena|quinoa|couscous'],
  ['pantry-staples', 'pantry-staples:pasta', 'pasta|spaghetti|penne|noodles?|mie|ramen'],
  ['pantry-staples', 'pantry-staples:baking', 'flour|farina|tepung|yeast|lievito|baking|baking soda|bicarbonato'],
  [
    'pantry-staples',
    'pantry-staples:spices',
    'seasoning|spices?|spice mix|pepper|pepe|peperoncino|paprika|salt|garam|merica|bumbu|nutmeg|coriander|turmeric|timo|thyme|parsley|prezzemolo|basil|basilico|oregano|origano|rosemary|rosmarino|cloves|chill?i?|curry|cumin|cumino|cinnamon|cannella|sea salt|sale (fino|grosso|marino)',
    { weak: 'sale|powder|mix', kind: 'seasoning|spice mix|bumbu' },
  ],
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
  ['laundry', 'laundry:softener', 'softener|fabric softener|ammorbidente|pelembut|pelembut pakaian'],
  [
    'laundry',
    'laundry:detergent',
    'laundry|bucato|detersivo (per )?(lavatrice|bucato)|deterjen|pewangi cucian|washing powder|washing liquid|laundry detergent',
  ],
  ['cleaning', 'cleaning:dish', 'dish|piatti|lavastoviglie|sabun cuci piring|detersivo (per )?piatti|dish soap|washing up liquid'],
  ['cleaning', 'cleaning:tools', 'sponge|spugn[ae]|spons|cloth|panno|kain pel', { weak: 'pel' }],
  [
    'cleaning',
    'cleaning:surface',
    'cleaner|pembersih|sgrassatore|bleach|candeggina|anticalcare|multiuso|glass cleaner|detersivo (per )?vetri|cairan pembersih',
    { weak: 'cairan' },
  ],
  ['toiletries', 'toiletries:oral', 'toothpaste|toothbrush|dentifricio|spazzolino|sikat gigi|pasta gigi|floss|mouthwash|collutorio'],
  ['toiletries', 'toiletries:hair', 'shampoo|sampo|conditioner|balsamo'],
  ['toiletries', 'toiletries:soap', 'soap|sapone|bagnoschiuma|shower gel|sabun|sabun mandi'],
  ['toiletries', 'toiletries:paper', 'toilet paper|carta igienica|tissues?|fazzoletti|tisu'],
  ['personal-care', 'personal-care:deodorant', 'deodorant|deodorante|deodoran'],
  ['personal-care', 'personal-care:makeup', 'lipstick|lipstik|rossetto|makeup|mascara|parfum|perfume|profumo'],
  [
    'personal-care',
    'personal-care:skin',
    'cream|crema|krim|serum|lotion|sunscreen|body lotion|moisturi[sz]er|crema (viso|corpo|mani)|tea tree|tea tree oil|olio (di )?tea tree|latte detergente|cleansing milk|baby oil|olio per bambini|olio (per il )?corpo|body oil|micellar water|acqua micellare|tonico|face wash|sabun muka',
  ],
  ['health', 'health:vitamins', 'vitamins?|vitamine|integratore|supplements?'],
  ['health', 'health:first-aid', 'plaster|cerotti|plester|bandage|perban|garza|acqua ossigenata|disinfettante'],
  ['health', 'health:medicine', 'medicine|obat|tachipirina|paracetamol|ibuprofen|aspirin[ae]?', { weak: 'moment|oki' }],
  ['pet', 'pet:food', 'pet food|cat food|dog food|crocchette|makanan hewan|makanan kucing'],
  ['pet', 'pet:litter', 'litter|lettiera|pasir kucing'],
  [
    'household',
    null,
    'air fresheners?|room spray|deodorante per (gli )?ambient[ei]|profum(o|atore) per (gli )?ambient[ei]|deodoran ruangan|pengharum ruangan|pewangi ruangan|candles?|candele|lilin',
  ],
  ['household', 'household:batteries', 'batter(y|ies)|batterie|baterai|bulbs?|lampadin[ae]|lampu'],
  ['household', 'household:bags', 'trash bags?|sacchi|sacchetti (per la )?spazzatura|kantong sampah'],
  ['household', 'household:paper', 'paper towels?|scottex|carta (forno|stagnola|alluminio)|foil|cling film|pellicola'],
  // Car supplies (the old Automotive category now lives in Miscellaneous).
  [
    'misc',
    null,
    'olio (per )?motore|engine oil|motor oil|oli mesin|oli motor|antifreeze|antigelo|liquido (tergicristalli|radiatore)|wiper fluid',
  ],
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
].map(([categoryId, subcategoryId, pattern, { weak, kind } = {}], order) => ({
  categoryId,
  subcategoryId,
  order,
  // Whole words only (letter- and digit-aware, so accented words work and
  // "tea" doesn't match "steak" or "test").
  regex: new RegExp(`(?<![\\p{L}\\p{N}])(?:${longestFirst(pattern)})(?![\\p{L}\\p{N}])`, 'giu'),
  weak: weak ? new RegExp(`^(?:${weak})$`, 'iu') : null,
  kind: kind ? new RegExp(`^(?:${kind})$`, 'iu') : null,
}))

// The name without amounts and units ("Air 1,5 L" → "air").
function bareName(name) {
  return name
    .replace(/\d+(?:[.,]\d+)?\s*(?:kg|gr|g|ml|cl|lt|l|pcs|pz|x)?(?![\p{L}])/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function findMatches(name) {
  const bare = bareName(name)
  const matches = []
  for (const rule of RULES) {
    for (const m of name.matchAll(rule.regex)) {
      const text = m[0].toLowerCase()
      const words = text.split(/\s+/).length
      matches.push({ rule, start: m.index, end: m.index + m[0].length, score: words + (rule.kind?.test(text) ? 0.5 : 0) })
    }
    if (rule.weak?.test(bare)) matches.push({ rule, start: 0, end: name.length, score: 0.5 })
  }
  // A keyword inside a longer match ("tea" in "tea tree oil", "olio" in
  // "olio per bambini") doesn't count on its own.
  return matches.filter(
    (m) => !matches.some((o) => o !== m && o.start <= m.start && o.end >= m.end && o.end - o.start > m.end - m.start)
  )
}

// The most specific match wins: more words beat fewer, so phrases beat
// single words. If the best matches point to different parent
// categories, it's ambiguous and nothing is guessed.
export function guessCategory(name) {
  const trimmed = (name || '').trim()
  if (trimmed.length < 2) return null
  const matches = findMatches(trimmed)
  if (matches.length === 0) return null
  const best = Math.max(...matches.map((m) => m.score))
  const top = matches.filter((m) => m.score === best).map((m) => m.rule)
  if (new Set(top.map((r) => r.categoryId)).size > 1) return null
  const rule = top.reduce((a, b) => (b.order < a.order ? b : a))
  return { categoryId: rule.categoryId, subcategoryId: rule.subcategoryId }
}
