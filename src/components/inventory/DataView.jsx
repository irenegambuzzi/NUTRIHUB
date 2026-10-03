import { useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { localDateString } from '../../lib/expensePeriods'
import { attempt } from '../../lib/db'
import { confirmDialog, toastLoadError } from '../../lib/feedback'
import {
  buildBackup,
  csvRowsToItems,
  downloadFile,
  itemsToCsv,
  itemsToXlsx,
  parseCsv,
  parseXlsx,
  restoreCategories,
  restoreLogs,
} from '../../lib/inventoryBackup'

// Export (CSV, Excel, JSON backup) and import/restore.
export function DataView({ items, categories, categoryName, importItems }) {
  const csvInput = useRef(null)
  const jsonInput = useRef(null)
  const [message, setMessage] = useState('')
  const today = localDateString()

  const exportCsv = () => {
    downloadFile(`nutrihub-inventory-${today}.csv`, itemsToCsv(items, categoryName), 'text/csv;charset=utf-8')
  }

  const exportExcel = async () => {
    const data = await itemsToXlsx(items, categoryName)
    downloadFile(`nutrihub-export-${today}.xlsx`, data, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  }

  const exportJson = async () => {
    let backup
    try {
      backup = await buildBackup()
    } catch (error) {
      return toastLoadError(error, exportJson, 'backup')
    }
    downloadFile(`nutrihub-backup-${today}.json`, JSON.stringify(backup, null, 2), 'application/json')
  }

  const handleCsv = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const isExcel = /\.xlsx?$/i.test(file.name)
    let parsed
    try {
      parsed = isExcel ? await parseXlsx(await file.arrayBuffer()) : parseCsv(await file.text())
    } catch {
      return setMessage('Could not read that file.')
    }
    const rows = csvRowsToItems(parsed, categories)
    if (rows.length === 0) return setMessage('No items found in that file. The first row must be a header with at least a "name" column.')
    const confirmed = await confirmDialog({
      title: `Import ${rows.length} item${rows.length === 1 ? '' : 's'}?`,
      message: 'Rows with an existing id overwrite that item; the others are added as new items.',
      confirmLabel: 'Import',
    })
    if (!confirmed) return
    const { error } = await importItems(rows)
    // A failure shows a toast.
    setMessage(error ? '' : `Imported ${rows.length} item${rows.length === 1 ? '' : 's'}.`)
  }

  const handleJson = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    let backup
    try {
      backup = JSON.parse(await file.text())
    } catch {
      return setMessage('That file is not valid JSON.')
    }
    if (backup.app !== 'nutrihub-inventory' || !Array.isArray(backup.items)) {
      return setMessage('That file is not a NutriHub inventory backup.')
    }
    const confirmed = await confirmDialog({
      title: `Restore ${backup.items.length} items?`,
      message: `From the backup of ${backup.exported_at ? localDateString(new Date(backup.exported_at)) : 'an unknown date'}. Items in the backup overwrite current ones with the same id; other items are kept.`,
      confirmLabel: 'Restore',
    })
    if (!confirmed) return
    setMessage('')
    // Each step shows a toast if it fails; the restore stops there.
    if ((await attempt(() => restoreCategories(backup), { retry: false })).error) return
    if ((await importItems(backup.items)).error) return
    if ((await attempt(() => restoreLogs(backup), { retry: false })).error) return
    setMessage(`Restored ${backup.items.length} items.`)
  }

  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <p className="text-xs font-bold text-[var(--color-primary)] uppercase">Export</p>
        <p className="text-[11px] text-[var(--color-text-muted)]">
          CSV and Excel include every item field plus category and subcategory names. The JSON backup holds everything (categories, items, history) and can be
          restored here.
        </p>
        <div className="grid grid-cols-3 gap-2">
          <Button variant="ghost" onClick={exportCsv} className="px-2">
            <Download size={14} /> Export CSV
          </Button>
          <Button variant="ghost" onClick={exportExcel} className="px-2">
            <Download size={14} /> Export Excel
          </Button>
          <Button variant="ghost" onClick={exportJson} className="px-2">
            <Download size={14} /> Export JSON
          </Button>
        </div>
      </Card>
      <Card className="space-y-3">
        <p className="text-xs font-bold text-[var(--color-primary)] uppercase">Import</p>
        <p className="text-[11px] text-[var(--color-text-muted)]">
          CSV or Excel columns: name, category, subcategory, unit, packaging_unit, quantity_per_pack, current_stock, min_stock, expiry_date (YYYY-MM-DD), batch_lot,
          notes, price, payer. Only name is required.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={() => csvInput.current?.click()}>
            <Upload size={14} /> Import CSV / Excel
          </Button>
          <Button variant="ghost" onClick={() => jsonInput.current?.click()}>
            <Upload size={14} /> Restore backup
          </Button>
        </div>
        <input ref={csvInput} type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={handleCsv} />
        <input ref={jsonInput} type="file" accept=".json,application/json" hidden onChange={handleJson} />
      </Card>
      {message && <p className="text-xs text-[var(--color-text-soft)]">{message}</p>}
    </div>
  )
}
