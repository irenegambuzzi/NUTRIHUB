// A fixed, distinct color for every expense category. Colors are stored
// per category (supabase/016); until that table exists or a category has
// no row yet, the same colors are worked out here in the same way, so
// what you see never changes when it is saved.

const SURFACE = '#1C1E23' // --color-surface: what text and fills sit on

// Hand-picked for the dark theme, spread around the color wheel and kept
// apart in lightness too. Used in this order while they stay clearly
// different from what's taken.
const CURATED = [
  '#F97316', // orange
  '#3B82F6', // blue
  '#22C55E', // green
  '#EC4899', // pink
  '#FACC15', // yellow
  '#8B5CF6', // violet
  '#14B8A6', // teal
  '#EF4444', // red
  '#A3E635', // lime
  '#D946EF', // fuchsia
  '#B8793F', // brown
  '#06B6D4', // cyan
]

// For "Uncategorized": never given to a real category.
export const UNCATEGORIZED_COLOR = '#9CA3AF'

// Below this distance (CIE Lab, ΔE) two colors start to look alike.
const MIN_DISTANCE = 28
const MIN_CONTRAST = 3 // against the dark surface, for fills and dots

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const toHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase()
const linear = (c) => {
  c /= 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(linear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function lab(hex) {
  const [r, g, b] = hexToRgb(hex).map(linear)
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

export function colorDistance(a, b) {
  const [la, lb] = [lab(a), lab(b)]
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2])
}

const nearest = (hex, used) => Math.min(...used.map((u) => colorDistance(hex, u)))

function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l)
  const f = (n) => {
    const k = (n + h / 30) % 12
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return toHex([f(0) * 255, f(8) * 255, f(4) * 255])
}

// Every hue at a few saturation/lightness levels that read well on the
// dark surface; used once the hand-picked colors run out.
const POOL = []
for (const [s, l] of [[0.8, 0.6], [0.65, 0.72], [0.9, 0.5], [0.45, 0.58]]) {
  for (let h = 0; h < 360; h += 6) {
    const hex = hslToHex(h, s, l)
    if (contrast(hex, SURFACE) >= MIN_CONTRAST) POOL.push(hex)
  }
}

// The next color: the first hand-picked one clearly different from all
// `used`, else whichever available color is farthest from all of them.
export function pickColor(used = []) {
  const taken = [...used, UNCATEGORIZED_COLOR].map((c) => c.toUpperCase())
  const free = CURATED.find((c) => !taken.includes(c) && nearest(c, taken) >= MIN_DISTANCE)
  if (free) return free
  let best = null
  let bestDistance = -1
  for (const c of [...CURATED, ...POOL]) {
    const d = nearest(c, taken)
    if (d > bestDistance) {
      best = c
      bestDistance = d
    }
  }
  return best
}

// { id → '#RRGGBB' } for every category. `stored` is the saved rows
// ({ category_id, color }). Categories without one are given colors
// oldest first, so every phone works out the same ones.
// With `subsFollowMain`, a sub-category has no color of its own: it shows
// its main category's (for expenses). No color is worked out or saved for
// it, and any color saved for it earlier is simply not used.
export function assignCategoryColors(categories, stored = [], { subsFollowMain = false } = {}) {
  const mainIds = new Set(categories.filter((c) => !c.parent_id).map((c) => c.id))
  const followers = subsFollowMain ? categories.filter((c) => c.parent_id && mainIds.has(c.parent_id)) : []
  const own = followers.length ? categories.filter((c) => !followers.includes(c)) : categories
  const known = new Set(own.map((c) => c.id))
  const colors = new Map()
  for (const row of stored) if (known.has(row.category_id) && /^#[0-9A-F]{6}$/i.test(row.color ?? '')) colors.set(row.category_id, row.color.toUpperCase())
  const used = [...colors.values()]
  const missing = own
    .filter((c) => !colors.has(c.id))
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || a.id.localeCompare(b.id))
  const fresh = []
  for (const c of missing) {
    const color = pickColor(used)
    used.push(color)
    colors.set(c.id, color)
    fresh.push({ category_id: c.id, color })
  }
  for (const c of followers) colors.set(c.id, colors.get(c.parent_id))
  return { colors, fresh }
}

const mix = (hex, toward, amount) => toHex(hexToRgb(hex).map((v, i) => v + (toward[i] - v) * amount))

// The color for text and icons on the dark surface (or a tint of this
// color on it): the category color lightened until it reads clearly.
export function readableOnDark(hex, background = SURFACE) {
  let out = hex
  for (let amount = 0; amount <= 1 && contrast(out, background) < 4.5; amount += 0.05) out = mix(hex, [255, 255, 255], amount)
  return out
}

// Everything a component needs to draw one category.
export function categoryStyle(hex) {
  return { hex, text: readableOnDark(hex, mix(SURFACE, hexToRgb(hex), 0.18)), tint: `${hex}26`, border: `${hex}4D` }
}
