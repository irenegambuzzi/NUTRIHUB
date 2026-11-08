import { supabase } from './supabaseClient'
import { must } from './db'
import { isDurable, normalizeUnit, stockStatus } from './inventory'
import { hasName, mergedNames, nameTakenBy } from './itemNames'
import { exactKey } from './similarItems'

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
  'price',
  'payer',
  'last_purchased_at',
  'category_id',
  'subcategory_id',
  'created_at',
  'updated_at',
]

const NUMERIC_FIELDS = ['quantity_per_pack', 'current_stock', 'min_stock', 'price']

// Every pantry_items field plus readable category names and status.
function exportRows(items, categoryName) {
  return items.map((item) => {
    const row = {
      ...item,
      category: item.category_id ? categoryName(item.category_id) : '',
      subcategory: item.subcategory_id ? categoryName(item.subcategory_id) : '',
      status: stockStatus(item),
    }
    return Object.fromEntries(CSV_COLUMNS.map((c) => [c, row[c] ?? '']))
  })
}

function csvCell(value) {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function itemsToCsv(items, categoryName) {
  const rows = exportRows(items, categoryName)
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
        unit: normalizeUnit(r.unit || 'pcs'),
        packaging_unit: r.packaging_unit || null,
        expiry_date: r.expiry_date || null,
        batch_lot: r.batch_lot || null,
        notes: r.notes || null,
        payer: r.payer || null,
      }
      for (const f of NUMERIC_FIELDS) {
        const n = parseFloat(String(r[f] ?? '').replace(',', '.'))
        item[f] = Number.isFinite(n) ? n : ['quantity_per_pack', 'price'].includes(f) ? null : 0
      }
      return item
    })
}

// An imported file may hold durables (a towel, a laptop): HOME stock is
// only for consumables (plan 9F), so rows whose category is in the
// Durables tree are left out. → { items, skipped } (how many were left
// out). A backup restore never goes through this: it is exact.
export function withoutDurables(items) {
  const kept = items.filter((item) => !isDurable(item))
  return { items: kept, skipped: items.length - kept.length }
}

// SheetJS is loaded only when an Excel file is actually exported or
// imported, so it doesn't weigh down the app's first load.
export async function itemsToXlsx(items, categoryName) {
  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.json_to_sheet(exportRows(items, categoryName), { header: CSV_COLUMNS })
  sheet['!cols'] = CSV_COLUMNS.map((c) => ({ wch: ['name', 'notes', 'category', 'subcategory'].includes(c) ? 28 : 14 }))
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Inventory')
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' })
}

// Rows from the first sheet, keyed by lower-cased header, like parseCsv.
export async function parseXlsx(arrayBuffer) {
  const XLSX = await import('xlsx')
  const book = XLSX.read(arrayBuffer, { type: 'array', cellDates: true })
  const sheet = book.Sheets[book.SheetNames[0]]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false, dateNF: 'yyyy-mm-dd' }).map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), String(v).trim()]))
  )
}

// Throws if any table couldn't be read, so a failed read never becomes
// an empty backup.
export async function buildBackup() {
  const [categories, items, logs] = await Promise.all([
    supabase.from('inventory_categories').select('*'),
    supabase.from('pantry_items').select('*'),
    supabase.from('stock_logs').select('*'),
  ])
  return {
    app: 'nutrihub-inventory',
    version: 1,
    exported_at: new Date().toISOString(),
    categories: must(categories),
    items: must(items),
    stock_logs: must(logs),
  }
}

// Categories and logs are restored here; items go through the pantry
// hook so the shopping list is re-synced afterwards. Both throw on failure.
export async function restoreCategories(backup) {
  if (!backup.categories?.length) return
  // Parents first so sub-categories' parent_id references exist.
  const sorted = [...backup.categories].sort((a, b) => (a.type === 'parent' ? -1 : 1) - (b.type === 'parent' ? -1 : 1))
  must(await supabase.from('inventory_categories').upsert(sorted))
}

export async function restoreLogs(backup) {
  if (!backup.stock_logs?.length) return
  must(await supabase.from('stock_logs').upsert(backup.stock_logs))
}

// The items as they are now, with their names (plan 9N K117), read before
// a restore writes anything.
export async function readCurrentItems() {
  return must(await supabase.from('pantry_items').select('*'))
}

// The fields of an item that describe its stock now: an item holding
// merged names keeps them (K117, K125, K128).
const STOCK_FIELDS = ['current_stock', 'unit', 'expiry_date', 'batch_lot', 'last_purchased_at']

// The fields of an item counted in its unit: kept as they are when a
// file counted it in another unit (K118, K124).
const UNIT_FIELDS = ['min_stock', 'packaging_unit', 'quantity_per_pack', 'price', 'price_qty', 'price_unit']

// K117–K128: which rows of a file (a backup's items, or an imported CSV /
// Excel) still apply now that items may have been merged. `current`: the
// items now. A row of an item merged away since (its id is the
// from_item_id of a name) is skipped; with `importing` (the CSV / Excel
// import, which adds rows without an id as new items) so is a row that
// would make a new item named like a merged name (one with an origin). A
// row of an item holding merged names (a target) keeps that item's stock,
// unit, expiry, batch, names and no group (and, in another unit, every
// field counted in it); the rest comes from the file. An imported row only
// has the file's columns, and only those are replaced, so every row still
// writes the same columns (its group, never in the file, stays as it is).
// A row keeps its group only when that group is still a group afterwards
// (K120). A row of an item now whose name in the file is a name of another
// item now (and none of its own) keeps the item's current name (K126).
// `names` is never written (pickFields).
// → { items (to write), skipped (file rows), kept (targets now),
//     keptName (items now that kept their name), holder }
function guardRows(rows, current, { importing = false } = {}) {
  const holder = new Map()
  for (const item of current ?? []) for (const element of mergedNames(item)) if (element.from_item_id) holder.set(element.from_item_id, item)
  const now = new Map((current ?? []).map((item) => [item.id, item]))
  const isTarget = (id) => mergedNames(now.get(id)).length > 0
  const mergedKeys = new Set()
  if (importing) for (const item of current ?? []) for (const element of mergedNames(item)) if (element.origin != null) mergedKeys.add(exactKey(element.name))
  const skippedRow = (row) => {
    if (holder.has(row.id)) return true
    const key = importing && !now.has(row.id) && exactKey(row.name)
    return Boolean(key) && mergedKeys.has(key)
  }
  // A group after the restore / import (K120): a group now, or a group row
  // of the file, that is neither skipped nor a target.
  const groups = new Set(
    [...(current ?? []), ...rows]
      .filter((item) => item.is_group && item.id && !skippedRow(item) && !isTarget(item.id))
      .map((item) => item.id)
  )
  const skipped = []
  const kept = []
  const keptName = []
  const items = []
  for (const file of rows) {
    if (skippedRow(file)) {
      skipped.push(file)
      continue
    }
    const self = now.get(file.id)
    const nameTaken = Boolean(self) && !hasName(self, file.name) && Boolean(nameTakenBy(file.name, current, [self.id]))
    if (nameTaken) keptName.push(self)
    const row = nameTaken ? { ...file, name: self.name } : file
    if (!isTarget(row.id)) {
      items.push(row.group_id && !groups.has(row.group_id) ? { ...row, group_id: null } : row)
      continue
    }
    kept.push(self)
    const keep = [...STOCK_FIELDS, ...(row.unit === self.unit ? [] : UNIT_FIELDS)].filter((field) => !importing || field in row)
    const written = { ...row, ...Object.fromEntries(keep.map((field) => [field, self[field] ?? null])) }
    items.push(importing ? written : { ...written, is_group: false, group_id: null })
  }
  return { items, skipped, kept, keptName, holder }
}

// K117 + K118: what a backup restores; the history of a skipped item goes
// to the item that holds its name.
// → { backup (items and history to restore), skipped, kept, keptName (items now) }
export function restorePlan(backup, current) {
  const { items, skipped, kept, keptName, holder } = guardRows(backup.items ?? [], current)
  const logs = backup.stock_logs?.map((log) => (holder.has(log.item_id) ? { ...log, item_id: holder.get(log.item_id).id } : log))
  return { backup: { ...backup, items, ...(logs ? { stock_logs: logs } : {}) }, skipped, kept, keptName }
}

// K119: what "Import CSV / Excel" writes (`rows` from csvRowsToItems).
// → { items, skipped, kept, keptName (items now) }
export function importPlan(rows, current) {
  const { items, skipped, kept, keptName } = guardRows(rows, current, { importing: true })
  return { items, skipped, kept, keptName }
}

const itemsWord = (n) => `${n} item${n === 1 ? '' : 's'}`

// `{k} items kept their merged names and stock: {names}.`, '' without any.
function keptText(kept) {
  if (!kept.length) return ''
  const names = kept.map((item) => item.name).join(', ')
  return kept.length === 1 ? `1 item kept its merged names and stock: ${names}.` : `${itemsWord(kept.length)} kept their merged names and stock: ${names}.`
}

// `{j} items kept their current name: …` (K126), '' without any.
const keptNameText = (j) =>
  !j
    ? ''
    : j === 1
      ? '1 item kept its current name: the name in the file belongs to another item.'
      : `${j} items kept their current name: the names in the file belong to other items.`

// The extra line of "Restore {n} items?" (K117), '' without skips.
export const skippedQuestionLine = (m) =>
  !m
    ? ''
    : m === 1
      ? '1 of these items was merged into another item since this backup — it is skipped, and its history goes to that item.'
      : `${m} of these items were merged into another item since this backup — they are skipped, and their history goes to that item.`

// What "Restore backup" says when it is done (K117, K126).
export function restoredText({ backup, skipped, kept, keptName = [] }) {
  const n = backup.items.length
  const parts = [
    skipped.length ? `Restored ${n} items. ${skipped.length} skipped: merged into another item.` : `Restored ${n} items.`,
    keptText(kept),
    keptNameText(keptName.length),
  ]
  return parts.filter(Boolean).join(' ')
}

// The extra line of "Import {n} items?" (K119), '' without skips.
export const skippedImportLine = (m) =>
  !m
    ? ''
    : m === 1
      ? '1 of these items was merged into another item since this file was made — it is skipped.'
      : `${m} of these items were merged into another item since this file was made — they are skipped.`

// What "Import CSV / Excel" says when it is done (K119): today's text
// (`durableNote` included) with the imported rows counted, then the
// skipped, the kept and the names kept (K126).
export function importedText({ items, skipped, kept, keptName = [] }, durableNote = '') {
  return [
    `Imported ${itemsWord(items.length)}.${durableNote}`,
    skipped.length ? `${skipped.length} skipped: merged into another item.` : '',
    keptText(kept),
    keptNameText(keptName.length),
  ]
    .filter(Boolean)
    .join(' ')
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
