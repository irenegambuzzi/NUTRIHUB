import { describe, expect, it } from 'vitest'
import { guessCategory, normalizeName, singular } from './categoryGuess'

const sub = (name) => guessCategory(name)?.subcategoryId
const parent = (name) => guessCategory(name)?.categoryId

describe('normalizeName', () => {
  it('ignores case, accents, punctuation and amounts', () => {
    expect(normalizeName('Ice-Cream 500g')).toBe('ice cream')
    expect(normalizeName('Caffè  Macinato 250 gr')).toBe('caffe macinato')
    expect(normalizeName("Tonno all'olio x3")).toBe('tonno all olio')
    expect(normalizeName('Acqua 1,5 L 6 pz')).toBe('acqua')
  })

  it('turns English plurals into the singular', () => {
    expect(singular('berries')).toBe('berry')
    expect(singular('tomatoes')).toBe('tomato')
    expect(singular('apples')).toBe('apple')
    expect(singular('glass')).toBe('glass')
  })
})

describe('guessCategory', () => {
  it('finds ice cream however it is written, and never as skincare', () => {
    for (const name of ['icecream', 'ice cream', 'Ice-Cream', 'ICE CREAMS', 'Ice cream vaniglia 500g']) {
      expect(sub(name), name).toBe('frozen:ice-cream')
    }
  })

  it('only matches short words as whole words', () => {
    expect(guessCategory('TEST')).toBeNull()
    expect(guessCategory('Testo')).toBeNull()
    expect(sub('steak')).toBe('meat:beef')
  })

  it('lets a specific phrase beat the words inside it', () => {
    expect(parent('air freshener')).toBe('household')
    expect(sub('tea tree oil')).toBe('personal-care:skin')
    expect(sub('latte detergente')).toBe('personal-care:skin')
    expect(sub('olio per bambini')).toBe('personal-care:skin')
    expect(parent('Deodorante per ambienti')).toBe('household')
    expect(sub('vacuum cleaner')).toBe('appliances:cleaning')
    expect(sub('carta forno')).toBe('household:paper')
    expect(sub('pasta gigi')).toBe('toiletries:oral')
    expect(sub('Rice cooker')).toBe('appliances:kitchen')
    expect(sub('Air purifier')).toBe('appliances:air')
    expect(sub('milk chocolate')).toBe('snacks:sweet')
    expect(sub('oat milk')).toBe('beverages:milk')
  })

  it("doesn't put car supplies with cooking oils", () => {
    expect(parent('spray olio motore')).toBe('misc')
  })

  it('lets the kind of product beat its flavour or ingredient', () => {
    expect(sub('strawberry yogurt')).toBe('dairy:yogurt')
    expect(sub('orange juice')).toBe('beverages:juice-soda')
    expect(sub('tomato sauce')).toBe('pantry-staples:sauces')
    expect(sub('Beef Mix Seasoning')).toBe('pantry-staples:spices')
    expect(sub('garlic powder')).toBe('pantry-staples:spices')
    expect(sub('chicken soup')).toBe('deli:ready')
    expect(sub('cheese crackers')).toBe('snacks:savory')
    expect(sub('oven cleaner')).toBe('cleaning:surface')
    expect(sub("Tonno all'olio")).toBe('canned:fish-meat')
  })

  it('accepts ambiguous short words only as the whole name', () => {
    expect(sub('Air')).toBe('beverages:water')
    expect(sub('Air 1,5 L')).toBe('beverages:water')
    expect(sub('Te')).toBe('beverages:coffee-tea')
    expect(sub('Sale')).toBe('pantry-staples:spices')
    expect(sub('Dash')).toBe('laundry:detergent')
    expect(sub('sale per lavastoviglie')).toBe('cleaning:dish')
    expect(sub('air conditioner')).toBe('appliances:air')
  })

  it("doesn't guess when the name is unclear or unknown", () => {
    expect(guessCategory('xyz')).toBeNull()
    expect(guessCategory('Stuff for Marco')).toBeNull()
    expect(guessCategory('')).toBeNull()
    expect(guessCategory(' a ')).toBeNull()
    expect(guessCategory(null)).toBeNull()
  })

  // A long list of real shopping-list items (Italian, English, Indonesian
  // and brands from Italian and Indonesian supermarkets).
  const REAL_ITEMS = {
    'produce:fruit': ['Mele Golden', 'Banane', 'Arance tarocco', 'Apples', 'Strawberries', 'Kiwi gold', 'Pisang', 'Jeruk', 'Avocado', 'Limoni', 'Mirtilli', 'Uva bianca', 'Pesche', 'Melone', 'Watermelon', 'Clementine'],
    'produce:vegetables': ['Eggplant', 'Melanzane', 'Pomodorini ciliegino', 'Zucchine', 'Carote', 'Peperoni rossi', 'Broccoli', 'Funghi champignon', 'Spinaci', 'Bayam', 'Cabe rawit', 'Cetrioli', 'Finocchi', 'Asparagi', 'Cavolfiore'],
    'produce:potatoes': ['Patate', 'Potatoes', 'Kentang', 'Cipolle rosse', 'Aglio', 'Bawang merah', 'Bawang putih', 'Zenzero', 'Sweet potatoes'],
    'produce:salad': ['Insalata iceberg', 'Rucola', 'Lettuce', 'Misticanza', 'Valeriana'],
    'meat:poultry': ['Petto di pollo', 'Chicken breast', 'Ayam potong', 'Fesa di tacchino', 'Ali di pollo'],
    'meat:beef': ['Macinato di manzo', 'Bistecca di manzo', 'Salsicce', 'Hamburger', 'Daging sapi', 'Costine di maiale', 'Pancetta', 'Guanciale'],
    'meat:seafood': ['Salmone', 'Gamberetti', 'Orata', 'Ikan nila', 'Udang', 'Cozze', 'Merluzzo'],
    'dairy:milk': ['Latte intero', 'Latte parzialmente scremato', 'Fresh milk', 'Susu UHT', 'Panna da cucina', 'Parmalat Zymil', 'Granarolo latte'],
    'dairy:yogurt': ['Yogurt greco', 'Muller yogurt fragola', 'Activia', 'Skyr', 'Budino al cioccolato', 'Danone'],
    'dairy:cheese': ['Mozzarella', 'Parmigiano Reggiano', 'Grana Padano grattugiato', 'Ricotta', 'Mascarpone', 'Gorgonzola', 'Philadelphia', 'Keju cheddar', 'Galbani', 'Burrata'],
    'dairy:butter': ['Burro', 'Butter', 'Margarina', 'Blue Band'],
    'dairy:eggs': ['Uova', 'Uova bio x6', 'Eggs', 'Telur ayam'],
    'deli:cold-cuts': ['Prosciutto cotto', 'Prosciutto crudo', 'Salame Milano', 'Mortadella', 'Bresaola', 'Speck', 'Wurstel', 'Rovagnati'],
    'deli:fresh-pasta': ['Tortellini', 'Gnocchi di patate', 'Ravioli ricotta e spinaci', 'Giovanni Rana'],
    'bakery:bread': ['Pane', 'Pane integrale', 'Pancarrè', 'Bread', 'Roti tawar', 'Piadina', 'Baguette', 'Sari Roti'],
    'bakery:pastries': ['Croissant', 'Cornetti', 'Brioche', 'Torta di mele', 'Panettone', 'Muffin', 'Kue bolu'],
    'bakery:crispbread': ['Grissini', 'Fette biscottate', 'Taralli'],
    'frozen:ice-cream': ['Gelato', 'Magnum', 'Algida cornetto', 'Ghiaccioli', 'Es krim', 'Sorbetto al limone'],
    'frozen:vegetables': ['Piselli surgelati', 'Spinaci surgelati', 'Minestrone surgelato', 'Frozen peas'],
    'frozen:meals': ['Pizza surgelata', 'Frozen pizza', 'Chicken nuggets', 'Sofficini', 'Patatine fritte surgelate', 'Fiesta nugget', 'Findus'],
    'frozen:fish': ['Bastoncini di pesce', 'Fish fingers', 'Capitan Findus'],
    'pantry-staples:grains': ['Riso basmati', 'Riso Carnaroli', 'Beras', 'Couscous', 'Quinoa', 'Fiocchi di avena'],
    'pantry-staples:pasta': ['Spaghetti Barilla', 'Penne rigate', 'Fusilli De Cecco', 'Indomie', 'Mie instan', 'Rummo linguine', 'Lasagne'],
    'pantry-staples:baking': ['Farina 00', 'Lievito di birra', 'Tepung terigu', 'Baking powder', 'Pangrattato', 'Zucchero a velo'],
    'pantry-staples:oils': ['Olio extra vergine', 'Olio di semi', 'Minyak goreng', 'Aceto balsamico', 'Bimoli', 'Olive oil'],
    'pantry-staples:spices': ['Sale grosso', 'Pepe nero', 'Origano', 'Paprika', 'Curry', 'Dado Knorr', 'Royco', 'Masako', 'Cannella', 'Garam'],
    'pantry-staples:sauces': ['Ketchup Heinz', 'Maionese', 'Pesto alla genovese', 'Kecap manis', 'Sambal ABC', 'Saus tiram', 'Soy sauce', 'Sugo al basilico'],
    'pantry-staples:sweeteners': ['Zucchero', 'Miele', 'Gula pasir', 'Sciroppo d acero', 'Madu'],
    'pantry-staples:cereal': ['Corn flakes', 'Muesli', 'Granola', 'Special K', 'Koko Krunch'],
    'canned:jams': ['Nutella', 'Marmellata di albicocche', 'Peanut butter', 'Selai kacang', 'Confettura extra'],
    'canned:fish-meat': ['Tonno Rio Mare', 'Sardine', 'Corned beef', 'Tonno Nostromo', 'Simmenthal'],
    'canned:legumes': ['Ceci', 'Fagioli borlotti', 'Lenticchie', 'Kidney beans'],
    'canned:vegetables': ['Pelati', 'Passata di pomodoro', 'Polpa Mutti', 'Mais', 'Olive verdi', 'Capperi'],
    'beverages:water': ['Acqua naturale', 'Acqua frizzante San Pellegrino', 'Levissima', 'Air mineral', 'Aqua', 'Sparkling water'],
    'beverages:coffee-tea': ['Caffè Lavazza', 'Caffè macinato', 'Capsule Nespresso', 'Tè verde', 'Camomilla', 'Kopi Kapal Api', 'Teh celup Sariwangi', 'Green tea'],
    'beverages:juice-soda': ['Coca Cola', 'Fanta', 'Succo di mela', 'Orange juice', 'Estathe', 'Red Bull', 'Aranciata', 'Pocari Sweat', 'Teh Kotak'],
    'beverages:milk': ['Oat milk', 'Latte di soia', 'Alpro', 'Susu kedelai', 'Chocolate milk'],
    'beverages:alcohol': ['Birra Moretti', 'Peroni', 'Vino rosso', 'Prosecco', 'Aperol', 'Bintang', 'Heineken', 'Limoncello'],
    'snacks:sweet': ['Biscotti Mulino Bianco', 'Pan di Stelle', 'Cioccolato fondente', 'Kinder Bueno', 'Oreo', 'Haribo', 'Beng Beng', 'Wafer Loacker', 'Ferrero Rocher', 'Gocciole'],
    'snacks:savory': ['Patatine San Carlo', 'Pringles', 'Chips', 'Popcorn', 'Crackers', 'Chitato', 'Kerupuk', 'Tortilla chips'],
    'snacks:nuts': ['Mandorle', 'Noci', 'Arachidi', 'Pistacchi', 'Kacang mete', 'Datteri', 'Mixed nuts'],
    'cleaning:dish': ['Detersivo piatti', 'Pastiglie lavastoviglie', 'Finish', 'Svelto', 'Sabun cuci piring', 'Sunlight', 'Dish soap'],
    'cleaning:tools': ['Spugne', 'Panno microfibra', 'Mocio Vileda', 'Guanti in gomma', 'Scopa'],
    'cleaning:surface': ['Sgrassatore Chanteclair', 'Candeggina', 'Anticalcare', 'WC Net', 'Glass cleaner', 'Pembersih lantai', 'Ace', 'Amuchina', 'Mastro Lindo'],
    'laundry:detergent': ['Detersivo lavatrice', 'Dixan', 'Ariel pods', 'Rinso', 'So Klin', 'Laundry detergent', 'Dash'],
    'laundry:softener': ['Ammorbidente', 'Lenor', 'Molto', 'Downy', 'Fabric softener'],
    'laundry:stain': ['Smacchiatore', 'Vanish'],
    'toiletries:paper': ['Carta igienica', 'Fazzoletti', 'Tisu', 'Salviette umidificate', 'Wet wipes', 'Toilet paper', 'Dischetti di cotone'],
    'toiletries:soap': ['Bagnoschiuma', 'Sapone liquido', 'Sabun mandi', 'Lifebuoy', 'Shower gel', 'Dove'],
    'toiletries:oral': ['Dentifricio', 'Spazzolino', 'Colgate', 'Mentadent', 'Pepsodent', 'Collutorio', 'Filo interdentale'],
    'toiletries:hair': ['Shampoo', 'Balsamo', 'Pantene', 'Head & Shoulders', 'Sunsilk', 'Conditioner'],
    'personal-care:skin': ['Crema viso', 'Crema mani', 'Nivea crema', 'Crema solare', 'Sunscreen', 'Face wash', 'Acqua micellare', 'Lip balm', 'Body lotion'],
    'personal-care:makeup': ['Mascara', 'Rossetto', 'Smalto', 'Profumo', 'Foundation', 'Bedak'],
    'personal-care:deodorant': ['Deodorante', 'Deodorant', 'Rexona', 'Borotalco'],
    'health:medicine': ['Tachipirina', 'Moment', 'Oki', 'Paracetamol', 'Ibuprofene', 'Obat batuk', 'Panadol', 'Vicks', 'Tolak Angin'],
    'health:vitamins': ['Vitamina C', 'Vitamin D', 'Magnesio', 'Integratore', 'Supradyn', 'Omega 3', 'Imboost'],
    'health:first-aid': ['Cerotti', 'Hansaplast', 'Garze', 'Betadine', 'Acqua ossigenata'],
    'pet:food': ['Crocchette gatto', 'Cat food', 'Whiskas', 'Royal Canin', 'Makanan kucing', 'Dog food'],
    'pet:litter': ['Lettiera', 'Cat litter', 'Pasir kucing'],
    'household:paper': ['Scottex', 'Carta stagnola', 'Pellicola trasparente', 'Kitchen roll', 'Tovaglioli', 'Baking paper'],
    'household:bags': ['Sacchi spazzatura', 'Trash bags', 'Kantong sampah', 'Sacchetti gelo'],
    'household:batteries': ['Batterie AA', 'Lampadina LED', 'Duracell', 'Candele', 'Baterai'],
    'appliances:kitchen': ['Friggitrice ad aria', 'Air fryer', 'Microonde', 'Bollitore', 'Tostapane', 'Rice cooker', 'Macchina del caffè', 'Moka Bialetti'],
    'appliances:kitchenware': ['Padella', 'Pentola', 'Coltelli', 'Tagliere', 'Tupperware', 'Bicchieri', 'Wajan'],
    'appliances:cleaning': ['Aspirapolvere', 'Robot aspirapolvere', 'Folletto', 'Ferro da stiro', 'Lavatrice'],
    'appliances:air': ['Ventilatore', 'Deumidificatore', 'Kipas angin', 'Stufetta'],
    'appliances:electronics': ['Caricatore', 'Cuffie', 'Mouse', 'Power bank', 'Cartucce stampante', 'Monitor'],
  }

  for (const [expected, names] of Object.entries(REAL_ITEMS)) {
    it(`real items → ${expected}`, () => {
      for (const name of names) expect(sub(name), name).toBe(expected)
    })
  }

  it('fills in only a main category where there is no sub-category', () => {
    expect(guessCategory('Pannolini Pampers')).toEqual({ categoryId: 'toiletries', subcategoryId: null })
    expect(guessCategory('Latte di cocco')).toEqual({ categoryId: 'pantry-staples', subcategoryId: null })
    expect(guessCategory('Insetticida zanzare')).toEqual({ categoryId: 'household', subcategoryId: null })
  })
})
