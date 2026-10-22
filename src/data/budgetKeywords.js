import { TRIPS_CATEGORY_ID } from './constants'

// Keywords for guessing a MONEY (budget) category from an expense name,
// for a MONEY row that isn't added to HOME ("Benzina Eni" → Car / Vehicle ›
// Fuel). Same matching as the HOME list (data/categoryKeywords.js, read its
// header): lower case without accents, more words beat fewer, and a weak
// word only counts as the whole name. List a weak word ONLY in `weak`.
//
// The rules point at MONEY categories by id, never by name, so Irene can
// rename any MONEY category (main or sub) at any time without breaking a
// rule; the chips always show the names as they are now. A rule whose main
// category doesn't exist (deleted, or supabase/024_categories.sql not run
// yet) is ignored; if only its sub is missing, it suggests the main.
//
// Keywords are matched on the cleaned name, where punctuation is a space:
// "booking.com" is "booking com" and "B&B" is "b b". They are written
// below as people type them ("booking.com", "b&b") and match either way.
//
// Each rule: [main category id, sub-category id (or null), keywords, options].

// ── Existing MONEY categories (ids from the live database, 21/10/2026) ──
const TRIPS = TRIPS_CATEGORY_ID // Trips & Holidays (was "Holiday"; may be renamed again)
const TRIPS_ACCOMMODATION = '72cb10f3-3fbd-4bb1-b0f8-81c5cc357077' // Trips & Holidays › Accommodation
const TRIPS_TRANSPORT = '5d4cc03f-a148-43b1-b2eb-2186012a20c9' // Trips & Holidays › Transport
const TRIPS_ACTIVITIES = 'df3c1786-b4e8-40b8-b55a-b74f8816e7c2' // Trips & Holidays › Activities
// (Trips & Holidays › Food & Drinks has no keywords: round 7 sends daily
// categories there during a trip.)
const SUBSCRIPTION = '688bfedf-8e4c-4b59-860f-3a55c33f50d1' // Subscription
const CLOUD_STORAGE = 'edad180d-c221-4c2a-acc8-9c88cccb7e1e' // Subscription › Cloud Storage
const MEMBERSHIPS = 'f75f30c9-c111-4a54-be05-e227999e42ef' // Subscription › Memberships
const ENTERTAINMENT = '744f7d8e-c90d-49d3-ad03-72c6e81aad9d' // Entertainment
const CAR = '8b2d4f49-af1d-41af-bd19-9050a7689164' // Car / Vehicle
const HEALTH = '06729df9-06b2-4465-955b-17d03f3fe125' // Health
const PETS = 'ecd9a924-7f46-4991-83ce-02825c73ce42' // Pets
const BANK = 'b498cc5d-95ea-4666-89f2-11973222ec2c' // Bank & Fee
const CIGARETTES = '75310604-5b9b-431c-9837-b2065747409f' // Cigarettes & Vape
const GOING_OUT = '676901e2-4693-47cb-93e4-b071a8eac8f3' // Going out
const RESTAURANT = '85f20924-a159-4db9-bab5-0cbc4ea42863' // Going out › Restaurant
const BAR = '21faa851-8ee3-4f60-818f-fc3ef4113aa5' // Going out › Bar & Coffee
const APERITIVO = 'd09b12af-5dba-44a5-915c-7e2b88793868' // Going out › Aperitivo
const TAKEAWAY = '7454f9c2-0284-4583-a45d-a2dcdb3397a9' // Going out › Takeaway & Delivery
const HOUSING = '88ea2c65-397a-4774-b4de-22886f397cf5' // Housing & Utilities
const RENT = '7b689322-058b-489a-a224-bd12db8b8cf5' // Housing & Utilities › Rent
const ELECTRICITY = 'fe8d77d6-a366-4017-b3c5-779c3f56ec63' // Housing & Utilities › Electricity
const GAS = '2a337052-a953-422a-9fd4-ecdc208a76b4' // Housing & Utilities › Gas
const WATER = '1ae97eac-85af-409c-9832-7d6880b64cfa' // Housing & Utilities › Water
const WASTE = '517a69ad-bb5c-4f24-93fd-5f71eb008062' // Housing & Utilities › Waste Collection
const INTERNET = '2abfd336-3daa-4722-8280-4ccd9a572f42' // Housing & Utilities › Internet & Phone
const SHOPPING = '654a80a3-2e6f-4ada-b214-0486d91d869c' // Shopping
const CLOTHING = '732af8e0-924c-471c-b0e8-ac9286ce074e' // Shopping › Clothing
const SHOES = '0f7f387b-0c4a-4095-8865-59cfac4c586a' // Shopping › Shoes & Accessories
const ELECTRONICS = '1697124e-22a7-4417-b5b9-0439ccc67e17' // Shopping › Electronics
const GIFTS = '3cdeb3d8-6603-4ac8-a56b-73fd3690fd1c' // Shopping › Gifts

// ── New in supabase/024_categories.sql, with the same fixed ids there ──
// (a test checks that the two lists are identical)
export const NEW_MONEY_CATEGORY_IDS = {
  personalCare: 'f194dd95-a6c4-4399-a2ed-2114d6b8a1eb', // Personal Care (main)
  familySupport: '54c1355d-5ebb-4237-ae67-1be0ca593443', // Family Support (main, no sub)
  flights: '38455d3e-ab33-4eae-8088-e6c9e4e55b3e', // Trips & Holidays › Flights
  souvenirs: 'a972798e-d08c-4b09-b8cf-cfe5c1724128', // Trips & Holidays › Souvenirs
  insuranceVisas: '5c21c7eb-281b-46b5-ac2c-d42da39dd548', // Trips & Holidays › Insurance & Visas
  beautyPerfume: '4eb77042-660a-41e9-a1b6-cd2057605256', // Personal Care › Beauty & Perfume
  toiletries: '01a993f2-d9af-4881-bc8e-1df5af027000', // Personal Care › Toiletries
  hairdresser: 'd3728a31-bd77-487d-ac80-aaffe90fa5f3', // Personal Care › Hairdresser
  streaming: 'a953640c-9716-4f1f-a989-279c03ddba63', // Subscription › Streaming
  softwareApps: 'd9c27fc6-378b-475b-b4e9-097b6e448a27', // Subscription › Software & Apps
  cinemaEvents: '02fd813a-21b8-4d24-91c3-dbb289af07bb', // Entertainment › Cinema & Events
  fuel: '6aedf34e-9f47-48e9-a5ca-7b8b529fa447', // Car / Vehicle › Fuel
  maintenance: '1fe3c787-1e67-4e31-86a1-d6114f2ef473', // Car / Vehicle › Maintenance
  insuranceTax: '90065703-c0e7-436e-9ba3-2992dc819c7c', // Car / Vehicle › Insurance & Tax
  parkingTolls: 'e6ce7094-0f5c-49f7-aff4-78e2b9f2e494', // Car / Vehicle › Parking & Tolls
  pharmacy: '8fbe343f-6fd9-4c58-874b-d9bd809be461', // Health › Pharmacy
  doctorTests: 'cd1ec5e6-4c7e-4f38-a86f-e6d1e42b10f5', // Health › Doctor & Tests
  dentist: '3bbb8479-42e4-4f40-b9fb-bacc5d586128', // Health › Dentist
  glassesLenses: 'f81fa3cb-8dfc-45f5-b351-f22d877761cd', // Health › Glasses & Lenses
  veterinary: 'b79bd43a-bfa9-4101-93d7-70468af9dcfd', // Pets › Veterinary
  petSitting: '9d61caa3-80c5-4104-a734-51deca1f19ed', // Pets › Pet Sitting
  taxesFines: 'e2fe4339-59ac-4f79-af56-8bb5f3aeac9d', // Bank & Fee › Taxes & Fines
  documentsPermits: 'f6f56e33-bfc9-426c-9b3d-d1c217620316', // Bank & Fee › Documents & Permits
}
const N = NEW_MONEY_CATEGORY_IDS

export const BUDGET_RULES = [
  // ── Car / Vehicle ───────────────────────────────────────────────
  [CAR, N.fuel, 'fuel|benzina|diesel|gasolio|carburante|rifornimento|gpl|bensin|pertamax|petrol|distributore|enilive|tamoil|agip|totalerg', { weak: 'eni|ip|api|shell|esso|q8|metano' }],
  [CAR, N.maintenance, 'tagliando|meccanico|officina|car service|oil change|cambio olio|pneumatici|tyres|tires|cambio gomme|gommista|revisione|carrozzeria|carrozziere|car repair|riparazione auto|batteria auto|bengkel|ganti oli|norauto|euromaster|lavaggio auto|car wash|autolavaggio', { weak: 'gomme' }],
  [CAR, N.insuranceTax, 'rc auto|assicurazione auto|car insurance|polizza auto|bollo auto|tassa automobilistica|pajak mobil|asuransi mobil|prima assicurazioni|genertel|direct line|linear assicurazioni|conte it|allianz direct', { weak: 'bollo|verti' }],
  [CAR, N.parkingTolls, 'parking|parcheggio|strisce blu|easypark|telepass|unipolmove|pedaggio|autostrada|toll|casello|parkir', { weak: 'sosta|tol|ztl' }],

  // ── Trips & Holidays ────────────────────────────────────────────
  [TRIPS, N.flights, 'flight|volo|voli|biglietto aereo|plane ticket|airline|ryanair|easyjet|wizz air|wizzair|ita airways|lufthansa|emirates|qatar airways|turkish airlines|air france|singapore airlines|garuda indonesia|batik air|lion air|airasia|vueling|volotea|tiket pesawat|pesawat|baggage fee|bagaglio extra', { weak: 'klm|scoot' }],
  [TRIPS, N.souvenirs, 'souvenir|ricordino|oleh oleh|calamite|cartolina|postcard|keychain|portachiavi', { weak: 'magnet|calamita' }],
  [TRIPS, N.insuranceVisas, 'travel insurance|assicurazione viaggio|evisa|e visa|visa on arrival|schengen visa|asuransi perjalanan|heymondo|world nomads|safetywing|allianz travel|axa travel', { weak: 'visa|esta|visto' }],
  // "agriturismo" is weak: in Emilia it is mostly a dinner out, so only
  // the bare name means a stay ("Cena agriturismo" is not a hotel).
  [TRIPS, TRIPS_ACCOMMODATION, 'hotel|albergo|airbnb|booking.com|b&b|bnb|bed and breakfast|ostello|hostel|penginapan|guest house|guesthouse|homestay|resort|agoda|hotels.com|motel', { weak: 'agriturismo|booking' }],
  // Taxi, Uber and trains are here because MONEY has no everyday
  // transport category; "Uber Eats" stays Takeaway (two words beat one),
  // and "Rent a car" beats the weak "rent" of Rent.
  [TRIPS, TRIPS_TRANSPORT, 'trenitalia|frecciarossa|frecciargento|italo treno|treno italo|italotreno|biglietto treno|train ticket|tiket kereta|taxi|uber|noleggio auto|autonoleggio|rent a car|car rental|hertz|europcar|sixt|sewa mobil|sewa motor|traghetto|ferry|flixbus', { weak: 'italo|avis|grab|gojek' }],
  [TRIPS, TRIPS_ACTIVITIES, 'tour|guided tour|visita guidata|escursione|escursioni|day trip|gita|biglietto ingresso|biglietto d ingresso|entrance ticket|entry ticket|tiket masuk|snorkeling|diving|safari|getyourguide|tiqets|klook'],

  // ── Personal Care ───────────────────────────────────────────────
  [N.personalCare, N.hairdresser, 'hairdresser|parrucchiere|parrucchiera|barbiere|barber|haircut|taglio capelli|colore capelli|estetista|beautician|manicure|pedicure|nail salon|massage|massaggio|potong rambut', { weak: 'piega|salon' }],
  [N.personalCare, N.beautyPerfume, 'profumeria|sephora|cosmetici|cosmetics|acqua e sapone|tigota', { weak: 'douglas|kiko' }],

  // ── Subscription ────────────────────────────────────────────────
  [SUBSCRIPTION, N.streaming, 'netflix|disney plus|prime video|amazon prime|spotify|apple music|youtube premium|dazn|now tv|paramount plus|apple tv|crunchyroll|vidio|iqiyi|wetv|tidal|deezer|audible', { weak: 'sky|disney|viu' }],
  [SUBSCRIPTION, N.softwareApps, 'microsoft 365|microsoft office|adobe|canva|chatgpt|claude pro|notion|duolingo|nordvpn|vpn|1password|app store|apple one|software'],
  [SUBSCRIPTION, CLOUD_STORAGE, 'icloud|google one|google drive|dropbox|onedrive'],
  [SUBSCRIPTION, MEMBERSHIPS, 'gym|palestra|abbonamento palestra|membership|quota associativa|tessera'],

  // ── Entertainment ───────────────────────────────────────────────
  [ENTERTAINMENT, N.cinemaEvents, 'cinema|movie|biglietto cinema|the space|uci cinemas|concert|concerto|spettacolo|teatro|theatre|museo|museum|mostra|exhibition|festival|ticketone|vivaticket|ticketmaster|stadio|bioskop|konser', { weak: 'film|show' }],

  // ── Health ──────────────────────────────────────────────────────
  [HEALTH, N.pharmacy, 'farmacia|pharmacy|parafarmacia|apotek|ticket farmacia'],
  [HEALTH, N.doctorTests, 'doctor|medico|visita medica|specialist|specialista|analisi|esami del sangue|blood test|ecografia|ultrasound|radiografia|ticket sanitario|ospedale|hospital|poliambulatorio|dokter|rumah sakit|laboratorio analisi|fisioterapia|physiotherapy|ginecologo|dermatologo|oculista', { weak: 'visita' }],
  [HEALTH, N.dentist, 'dentista|dentist|igiene dentale|pulizia denti|dental cleaning|otturazione|ortodonzia|dokter gigi'],
  [HEALTH, N.glassesLenses, 'occhiali|lenti a contatto|contact lenses|ottico|optician|salmoiraghi|grandvision|lensa kontak|kacamata', { weak: 'lenti|glasses' }],

  // ── Pets ────────────────────────────────────────────────────────
  [PETS, N.veterinary, 'veterinario|veterinary|clinica veterinaria|visita veterinaria|vaccino gatto|sterilizzazione gatto|microchip|dokter hewan', { weak: 'vet' }],
  [PETS, N.petSitting, 'pet sitter|cat sitter|pensione per gatti|pensione gatti|pet hotel|penitipan kucing'],

  // ── Family Support (main, no sub) ───────────────────────────────
  // Money sent to family. The transfer fee is part of the same amount
  // (€200 + €3.99 = €203.99), so it books here too, not in Bank & Fee.
  // Before Bank & Fee, so "money transfer fee" offers Family Support first.
  [N.familySupport, null, 'remitly|western union|money transfer|moneygram|kirim uang|transfer keluarga|invio denaro', { weak: 'wise' }],

  // ── Bank & Fee ──────────────────────────────────────────────────
  [BANK, null, 'bank fee|commissione|commissioni|canone conto|bonifico|transfer fee|card fee|costo carta|interessi|spese bancarie|biaya admin|biaya transfer', { weak: 'fee' }],
  [BANK, N.taxesFines, 'tax|tasse|imposta|f24|irpef|commercialista|marca da bollo|multa|multe|sanzione|pajak|denda|agenzia delle entrate', { weak: 'caf' }],
  [BANK, N.documentsPermits, 'permesso di soggiorno|kit permesso|passport|passaporto|carta d identita|codice fiscale|ambasciata|embassy|consolato|kbri|paspor|traduzione giurata|apostille|legalizzazione'],

  // ── Cigarettes & Vape ───────────────────────────────────────────
  [CIGARETTES, null, 'sigarette|cigarettes|tabacco|tobacco|iqos|heets|terea|svapo|liquido svapo|e liquid|vape|vape liquid|marlboro|camel|chesterfield|rokok|tabaccheria'],

  // ── Going out ───────────────────────────────────────────────────
  [GOING_OUT, RESTAURANT, 'ristorante|restaurant|pizzeria|trattoria|osteria|sushi restaurant|all you can eat|rumah makan'],
  [GOING_OUT, BAR, 'caffe al bar|cappuccino|cornetto al bar|colazione al bar|pasticceria', { weak: 'bar' }],
  [GOING_OUT, APERITIVO, 'aperitivo|spritz|apericena'],
  [GOING_OUT, TAKEAWAY, 'deliveroo|glovo|just eat|justeat|uber eats|takeaway|asporto|kebab|grabfood|grab food|gofood|go food|shopeefood'],

  // ── Housing & Utilities ─────────────────────────────────────────
  // "rent" and "sewa" are weak: "Rent a car" and "Sewa mobil" are trips.
  [HOUSING, RENT, 'affitto|canone affitto|sewa rumah|rent payment|house rent', { weak: 'rent|sewa' }],
  // "luce" is weak: "Lampadina luce LED" is a light bulb, not the bill.
  [HOUSING, ELECTRICITY, 'electricity|bolletta luce|energia elettrica|bolletta elettrica|enel|hera luce|listrik|token listrik', { weak: 'luce' }],
  [HOUSING, GAS, 'bolletta gas|gas bill|hera gas'],
  [HOUSING, WATER, 'bolletta acqua|water bill|servizio idrico'],
  [HOUSING, WASTE, 'tari|rifiuti|waste'],
  [HOUSING, INTERNET, 'internet|fibra|wifi|fastweb|vodafone|iliad|windtre|ho mobile|very mobile|kena mobile|ricarica|phone plan|pulsa', { weak: 'tim' }],

  // ── Shopping ────────────────────────────────────────────────────
  [SHOPPING, CLOTHING, 'clothes|vestiti|maglia|maglietta|pantaloni|jeans|giacca|cappotto|zara|ovs|uniqlo|primark|shein|bershka|pull bear|baju', { weak: 'h m' }],
  [SHOPPING, SHOES, 'shoes|scarpe|sneakers|stivali|borsa|zaino|cintura|orologio|sepatu', { weak: 'tas' }],
  [SHOPPING, ELECTRONICS, 'mediaworld|unieuro|euronics|apple store|cuffie|charger|caricatore'],
  [SHOPPING, GIFTS, 'gift|regalo|regali|kado|hadiah'],
]
