// Test data only (not used by the app): the MONEY categories as they are
// live, from the Supabase export of 21/10/2026 (tmp-export/2_money.csv, not
// in git; "Holiday" already renamed "Trips & Holidays" by hand), and the
// ones supabase/024_categories.sql adds with its fixed ids.
import { NEW_MONEY_CATEGORY_IDS as N } from './budgetKeywords'

const row = ([id, name, parent_id]) => ({ id, name, parent_id })

// [id, name, parent_id]
export const LIVE_MONEY_CATEGORIES = [
  ['744f7d8e-c90d-49d3-ad03-72c6e81aad9d', 'Entertainment', null],
  ['61f92237-3392-4f71-aca8-4dbb1df9b256', 'Groceries', null],
  ['676901e2-4693-47cb-93e4-b071a8eac8f3', 'Going out', null],
  ['6d9d08f2-c8a7-4f40-bf88-9e5de1b44449', 'Other', null],
  ['75310604-5b9b-431c-9837-b2065747409f', 'Cigarettes & Vape', null],
  ['88ea2c65-397a-4774-b4de-22886f397cf5', 'Housing & Utilities', null],
  ['7b689322-058b-489a-a224-bd12db8b8cf5', 'Rent', '88ea2c65-397a-4774-b4de-22886f397cf5'],
  ['e415ac53-3653-4dfe-8aa5-a6643fb40d95', 'Apartment Maintenance', '88ea2c65-397a-4774-b4de-22886f397cf5'],
  ['fe8d77d6-a366-4017-b3c5-779c3f56ec63', 'Electricity', '88ea2c65-397a-4774-b4de-22886f397cf5'],
  ['2a337052-a953-422a-9fd4-ecdc208a76b4', 'Gas', '88ea2c65-397a-4774-b4de-22886f397cf5'],
  ['1ae97eac-85af-409c-9832-7d6880b64cfa', 'Water', '88ea2c65-397a-4774-b4de-22886f397cf5'],
  ['517a69ad-bb5c-4f24-93fd-5f71eb008062', 'Waste Collection', '88ea2c65-397a-4774-b4de-22886f397cf5'],
  ['2abfd336-3daa-4722-8280-4ccd9a572f42', 'Internet & Phone', '88ea2c65-397a-4774-b4de-22886f397cf5'],
  ['199ec782-505a-4292-984e-08ae1d76469f', 'Home & Appliances', null],
  ['4125ed9e-da65-4b76-8e35-cb1239d8093b', 'Kitchen Appliances', '199ec782-505a-4292-984e-08ae1d76469f'],
  ['a364fa44-7513-47ca-aabc-7c5254c0a961', 'Kitchenware & Utensils', '199ec782-505a-4292-984e-08ae1d76469f'],
  ['83c6b924-e7cd-4ba6-881d-a1ff1e6385d1', 'Cleaning Appliances', '199ec782-505a-4292-984e-08ae1d76469f'],
  ['7d226f51-f809-494d-92c0-50d9c12f7812', 'Air & Climate', '199ec782-505a-4292-984e-08ae1d76469f'],
  ['2a05cb39-e90c-4349-9f77-4b1e679d42b4', 'Electronics & Work Equipment', '199ec782-505a-4292-984e-08ae1d76469f'],
  ['8b2d4f49-af1d-41af-bd19-9050a7689164', 'Car / Vehicle', null],
  ['688bfedf-8e4c-4b59-860f-3a55c33f50d1', 'Subscription', null],
  ['edad180d-c221-4c2a-acc8-9c88cccb7e1e', 'Cloud Storage', '688bfedf-8e4c-4b59-860f-3a55c33f50d1'],
  ['f75f30c9-c111-4a54-be05-e227999e42ef', 'Memberships', '688bfedf-8e4c-4b59-860f-3a55c33f50d1'],
  ['b498cc5d-95ea-4666-89f2-11973222ec2c', 'Bank & Fee', null],
  ['654a80a3-2e6f-4ada-b214-0486d91d869c', 'Shopping', null],
  ['7d2a77f8-a5ff-4846-9021-143757927bb2', 'Savings & Investments', null],
  ['bca88a40-0ef4-45f9-95ee-2ad9ba4bf374', 'Pension Fund', '7d2a77f8-a5ff-4846-9021-143757927bb2'],
  ['6de9c666-afbd-4eab-b487-0520728df8d7', 'Emergency Fund', '7d2a77f8-a5ff-4846-9021-143757927bb2'],
  ['06729df9-06b2-4465-955b-17d03f3fe125', 'Health', null],
  ['85f20924-a159-4db9-bab5-0cbc4ea42863', 'Restaurant', '676901e2-4693-47cb-93e4-b071a8eac8f3'],
  ['21faa851-8ee3-4f60-818f-fc3ef4113aa5', 'Bar & Coffee', '676901e2-4693-47cb-93e4-b071a8eac8f3'],
  ['7454f9c2-0284-4583-a45d-a2dcdb3397a9', 'Takeaway & Delivery', '676901e2-4693-47cb-93e4-b071a8eac8f3'],
  ['5d4cc03f-a148-43b1-b2eb-2186012a20c9', 'Transport', 'dc79f604-19fd-4bdd-817e-335816c4afe7'],
  ['72cb10f3-3fbd-4bb1-b0f8-81c5cc357077', 'Accommodation', 'dc79f604-19fd-4bdd-817e-335816c4afe7'],
  ['2b571b2a-1676-4c23-ae1c-46ec11613359', 'Food & Drinks', 'dc79f604-19fd-4bdd-817e-335816c4afe7'],
  ['df3c1786-b4e8-40b8-b55a-b74f8816e7c2', 'Activities', 'dc79f604-19fd-4bdd-817e-335816c4afe7'],
  ['732af8e0-924c-471c-b0e8-ac9286ce074e', 'Clothing', '654a80a3-2e6f-4ada-b214-0486d91d869c'],
  ['0f7f387b-0c4a-4095-8865-59cfac4c586a', 'Shoes & Accessories', '654a80a3-2e6f-4ada-b214-0486d91d869c'],
  ['1697124e-22a7-4417-b5b9-0439ccc67e17', 'Electronics', '654a80a3-2e6f-4ada-b214-0486d91d869c'],
  ['3cdeb3d8-6603-4ac8-a56b-73fd3690fd1c', 'Gifts', '654a80a3-2e6f-4ada-b214-0486d91d869c'],
  ['ec02bde8-9498-4e4c-83bb-ffb15fe90ac5', 'Others', '654a80a3-2e6f-4ada-b214-0486d91d869c'],
  ['ecd9a924-7f46-4991-83ce-02825c73ce42', 'Pets', null],
  ['d09b12af-5dba-44a5-915c-7e2b88793868', 'Aperitivo', '676901e2-4693-47cb-93e4-b071a8eac8f3'],
  ['dc79f604-19fd-4bdd-817e-335816c4afe7', 'Trips & Holidays', null],
].map(row)

const TRIPS = 'dc79f604-19fd-4bdd-817e-335816c4afe7'
const SUBSCRIPTION = '688bfedf-8e4c-4b59-860f-3a55c33f50d1'
const ENTERTAINMENT = '744f7d8e-c90d-49d3-ad03-72c6e81aad9d'
const CAR = '8b2d4f49-af1d-41af-bd19-9050a7689164'
const HEALTH = '06729df9-06b2-4465-955b-17d03f3fe125'
const PETS = 'ecd9a924-7f46-4991-83ce-02825c73ce42'
const BANK = 'b498cc5d-95ea-4666-89f2-11973222ec2c'

// What 024 adds, in its order.
export const MONEY_CATEGORIES_024 = [
  [N.personalCare, 'Personal Care', null],
  [N.familySupport, 'Family Support', null],
  [N.flights, 'Flights', TRIPS],
  [N.souvenirs, 'Souvenirs', TRIPS],
  [N.insuranceVisas, 'Insurance & Visas', TRIPS],
  [N.beautyPerfume, 'Beauty & Perfume', N.personalCare],
  [N.toiletries, 'Toiletries', N.personalCare],
  [N.hairdresser, 'Hairdresser', N.personalCare],
  [N.streaming, 'Streaming', SUBSCRIPTION],
  [N.softwareApps, 'Software & Apps', SUBSCRIPTION],
  [N.cinemaEvents, 'Cinema & Events', ENTERTAINMENT],
  [N.fuel, 'Fuel', CAR],
  [N.maintenance, 'Maintenance', CAR],
  [N.insuranceTax, 'Insurance & Tax', CAR],
  [N.parkingTolls, 'Parking & Tolls', CAR],
  [N.pharmacy, 'Pharmacy', HEALTH],
  [N.doctorTests, 'Doctor & Tests', HEALTH],
  [N.dentist, 'Dentist', HEALTH],
  [N.glassesLenses, 'Glasses & Lenses', HEALTH],
  [N.veterinary, 'Veterinary', PETS],
  [N.petSitting, 'Pet Sitting', PETS],
  [N.taxesFines, 'Taxes & Fines', BANK],
  [N.documentsPermits, 'Documents & Permits', BANK],
].map(row)
