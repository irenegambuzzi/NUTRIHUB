import { supabase } from './supabaseClient'
import { stockStatus } from './inventory'

const CSV_COLUMNS = [
  'id',
  'name',
  'category',
  'subcategory',
  'unit',
  'packaging_unit',
  'quantity_per_pack',
  'current_stock',
  'min_stock',
  'status',
  'expiry_date',
  'batch_lot',
  'notes',
  'created_at',
  'updated_at',
]

const NUMERIC_FIELDS = ['quantity_per_pack', 'current_stock', 'min_stock']

function csvCell(value) {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function itemsToCsv(items, categoryName) {
  const rows = items.map((item) => ({
    ...item,
    category: item.category_id ? categoryName(item.category_id) : '',
    subcategory: item.subcategory_id ? categoryName(item.subcategory_id) : '',
    status: stockStatus(item),
  }))
  const lines = [CSV_COLUMNS.join(','), ...rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(','))]
  // Leading BOM so Excel opens it as UTF-8.
  return '\uFEFF' + lines.join('\r\n')
}

export function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  const src = text.replace(/^\uFEFF/, '')
  // Excel in many European locales saves CSV with semicolons.
  const firstLine = src.split(/\r?\n/, 1)[0]
  const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ','
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim()))
  if (!header) return []
  const keys = header.map((h) => h.trim().toLowerCase())
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])))
}

// Turns parsed CSV rows into item fields, resolving category names
// (or ids) against the known categories.
export function csvRowsToItems(rows, categories) {
  const find = (value, type, parentId) => {
    if (!value) return null
    const v = value.toLowerCase()
    return (
      categories.find(
        (c) => c.type === type && (!parentId || c.parent_id === parentId) && (c.id === value || c.name.toLowerCase() === v)
      )?.id ?? null
    )
  }
  return rows
    .filter((r) => r.name)
    .map((r) => {
      const categoryId = find(r.category_id || r.category, 'parent')
      const item = {
        id: r.id || undefined,
        name: r.name,
        category_id: categoryId,
        subcategory_id: find(r.subcategory_id || r.subcategory, 'sub', categoryId),
        unit: r.unit || 'pc',
        packaging_unit: r.packaging_unit || null,
        expiry_date: r.expiry_date || null,
        batch_lot: r.batch_lot || null,
        notes: r.notes || null,
      }
      for (const f of NUMERIC_FIELDS) {
        const n = parseFloat(r[f])
        item[f] = Number.isFinite(n) ? n : f === 'quantity_per_pack' ? null : 0
      }
      return item
    })
}

export async function buildBackup() {
  const [{ data: categories }, { data: items }, { data: logs }] = await Promise.all([
    supabase.from('inventory_categories').select('*'),
    supabase.from('pantry_items').select('*'),
    supabase.from('stock_logs').select('*'),
  ])
  return {
    app: 'nutrihub-inventory',
    version: 1,
    exported_at: new Date().toISOString(),
    categories: categories || [],
    items: items || [],
    stock_logs: logs || [],
  }
}

// Categories and logs are restored here; items go through the pantry
// hook so the shopping list is re-synced afterwards.
export async function restoreCategories(backup) {
  if (backup.categories?.length) {
    // Parents first so sub-categories' parent_id references exist.
    const sorted = [...backup.categories].sort((a, b) => (a.type === 'parent' ? -1 : 1) - (b.type === 'parent' ? -1 : 1))
    const { error } = await supabase.from('inventory_categories').upsert(sorted)
    if (error) return { error }
  }
  return { error: null }
}

export async function restoreLogs(backup) {
  if (!backup.stock_logs?.length) return { error: null }
  return supabase.from('stock_logs').upsert(backup.stock_logs)
}

export function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
