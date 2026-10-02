import { LEGACY_UNITS } from '../data/constants'

const METRIC_FACTORS = { gr: ['kg', 1000], ml: ['L', 1000] }

export const METRIC_PARTNER = { gr: 'kg', kg: 'gr', ml: 'L', L: 'ml' }

export function normalizeUnit(unit) {
  return LEGACY_UNITS[unit] ?? unit
}

// Factor to turn a quantity in `from` into `to`, or null when the two
// units can't be converted safely (e.g. pack → pcs without a pack size).
export function unitFactor(from, to) {
  if (from === to) return 1
  for (const [small, [big, factor]] of Object.entries(METRIC_FACTORS)) {
    if (from === big && to === small) return factor
    if (from === small && to === big) return 1 / factor
  }
  return null
}

// Like unitFactor, but also knows a multipack's size
// (pack = { unit, packaging_unit, quantity_per_pack }).
export function convertQuantity(qty, from, to, pack) {
  const n = Number(qty) || 0
  const factor = unitFactor(from, to)
  if (factor !== null) return n * factor
  const perPack = Number(pack?.quantity_per_pack)
  if (pack?.packaging_unit && perPack > 0) {
    const toBase = from === pack.packaging_unit ? perPack : unitFactor(from, pack.unit)
    const fromBase = to === pack.packaging_unit ? 1 / perPack : unitFactor(pack.unit, to)
    if (toBase != null && fromBase != null) return n * toBase * fromBase
  }
  return null
}
