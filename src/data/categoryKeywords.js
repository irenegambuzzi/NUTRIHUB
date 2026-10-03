// Keywords for guessing an item's category from its name, in English,
// Italian and Indonesian, plus common brands in Italian (and some
// Indonesian) supermarkets. See lib/categoryGuess.js for how they're
// matched:
//   - written lower case, without accents; "ice cream" also matches
//     "icecream" and "ice-cream"; English plurals match the singular
//   - a trailing * matches any ending: "pomodor*" = pomodoro, pomodori…
//   - more words beat fewer ("ice cream" beats "cream")
//   - weak: short or ambiguous words that only count as the whole name
//   - kind: words that say what the product is, so they beat the flavour
//     or ingredient ("strawberry yogurt" is a yogurt, not fruit)
// Each rule: [categoryId, subcategoryId (or null), keywords, options].

export const CATEGORY_RULES = [
  // ── Fruit & Vegetables ──────────────────────────────────────────
  [
    'produce',
    'produce:fruit',
    'fruit|frutta|buah|apple|mela|mele|apel|banana|banane|pisang|orange|arancia|arance|jeruk|lemon|limone|limoni|jeruk nipis|lime|pear|pera|pere|pir|grape|uva|anggur|strawberry|fragola|fragole|stroberi|kiwi|mango|mangga|pineapple|ananas|nanas|peach|pesca|pesche|persik|nectarine|nettarina|nettarine|plum|prugna|prugne|susina|susine|melon|melone|meloni|semangka|watermelon|anguria|angurie|cherry|ciliegia|ciliegie|ceri|avocado|alpukat|papaya|pepaya|mandarin|mandarino|mandarini|clementina|clementine|tangerine|blueberry|mirtilli|mirtillo|raspberry|lamponi|lampone|blackberry|more di rovo|fig|fichi|fico|apricot|albicocca|albicocche|pomegranate|melagrana|delima|dragon fruit|buah naga|durian|rambutan|salak|jambu|manggis|mangosteen|lychee|litchi|leci|grapefruit|pompelmo|passion fruit|frutto della passione|markisa|coconut|cocco|kelapa|kaki|cachi|persimmon|kesemek|golden delicious|granny smith|pink lady|fuji apple|melinda',
    { kind: 'fruit|frutta|buah' },
  ],
  [
    'produce',
    'produce:vegetables',
    'vegetable|verdura|verdure|sayur|sayuran|eggplant|aubergine|melanzana|melanzane|terong|tomato|pomodor*|tomat|zucchina|zucchine|zucchini|courgette|carrot|carota|carote|wortel|bell pepper|peperone|peperoni|paprika merah|cucumber|cetriolo|cetrioli|timun|mentimun|broccoli|brokoli|cauliflower|cavolfiore|cavolfiori|cabbage|cavolo|cavoli|cavolo nero|cavolo cappuccio|verza|kubis|kol|spinach|spinaci|bayam|kangkung|green bean|fagiolini|buncis|mushroom|funghi|fungo|champignon|champignons|porcini|jamur|asparagus|asparagi|artichoke|carciofo|carciofi|celery|sedano|seledri|leek|porro|porri|pumpkin|zucca|labu|butternut|radish|ravanello|ravanelli|lobak|fennel|finocchio|finocchi|beetroot|barbabietola|barbabietole|bit merah|kale|cime di rapa|friarielli|bok choy|pak choi|pakcoy|sawi|caisim|tauge|bean sprout|okra|labu siam|chayote|corn on the cob|pannocchia|jagung manis|chili pepper|cabai|cabe|cabe rawit|rawit|spring onion|cipollotto|daun bawang|edamame|snow pea|taccole|sweet corn',
    { kind: 'vegetable|verdura|verdure|sayur|sayuran' },
  ],
  [
    'produce',
    'produce:potatoes',
    'potato|patata|patate|kentang|sweet potato|patata dolce|patate dolci|ubi|ubi jalar|singkong|cassava|onion|cipolla|cipolle|bawang merah|bawang bombay|bawang putih|garlic|aglio|shallot|scalogno|scalogni|ginger|zenzero|jahe|lengkuas|galangal|kunyit segar|turmeric root',
  ],
  ['produce', 'produce:salad', 'salad|insalata|insalate|lettuce|lattuga|rucola|rocket|arugula|selada|valeriana|songino|iceberg|radicchio|indivia|scarola|misticanza|lattughino|baby spinach|spinacino'],
  [
    'produce',
    'produce:herbs',
    'fresh herb|erbe aromatiche|fresh basil|basilico fresco|fresh parsley|prezzemolo fresco|fresh coriander|coriandolo fresco|daun ketumbar|fresh mint|menta|mint|daun mint|fresh rosemary|fresh thyme|fresh dill|aneto|erba cipollina|chives|kemangi|daun kemangi|daun jeruk|serai|sereh|lemongrass|daun salam|daun pandan|pandan',
  ],

  // ── Meat & Seafood ──────────────────────────────────────────────
  [
    'meat',
    'meat:poultry',
    'chicken|pollo|ayam|poultry|turkey|tacchino|duck|anatra|bebek|chicken breast|petto di pollo|dada ayam|paha ayam|chicken thigh|cosce di pollo|chicken wing|ali di pollo|sayap ayam|fesa di tacchino|amadori|aia|whole chicken|pollo intero|ayam utuh|ceker',
  ],
  [
    'meat',
    'meat:beef',
    'beef|manzo|sapi|daging|daging sapi|steak|bistecca|fiorentina|tagliata|meat|carne|pork|maiale|babi|lamb|agnello|kambing|mutton|veal|vitello|vitellone|mince|minced meat|carne macinata|macinato|daging giling|ground beef|sausage|salsiccia|salsicce|burger|hamburger|ribs|costine|costolette|braciola|braciole|filetto|fillet|scaloppine|spezzatino|arrosto|roast beef|roastbeef|rendang|iga|bacon|pancetta|guanciale|lardo|cotechino|zampone|polpette|meatballs|bakso|chorizo',
    { kind: 'burger|hamburger' },
  ],
  [
    'meat',
    'meat:seafood',
    'fish|pesce|ikan|seafood|frutti di mare|salmon|salmone|tuna steak|trancio di tonno|cod|merluzzo|baccala|stoccafisso|shrimp|prawn|gamberi|gambero|gamberetti|mazzancolle|udang|squid|calamari|calamaro|totani|cumi|cumi cumi|mussel|cozze|kerang|clam|vongole|octopus|polpo|polipo|gurita|sea bass|branzino|spigola|sea bream|orata|trout|trota|swordfish|pesce spada|sole|sogliola|anchovy|alici|acciughe|ikan teri|teri|sardine fresche|mackerel|sgombro|ikan kembung|tilapia|nila|ikan nila|lele|catfish|bandeng|milkfish|kakap|snapper|crab|granchio|kepiting|lobster|aragosta|astice|lobster|scampi|sushi grade|salmone affumicato|smoked salmon',
  ],

  // ── Dairy & Eggs ────────────────────────────────────────────────
  [
    'dairy',
    'dairy:milk',
    'milk|latte|susu|fresh milk|whole milk|latte intero|latte parzialmente scremato|latte scremato|semi skimmed milk|skimmed milk|susu segar|susu uht|latte uht|lactose free milk|latte senza lattosio|cooking cream|panna|panna da cucina|panna fresca|panna montata|panna da montare|whipping cream|heavy cream|double cream|single cream|sour cream|creme fraiche|evaporated milk|condensed milk|latte condensato|susu kental manis|parmalat|granarolo|zymil|accadi|ultra milk|indomilk|frisian flag|greenfields|diamond milk',
    { kind: 'milk|latte|susu', weak: 'cream' },
  ],
  [
    'dairy',
    'dairy:yogurt',
    'yogurt|yoghurt|yogurt greco|greek yogurt|skyr|kefir|budino|budini|pudding|panna cotta|creme caramel|mousse|activia|yomo|danone|muller|danette|vipiteno|fage|actimel|yakult|cimory|biokul|heavenly blush',
    { kind: 'yogurt|yoghurt|skyr|kefir|pudding|budino' },
  ],
  [
    'dairy',
    'dairy:cheese',
    'cheese|formaggio|formaggi|keju|mozzarella|fior di latte|bufala|parmigiano|parmigiano reggiano|parmesan|grana|grana padano|pecorino|pecorino romano|ricotta|mascarpone|gorgonzola|stracchino|crescenza|squacquerone|scamorza|provola|provolone|caciocavallo|feta|cheddar|burrata|stracciatella|philadelphia|cream cheese|formaggio spalmabile|emmental|emmentaler|asiago|fontina|taleggio|brie|camembert|halloumi|gouda|edam|montasio|caprino|robiola|sottilette|galbani|vallelata|santa lucia|kraft cheese|prochiz|keju cheddar|keju parut|grated cheese|formaggio grattugiato',
  ],
  ['dairy', 'dairy:butter', 'butter|burro|mentega|margarine|margarina|blue band|anchor butter|lurpak|ghee|burro chiarificato'],
  ['dairy', 'dairy:eggs', 'egg|eggs|uovo|uova|telur|telur ayam|free range eggs|uova fresche|uova bio|egg white|albume'],

  // ── Deli & Cold Cuts ────────────────────────────────────────────
  [
    'deli',
    'deli:cold-cuts',
    'prosciutto|prosciutto cotto|prosciutto crudo|ham|cooked ham|parma ham|salame|salami|pepperoni|mortadella|bresaola|speck|coppa|capocollo|culatello|wurstel|hot dog|frankfurter|cold cuts|affettati|affettato|turkey slices|petto di tacchino|fesa di tacchino a fette|porchetta|nduja|beretta|rovagnati|fiorucci|citterio|negroni|parmacotto|sosis|kanzler|bernardi|smoked beef|beef slice|salami sapi',
  ],
  [
    'deli',
    'deli:fresh-pasta',
    'fresh pasta|pasta fresca|tortellini|tortelloni|ravioli|cappelletti|agnolotti|gnocchi|lasagne fresche|tagliatelle fresche|pasta all uovo fresca|rana|giovanni rana',
    { kind: 'tortellini|tortelloni|ravioli|cappelletti|agnolotti|gnocchi' },
  ],
  [
    'deli',
    'deli:ready',
    'ready meal|piatto pronto|piatti pronti|hummus|tzatziki|guacamole|sushi|insalata di riso|insalata russa|soup|zuppa|minestra|minestrone|vellutata|sup|lasagna pronta|pesto fresco|olive condite|gastronomia',
    { kind: 'soup|zuppa|minestra|minestrone|vellutata|sup' },
  ],

  // ── Bakery & Bread ──────────────────────────────────────────────
  [
    'bakery',
    'bakery:bread',
    'bread|pane|pane integrale|pane in cassetta|pancarre|pan carre|sandwich bread|toast bread|roti|roti tawar|baguette|ciabatta|focaccia|piadina|piadine|tortilla|wrap|pita|bun|bagel|panini|rosetta|michetta|pane carasau|pizza dough|impasto pizza|pasta per pizza|sari roti|mulino bianco pane|harrys|bauli pane',
  ],
  [
    'bakery',
    'bakery:pastries',
    'croissant|cornetto|cornetti|brioche|cake|torta|torte|kue|bolu|muffin|donut|doughnut|ciambella|ciambelle|panettone|pandoro|colomba|crostata|merendina|merendine|plumcake|pie|apple pie|strudel|cannoli|sfogliatella|pastries|pasticcini|bomboloni|waffle|pancake|crepe|tiramisu|cheesecake|bauli|motta panettone|kinder delice|flauti|tegolino|buondi',
    { kind: 'cake|torta|kue|pie|muffin|croissant|cornetto|brioche' },
  ],
  ['bakery', 'bakery:crispbread', 'grissini|fette biscottate|rusk|crispbread|friselle|frisella|taralli|crostini|crackers di riso|gallette|rice cake|pan bauletto tostato|wasa|knackebrod'],

  // ── Frozen Food ─────────────────────────────────────────────────
  [
    'frozen',
    'frozen:ice-cream',
    'ice cream|gelato|gelati|es krim|eskrim|sorbet|sorbetto|ghiacciolo|ghiaccioli|ice lolly|ice pop|popsicle|frozen yogurt|semifreddo|magnum|algida|sammontana|carte d or|haagen dazs|ben jerry|walls|campina|aice|cornetto algida|solero|calippo|viennetta|mochi ice|algida cornetto|cornetto gelato',
    { kind: 'ice cream|gelato|es krim|sorbet|sorbetto|ghiacciolo' },
  ],
  [
    'frozen',
    'frozen:vegetables',
    'frozen vegetable|frozen veg|frozen pea|frozen spinach|frozen broccoli|frozen bean|frozen corn|frozen berry|frozen fruit|verdure surgelate|piselli surgelati|spinaci surgelati|minestrone surgelato|frutti di bosco surgelati|sayur beku|orogel',
  ],
  [
    'frozen',
    'frozen:meals',
    'frozen|surgelato|surgelati|surgelata|surgelate|beku|frozen food|frozen meal|frozen pizza|pizza surgelata|pizza|pizze|nugget|chicken nugget|naget|sofficini|french fries|patatine fritte|frozen fries|patatine surgelate|kentang goreng beku|frozen dumplings|ravioli cinesi|gyoza|dimsum|spring rolls|involtini primavera|lasagne surgelate|findus|buitoni|cameo pizza|so good|fiesta nugget|champ nugget|bernardi nugget',
    { kind: 'pizza|nugget|naget' },
  ],
  ['frozen', 'frozen:fish', 'frozen fish|frozen shrimp|frozen prawn|frozen seafood|pesce surgelato|gamberi surgelati|fish finger|fish stick|bastoncini|bastoncini di pesce|capitan findus|fish fillet frozen'],

  // ── Pantry Staples ──────────────────────────────────────────────
  [
    'pantry-staples',
    'pantry-staples:grains',
    'rice|riso|beras|nasi|basmati|jasmine rice|arborio|carnaroli|riso integrale|brown rice|oats|oat|avena|fiocchi di avena|quinoa|couscous|bulgur|farro|orzo perlato|barley|polenta|semolina|semola|millet|miglio|buckwheat|grano saraceno|scotti|gallo riso|beras merah|ketan',
  ],
  [
    'pantry-staples',
    'pantry-staples:pasta',
    'pasta|spaghetti|spaghettini|penne|fusilli|rigatoni|farfalle|tagliatelle|linguine|bucatini|maccheroni|orecchiette|paccheri|conchiglie|ditalini|lasagne|lasagna|vermicelli|capellini|mezze maniche|tortiglioni|pastina|noodle|mie|mi instan|instant noodle|ramen|udon|soba|bihun|kwetiau|rice noodle|indomie|mie sedaap|sarimi|barilla|de cecco|rummo|garofalo|divella|la molisana|voiello|buitoni pasta|pasta integrale',
    { kind: 'pasta|noodle|mie' },
  ],
  [
    'pantry-staples',
    'pantry-staples:baking',
    'flour|farina|tepung|tepung terigu|tepung beras|tepung maizena|cornstarch|amido di mais|maizena|yeast|lievito|lievito di birra|ragi|fermipan|baking powder|baking soda|bicarbonato|vanillin|vanilla|vaniglia|cocoa powder|cacao in polvere|chocolate chips|gocce di cioccolato|breadcrumbs|pangrattato|tepung roti|panir|gelatin|colla di pesce|agar agar|cake mix|preparato per torte|icing sugar|zucchero a velo|pizza flour|farina 00|manitoba|segafredo flour|molino',
  ],
  [
    'pantry-staples',
    'pantry-staples:oils',
    'oil|olio|minyak|olive oil|olio d oliva|olio extra vergine|olio evo|extra virgin|sunflower oil|olio di semi|olio di girasole|minyak goreng|minyak kelapa|coconut oil|sesame oil|olio di sesamo|minyak wijen|vinegar|aceto|aceto balsamico|balsamic|cuka|apple cider vinegar|bimoli|filma|sania|tropical oil|carapelli|bertolli|monini|de cecco olio|olitalia',
  ],
  [
    'pantry-staples',
    'pantry-staples:spices',
    'seasoning|spice|spezie|bumbu|bumbu dapur|spice mix|salt|sea salt|sale fino|sale grosso|sale marino|sale iodato|garam|pepper|black pepper|pepe|pepe nero|merica|lada|chili flakes|peperoncino|peperoncino in polvere|paprika|paprika dolce|nutmeg|noce moscata|pala|coriander|ketumbar|turmeric|curcuma|kunyit|thyme|timo|oregano|origano|rosemary|rosmarino|basil|basilico|parsley|prezzemolo|bay leaf|alloro|cloves|chiodi di garofano|cengkeh|cinnamon|cannella|kayu manis|cumin|cumino|jintan|curry|curry powder|garam masala|saffron|zafferano|chili powder|cabe bubuk|garlic powder|aglio in polvere|onion powder|bawang putih bubuk|powder|bubuk|msg|vetsin|micin|sasa|ajinomoto|royco|masako|knorr|stock cube|dado|dadi|brodo|brodo granulare|bouillon|kaldu|kaldu ayam|kaldu sapi|star anise|anice stellato|cardamom|cardamomo|kapulaga|lada putih|white pepper|cajun|herbes de provence|erbe di provenza|italian herbs',
    {
      weak: 'sale|mix',
      kind: 'seasoning|bumbu|spice mix|powder|bubuk|stock cube|dado|brodo|bouillon|kaldu',
    },
  ],
  [
    'pantry-staples',
    'pantry-staples:sauces',
    'sauce|salsa|sugo|saus|sambal|ketchup|mayonnaise|mayo|maionese|mustard|senape|mostarda|soy sauce|salsa di soia|kecap|kecap manis|kecap asin|oyster sauce|saus tiram|fish sauce|saus ikan|kecap ikan|hot sauce|sriracha|tabasco|barbecue sauce|bbq sauce|teriyaki|pesto|pesto genovese|ragu|sugo pronto|passata di pomodoro pronta|tahini|miso|worcestershire|aioli|salsa rosa|guacamole sauce|abc sambal|abc kecap|bango|sedap|indofood sambal|heinz|calve|star sugo|mutti sugo|barilla sugo|knorr sauce',
    { kind: 'sauce|salsa|sugo|saus|sambal|ketchup|mayonnaise|mayo|pesto|ragu' },
  ],
  [
    'pantry-staples',
    'pantry-staples:sweeteners',
    'sugar|zucchero|gula|gula pasir|gula merah|gula aren|brown sugar|zucchero di canna|honey|miele|madu|syrup|sciroppo|sirup|maple syrup|sciroppo d acero|agave|stevia|sweetener|dolcificante|molasses|melassa|marjan|abc sirup|eridania',
    { kind: 'syrup|sciroppo|sirup' },
  ],
  [
    'pantry-staples',
    'pantry-staples:cereal',
    'cereal|cereali|corn flakes|cornflakes|muesli|granola|porridge|oatmeal|fiocchi d avena|special k|kellogg|kelloggs|nesquik cereali|chocapic|fitness cereali|crunchy|sereal|koko krunch|energy bar|breakfast bar',
    { kind: 'cereal|cereali|muesli|granola|sereal' },
  ],
  ['pantry-staples', null, 'coconut milk|latte di cocco|santan|kara santan|coconut cream'],

  // ── Canned & Preserved ──────────────────────────────────────────
  [
    'canned',
    'canned:jams',
    'jam|marmellata|confettura|selai|nutella|spread|crema spalmabile|crema di nocciole|peanut butter|burro di arachidi|selai kacang|honey spread|nocciolata|pan di stelle crema|marmite|vegemite|ovomaltine crunchy|lemon curd|fruit spread',
    { kind: 'jam|marmellata|confettura|selai|spread|crema spalmabile' },
  ],
  [
    'canned',
    'canned:fish-meat',
    'tuna|tonno|tonno in scatola|tonno all olio|tonno sott olio|tonno al naturale|tuna in oil|tuna in olive oil|tuna in brine|canned tuna|sardine|sarden|sardines|sgombro in scatola|canned mackerel|kornet|corned beef|carne in scatola|simmenthal|spam|rio mare|nostromo|mareblu|callipo|as do mar|pronas|botan|abc sarden|ayam brand',
  ],
  [
    'canned',
    'canned:legumes',
    'bean|beans|fagioli|fagioli borlotti|fagioli cannellini|kidney beans|baked beans|chickpea|ceci|kacang arab|lentil|lenticchie|kacang merah|kacang hijau|mung beans|fave|piselli in scatola|legumi|lupini|valfrutta|cirio fagioli|bonduelle',
  ],
  [
    'canned',
    'canned:vegetables',
    'pelati|pomodori pelati|passata|passata di pomodoro|polpa di pomodoro|tomato puree|concentrato di pomodoro|tomato paste|chopped tomatoes|canned tomatoes|mais|mais in scatola|canned corn|olive|olives|olive verdi|olive nere|zaitun|capers|capperi|pickles|sottaceti|giardiniera|cetriolini|acar|sott olio|all olio|carciofini|funghi sott olio|mutti|cirio|pomi|valfrutta pelati|de rica',
  ],

  // ── Beverages ───────────────────────────────────────────────────
  [
    'beverages',
    'beverages:water',
    'water|acqua|mineral water|acqua minerale|acqua naturale|acqua frizzante|sparkling water|still water|air mineral|air putih|coconut water|acqua di cocco|air kelapa|san pellegrino|levissima|sant anna|ferrarelle|panna water|acqua panna|san benedetto|lete|rocchetta|uliveto|vera|norda|evian|aqua danone|le minerale|ades|cleo',
    { weak: 'air|aqua', kind: 'water|acqua' },
  ],
  [
    'beverages',
    'beverages:coffee-tea',
    'coffee|caffe|kopi|espresso|caffe latte|caffellatte|latte macchiato|flat white|ground coffee|caffe macinato|coffee beans|caffe in grani|coffee capsules|capsule caffe|cialde|cialde caffe|instant coffee|caffe solubile|cappuccino|decaf|decaffeinato|tea|green tea|black tea|herbal tea|te verde|te nero|te freddo|teh|teh celup|tisana|tisane|infuso|camomilla|chamomile|rooibos|matcha|earl grey|lavazza|illy|kimbo|segafredo|borbone|caffe vergnano|pellini|nescafe|nespresso|dolce gusto|lipton|twinings|pompadour|sant benedict tea|kapal api|good day|torabika|indocafe|abc kopi|luwak|sariwangi|teh botol|teh pucuk|sosro|tong tji|orzo solubile|caffe d orzo|ginseng',
    { weak: 'te', kind: 'coffee|caffe|kopi|tea|teh|tisana|camomilla' },
  ],
  [
    'beverages',
    'beverages:juice-soda',
    'juice|succo|succhi|succo di frutta|jus|soda|soft drink|bibita|bibite|cola|coca cola|coke|pepsi|fanta|sprite|7up|seven up|tonic|tonic water|acqua tonica|schweppes|chinotto|aranciata|limonata|lemonade|gassosa|ginger ale|ginger beer|iced tea|estathe|estate|the san benedetto|fuze tea|red bull|monster|energy drink|gatorade|powerade|pocari sweat|isotonic|sports drink|smoothie|frullato|yoga succhi|santal|skipper|zuegg|derby blue|tropicana|minute maid|buavita|country choice|nutrisari|marimas|teh kotak|frestea|you c1000|kratingdaeng|fruit tea|sirop',
    { kind: 'juice|succo|jus|soda|cola|lemonade|limonata|aranciata|iced tea' },
  ],
  [
    'beverages',
    'beverages:milk',
    'plant milk|oat milk|soy milk|almond milk|rice milk|coconut drink|latte di avena|latte di soia|latte di mandorla|latte di riso|bevanda vegetale|bevanda di avena|bevanda di soia|susu kedelai|susu almond|susu oat|alpro|oatly|valsoia|isola bio|vitasoy|chocolate milk|latte al cioccolato|susu coklat|milkshake|susu kotak',
  ],
  [
    'beverages',
    'beverages:alcohol',
    'beer|birra|bir|radler|lager|ipa|wine|vino|vino rosso|vino bianco|red wine|white wine|rose wine|prosecco|spumante|champagne|lambrusco|chianti|barolo|montepulciano|primitivo|nero d avola|spritz|aperol|campari|martini|vermouth|gin|vodka|rum|whisky|whiskey|tequila|grappa|limoncello|amaro|amaretto|sambuca|baileys|liquore|liquor|cider|sidro|sake|soju|peroni|moretti|birra moretti|menabrea|ichnusa|nastro azzurro|heineken|corona|beck|tennent|bintang|anker|guinness',
    { kind: 'beer|birra|bir|wine|vino' },
  ],

  // ── Snacks ──────────────────────────────────────────────────────
  [
    'snacks',
    'snacks:sweet',
    'biscuit|biscotti|biscotto|biskuit|cookie|cookies|chocolate|cioccolato|cioccolata|cioccolatini|cokelat|coklat|milk chocolate|cioccolato al latte|dark chocolate|cioccolato fondente|chocolate bar|tavoletta di cioccolato|candy|caramelle|permen|gummies|gummy bears|orsetti gommosi|marshmallow|lollipop|lecca lecca|chewing gum|gomma da masticare|wafer|wafers|praline|cioccolatini|ovetti|kinder|kinder bueno|kinder cereali|ferrero|ferrero rocher|raffaello|pocket coffee|mon cheri|baci perugina|perugina|lindt|milka|novi|ritter sport|toblerone|twix|mars|snickers|bounty|kitkat|kit kat|m m|smarties|haribo|mentos|tic tac|vigorsol|daygum|happydent|mulino bianco|pan di stelle|gocciole|oro saiwa|saiwa|plasmon|loacker|balocco|galbusera|digestive|oreo|beng beng|silverqueen|chitato coklat|tango|nabati|good time|roma kelapa|khong guan|monde|richeese|regal|marie|astor|chocolatos|delfi|top coklat|ice breakers|snack bar|barretta|barrette|protein bar|cereal bar',
    { kind: 'biscuit|biscotti|biskuit|cookie|candy|caramelle|permen|wafer' },
  ],
  [
    'snacks',
    'snacks:savory',
    'chips|crisps|patatine|keripik|kripik|potato chips|tortilla chips|nachos|popcorn|pop corn|pretzel|salatini|crackers|cracker|crackers salati|cheese crackers|crackers al formaggio|tuc|ritz|pringles|san carlo|amica chips|lays|doritos|cheetos|fonzies|taralli snack|rustichelle|chitato|qtela|lays indonesia|taro|chiki|kusuka|piattos|jetz|potabee|kerupuk|krupuk|emping|rempeyek|peyek|makaroni pedas|misura|snack|stuzzichini|olive snack',
    { kind: 'chips|crisps|patatine|keripik|crackers|cracker|kerupuk|krupuk|popcorn|pretzel' },
  ],
  [
    'snacks',
    'snacks:nuts',
    'nuts|nut|frutta secca|almond|mandorle|mandorla|walnut|noci|noce|hazelnut|nocciole|nocciola|peanut|arachidi|kacang tanah|kacang|cashew|anacardi|kacang mete|mete|pistachio|pistacchi|pistacchio|macadamia|pecan|pinoli|pine nuts|seeds|semi|semi di girasole|semi di zucca|kuaci|dried fruit|frutta disidratata|raisins|uvetta|uva passa|kismis|dates|datteri|kurma|dried apricots|albicocche secche|prugne secche|mixed nuts|trail mix|garuda kacang|dua kelinci|mr p',
  ],

  // ── Cleaning ────────────────────────────────────────────────────
  [
    'cleaning',
    'cleaning:dish',
    'dish soap|dishwashing liquid|washing up liquid|detersivo piatti|detersivo per piatti|sapone piatti|sabun cuci piring|dishwasher tablets|pastiglie lavastoviglie|detersivo lavastoviglie|dishwasher salt|sale lavastoviglie|sale per lavastoviglie|brillantante|rinse aid|svelto|nelsen|finish|fairy|pril|sunlight|mama lemon|cream lemon|dish',
    { weak: 'finish|fairy|dish', kind: 'dish soap|washing up liquid|detersivo piatti' },
  ],
  [
    'cleaning',
    'cleaning:tools',
    'sponge|spugna|spugne|spons|cloth|panno|panni|panno microfibra|microfiber cloth|lap|kain lap|mop|scopa|broom|sapu|mocio|pel lantai|kain pel|bucket|secchio|ember|rubber gloves|guanti in gomma|sarung tangan karet|scrubber|paglietta|spazzolone|brush|toilet brush|scopino|swiffer|vileda|scotch brite',
    { weak: 'pel' },
  ],
  [
    'cleaning',
    'cleaning:surface',
    'cleaner|cleaning spray|all purpose cleaner|multiuso|sgrassatore|degreaser|detergente pavimenti|floor cleaner|pembersih lantai|glass cleaner|vetri|detergente vetri|pembersih kaca|bathroom cleaner|anticalcare|limescale|toilet cleaner|pulitore wc|wc net|pembersih toilet|bleach|candeggina|varechina|pemutih|disinfectant|disinfettante|amuchina|alcool|alcohol spray|pembersih|cairan pembersih|oven cleaner|chanteclair|ace|cif|mastro lindo|mr muscle|smac|vim|lysol|domestos|harpic|bayclin|wipol|super pell|so klin lantai|vixal|mama lime|stella|napisan',
    { weak: 'ace|stella|vim|cairan', kind: 'cleaner|sgrassatore|pembersih|detergente pavimenti|bleach|candeggina' },
  ],

  // ── Laundry ─────────────────────────────────────────────────────
  [
    'laundry',
    'laundry:detergent',
    'laundry detergent|laundry liquid|laundry powder|washing powder|washing liquid|detersivo|detersivo lavatrice|detersivo bucato|detersivo per lavatrice|caps lavatrice|laundry pods|bucato|laundry|deterjen|sabun cuci|sabun cuci baju|deterjen cair|dash|dixan|ariel|perlana|omino bianco|bio presto|chanteclair lavatrice|persil|tide|rinso|attack|so klin|daia|surf|boom',
    { weak: 'dash|tide|surf|boom|attack', kind: 'detersivo|laundry detergent|deterjen' },
  ],
  ['laundry', 'laundry:softener', 'softener|fabric softener|ammorbidente|pelembut|pelembut pakaian|pewangi|pewangi pakaian|molto|downy|soupline|lenor|coccolino|vernel|comfort|kispray|rapika|ironing water|acqua per ferro|acqua demineralizzata|pelicin'],
  ['laundry', 'laundry:stain', 'stain remover|smacchiatore|pemutih pakaian|vanish|napisan|oxi|sapone di marsiglia|marsiglia|bleach for clothes|candeggina delicata|ace gentile'],

  // ── Toiletries ──────────────────────────────────────────────────
  [
    'toiletries',
    'toiletries:paper',
    'toilet paper|carta igienica|tissue toilet|tisu toilet|tissues|tissue|fazzoletti|fazzoletti di carta|tisu|tisu wajah|facial tissue|wet wipes|baby wipes|salviette|salviette umidificate|tisu basah|cotton pads|dischetti di cotone|kapas|cotton buds|cotton fioc|bastoncini cotonati|regina carta|foxy|tempo|scottex carta igienica|nice|paseo|tessa|mitu',
    { weak: 'tempo|nice' },
  ],
  [
    'toiletries',
    'toiletries:soap',
    'soap|sapone|sapone liquido|hand soap|hand wash|sabun|sabun mandi|sabun cair|shower gel|bagnoschiuma|bagno doccia|docciaschiuma|body wash|sabun badan|intimate wash|detergente intimo|lifebuoy|lux|nuvo|giv|dettol|palmolive|neutro roberts|felce azzurra|vidal|nivea shower|dove soap|dove bagnoschiuma',
    { weak: 'dove|lux', kind: 'soap|sapone|sabun|shower gel|bagnoschiuma' },
  ],
  [
    'toiletries',
    'toiletries:oral',
    'toothpaste|dentifricio|pasta gigi|odol|toothbrush|spazzolino|spazzolini|sikat gigi|dental floss|filo interdentale|benang gigi|mouthwash|collutorio|obat kumur|colgate|mentadent|az|oral b|oral-b|pepsodent|sensodyne|elmex|listerine|ciptadent|formula',
    { weak: 'az|formula' },
  ],
  [
    'toiletries',
    'toiletries:hair',
    'shampoo|sampo|conditioner|balsamo|balsamo capelli|hair mask|maschera capelli|hair oil|minyak rambut|hair spray|lacca|gel capelli|hair gel|pomade|tinta capelli|hair dye|cat rambut|pantene|head shoulders|head and shoulders|garnier fructis|elvive|sunsilk|clear|dove shampoo|tresemme|schwarzkopf|syoss|gliss|herbal essences|emir',
    { kind: 'shampoo|sampo|conditioner|balsamo' },
  ],
  [
    'toiletries',
    null,
    'razor|rasoio|rasoi|lamette|silet|pisau cukur|shaving foam|schiuma da barba|shaving gel|aftershave|dopobarba|gillette|bic|wilkinson|sanitary pads|assorbenti|pembalut|tampons|assorbenti interni|panty liners|proteggislip|pantyliner|lines|nuvenia|tampax|charm|laurier|softex|diapers|pannolini|popok|pampers|huggies|mamypoko|sweety|merries|cotton|q tips',
    { weak: 'lines|bic|charm|cotton' },
  ],

  // ── Beauty Care ─────────────────────────────────────────────────
  [
    'personal-care',
    'personal-care:skin',
    'face cream|hand cream|body cream|crema viso|crema mani|crema corpo|krim wajah|krim tangan|moisturizer|moisturiser|idratante|crema idratante|pelembab|serum|siero|body lotion|lozione|lotion|losion|sunscreen|sun cream|crema solare|protezione solare|tabir surya|sunblock|after sun|doposole|face wash|facial wash|detergente viso|sabun muka|sabun wajah|micellar water|acqua micellare|cleansing milk|latte detergente|latte struccante|make up remover|struccante|toner|tonico|face mask|maschera viso|masker|scrub|esfoliante|lip balm|burro cacao|burro di cacao|cocoa butter|body butter|tea tree|tea tree oil|olio di tea tree|baby oil|olio per bambini|body oil|olio corpo|aloe vera gel|nivea|neutrogena|garnier|l oreal|loreal|olay|vichy|la roche posay|cerave|avene|bioderma|eucerin|wardah|ponds|pond s|emina|scarlett|somethinc|skintific|citra|marina|vaseline|labello|bionike|collistar|diadermine',
    { kind: 'face cream|hand cream|crema viso|crema mani|moisturizer|serum|lotion|sunscreen|face wash|cleansing milk|latte detergente' },
  ],
  [
    'personal-care',
    'personal-care:makeup',
    'makeup|make up|trucco|lipstick|rossetto|lipstik|lip gloss|mascara|eyeliner|eyeshadow|ombretto|foundation|fondotinta|concealer|correttore|cipria|powder foundation|bedak|blush|fard|bronzer|nail polish|smalto|kutek|nail polish remover|solvente unghie|aseton|perfume|profumo|parfum|eau de toilette|cologne|colonia|body mist|deodorante profumato|kiko|maybelline|essence makeup|catrice|max factor|rimmel|sephora|pupa|deborah|make up forever|wardah lipstick|make over|implora|pixy|viva',
  ],
  [
    'personal-care',
    'personal-care:deodorant',
    'deodorant|deodorante|deodoran|antiperspirant|antitraspirante|roll on|deo spray|stick deodorant|rexona|borotalco|dove deodorant|nivea deo|axe|old spice|vidal deo|garnier mineral|biore deo|etiaxil',
    { weak: 'axe' },
  ],

  // ── Health ──────────────────────────────────────────────────────
  [
    'health',
    'health:medicine',
    'medicine|medicina|medicinale|farmaco|obat|pill|pillole|tablets|compresse|syrup for cough|sciroppo per la tosse|obat batuk|cough|tosse|batuk|paracetamol|tachipirina|efferalgan|ibuprofen|ibuprofene|moment|brufen|nurofen|aspirin|aspirina|oki|ketoprofene|antinfiammatorio|antacid|gaviscon|maalox|promag|mylanta|antihistamine|antistaminico|zirtec|clarityn|vicks|fluimucil|bisolvon|actifed|panadol|bodrex|paramex|mixagrip|decolgen|neozep|tolak angin|antangin|minyak kayu putih|freshcare|counterpain|salonpas|voltaren|lasonil|imodium|dissenten|enterogermina|biofermin|diapet|entrostop|nasal spray|spray nasale|obat tetes mata|collirio|eye drops|termometro|thermometer|test di gravidanza|pregnancy test|preservativi|condoms|kondom',
    { weak: 'moment|oki|cough|pill' },
  ],
  [
    'health',
    'health:vitamins',
    'vitamin|vitamins|vitamine|vitamina|multivitamin|multivitaminico|integratore|integratori|supplement|suplemen|omega 3|fish oil|olio di pesce|magnesium|magnesio|potassium|potassio|iron|ferro|zinc|zinco|calcium|calcio|probiotics|probiotici|collagen|collagene|melatonin|melatonina|vitamin c|vitamina c|vitamin d|vitamina d|supradyn|polase|enervit|redoxon|centrum|cerebrofort|imboost|enervon|ester c|holisticare|blackmores|sakatonik|scotts emulsion|protein powder|proteine in polvere|whey',
    { kind: 'vitamin|vitamina|vitamine|integratore|supplement|suplemen' },
  ],
  [
    'health',
    'health:first-aid',
    'plaster|plasters|cerotti|cerotto|plester|hansaplast|band aid|bandage|benda|bende|perban|garza|garze|kasa|gauze|disinfectant for wounds|acqua ossigenata|betadine|povidone|alcohol swab|cotone idrofilo|kapas medis|first aid|primo soccorso|p3k|hydrogen peroxide|tensoplast|salviette disinfettanti',
  ],

  // ── Pet ─────────────────────────────────────────────────────────
  [
    'pet',
    'pet:food',
    'pet food|cat food|dog food|cibo per gatti|cibo per cani|cibo gatto|cibo cane|makanan kucing|makanan anjing|makanan hewan|crocchette|croquettes|kibble|umido per gatti|umido per cani|cat treats|dog treats|snack per cani|snack per gatti|whiskas|felix|purina|friskies|gourmet gatto|sheba|royal canin|pedigree|almo nature|monge|me o|meo|bolt|cesar|schesir|hill s|hills science',
    { weak: 'bolt|cesar' },
  ],
  ['pet', 'pet:litter', 'cat litter|lettiera|sabbia per gatti|sabbia gatto|pasir kucing|litter|tappetini assorbenti cane|puppy pads|poop bags|sacchetti igienici cane|pet shampoo|shampoo per cani|flea|antipulci|frontline|advantix'],

  // ── Household ───────────────────────────────────────────────────
  [
    'household',
    'household:paper',
    'paper towel|kitchen roll|kitchen paper|carta da cucina|carta casa|scottex|tisu dapur|aluminium foil|aluminum foil|tin foil|foil|carta stagnola|carta alluminio|alluminio|cling film|plastic wrap|pellicola|pellicola trasparente|plastik wrap|baking paper|parchment paper|carta forno|kertas roti|napkins|tovaglioli|serbet|paper plates|piatti di carta|bicchieri di plastica|paper cups|piatti di plastica|posate di plastica|coffee filters|filtri caffe|domopak|cuki|rotolone regina|regina scottex|tuttapposto',
  ],
  [
    'household',
    'household:bags',
    'trash bags|garbage bags|bin bags|bin liners|sacchi spazzatura|sacchi immondizia|sacchetti spazzatura|sacchetti per il gelo|sacchetti gelo|freezer bags|ziplock|ziploc|kantong sampah|plastik sampah|kantong plastik|vacuum bags|sacchetti aspirapolvere|sacchetti organico|compostable bags|sacchetti compostabili|sacchi|sacchetti',
  ],
  [
    'household',
    'household:batteries',
    'battery|batteries|batterie|batteria|pile|baterai|batre|light bulb|lampadina|lampadine|bohlam|lampu|led bulb|lampadina led|duracell|energizer|varta|alkaline|abc baterai|panasonic batteries|philips lampadina|osram|candle|candele|candela|lilin|matches|fiammiferi|korek api|lighter|accendino|accendini|extension cord|prolunga|ciabatta elettrica|kabel roll|power strip|adapter',
    { weak: 'pile|alkaline|adapter' },
  ],
  [
    'household',
    null,
    'air freshener|room spray|deodorante per ambienti|deodorante ambienti|profumatore per ambienti|profumo per ambienti|diffusore|diffusore per ambienti|pengharum ruangan|pewangi ruangan|deodoran ruangan|glade|air wick|ambi pur|stella pengharum|bayfresh|insect spray|insetticida|zanzare|mosquito|baygon|hit spray|vape|autan|raid|obat nyamuk|anti zanzara|zampirone|shoe polish|lucido scarpe|semir sepatu|kiwi shoe|glue|colla|lem|tape|nastro adesivo|selotip|scotch tape|lakban|light bulbs',
    { weak: 'vape|hit|raid|glue|tape|lem|kiwi shoe' },
  ],

  // ── Miscellaneous / Seasonal ────────────────────────────────────
  ['misc', 'misc:gifts', 'gift|regalo|regali|kado|hadiah|gift wrap|carta regalo|kertas kado|birthday card|biglietto di auguri|kartu ucapan|party|festa|balloons|palloncini|balon|party supplies|candeline|lilin ulang tahun|flowers|fiori|bunga|bouquet|mazzo di fiori'],
  ['misc', 'misc:seasonal', 'christmas|natale|natal|easter|pasqua|paskah|halloween|lebaran|idul fitri|ketupat|parcel lebaran|uova di pasqua|easter egg|christmas tree|albero di natale|presepe|addobbi|decorations|decorazioni'],
  [
    'misc',
    null,
    'engine oil|motor oil|olio motore|olio per motore|oli mesin|oli motor|antifreeze|antigelo|liquido tergicristalli|wiper fluid|car shampoo|shampoo auto|car wax|cera auto|air radiator|air aki|deodorante auto|car air freshener|pengharum mobil|lavavetri',
  ],

  // ── Home & Appliances (durable, last so consumables win) ────────
  [
    'appliances',
    'appliances:kitchen',
    'oven|forno|microwave|microonde|kettle|bollitore|teko listrik|toaster|tostapane|blender|frullatore|frullatore a immersione|mixer|planetaria|stand mixer|food processor|robot da cucina|coffee machine|macchina caffe|macchina del caffe|macchinetta del caffe|moka|caffettiera|french press|air fryer|friggitrice|friggitrice ad aria|fridge|refrigerator|frigorifero|frigo|kulkas|freezer|congelatore|dishwasher|lavastoviglie machine|rice cooker|magic com|magicom|slow cooker|pressure cooker|pentola a pressione|presto|induction hob|piano cottura|piano a induzione|kompor|kompor gas|hob|juicer|centrifuga|estrattore|spremiagrumi|citrus press|bread maker|macchina del pane|sandwich maker|piastra|waffle maker|grill|griglia elettrica|bilancia da cucina|kitchen scale|timbangan dapur|thermomix|bimby|kenwood|kitchenaid|de longhi|delonghi|nespresso machine|smeg|philips airfryer|cosori|ninja',
    { weak: 'presto|grill|frigo|ninja' },
  ],
  [
    'appliances',
    'appliances:kitchenware',
    'frying pan|padella|padelle|saucepan|pentola|pentole|casseruola|wajan|panci|wok|knife|knives|coltello|coltelli|pisau|pisau dapur|cutting board|tagliere|talenan|spatula|spatola|sutil|mestolo|ladle|centong|colander|scolapasta|saringan|baking tray|teglia|loyang|baking dish|pirofila|food container|food containers|contenitore|contenitori|contenitori per alimenti|tupperware|lock lock|lock n lock|wadah makanan|cutlery|posate|sendok|garpu|fork|spoon|cucchiaio|cucchiai|forchetta|forchette|plates|piatti fondi|piatti piani|piring|bowl|ciotola|ciotole|mangkok|glasses|bicchieri|gelas|mug|tazza|tazze|cangkir|teapot|teiera|thermos|borraccia|water bottle|botol minum|lunch box|portapranzo|kotak makan|grater|grattugia|parutan|peeler|pelapatate|whisk|frusta|rolling pin|mattarello|measuring cup|misurino|apriscatole|can opener|cavatappi|corkscrew|oven gloves|presine|kitchen towel|strofinaccio|serbet dapur|ikea|tescoma|lagostina|ballarini|bialetti|alessi|pyrex',
    { weak: 'ikea|mug|bowl|fork|spoon' },
  ],
  ['appliances', 'appliances:cleaning', 'vacuum|vacuum cleaner|aspirapolvere|aspirapolvere robot|robot vacuum|robot aspirapolvere|penyedot debu|steam mop|lavapavimenti|vaporetto|folletto|dyson|roomba|rowenta|hoover|washing machine|lavatrice|mesin cuci|dryer|asciugatrice|steam iron|ferro da stiro|setrika|ironing board|asse da stiro|meja setrika'],
  [
    'appliances',
    'appliances:air',
    'air purifier|purificatore|purificatore d aria|depuratore|air conditioner|condizionatore|climatizzatore|ac portatile|ac split|pendingin ruangan|fan|ventilatore|kipas|kipas angin|heater|stufa|stufetta|termoventilatore|pemanas ruangan|dehumidifier|deumidificatore|humidifier|umidificatore|air cooler|raffrescatore|xiaomi purifier|dyson fan',
  ],
  [
    'appliances',
    'appliances:electronics',
    'laptop|notebook pc|computer|pc|monitor|keyboard|tastiera|mouse|printer|stampante|ink cartridge|cartuccia|cartucce|toner stampante|tinta printer|headphones|cuffie|earphones|auricolari|earbuds|webcam|router|modem|charger|caricatore|caricabatterie|cable|cavo usb|usb cable|kabel data|power bank|hard disk|ssd|usb stick|chiavetta usb|flashdisk|sd card|memory card|tablet|ipad|smartphone|phone|telefono|hp|tv|televisore|televisi|speaker|cassa bluetooth|desk|scrivania|meja kerja|office chair|sedia da ufficio|sedia ufficio|kursi kantor|lamp|lampada da scrivania|desk lamp|lampu meja|smartwatch|hair dryer|asciugacapelli|phon|hair straightener|piastra capelli|catokan|electric toothbrush|spazzolino elettrico|shaver|rasoio elettrico',
    { weak: 'phone|hp|tv|lamp|cable|tablet|pc' },
  ],
]
