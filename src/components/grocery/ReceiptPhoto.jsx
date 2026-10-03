import { useRef, useState } from 'react'
import { Calendar, Camera, FileText, ListChecks, RefreshCw, Trash2, Upload, X, ZoomIn, ZoomOut } from 'lucide-react'
import { cn } from '../../lib/cn'
import { isPdf } from '../../lib/receipts'
import { usePhotoUrl } from '../../hooks/usePhotoUrl'

// "Take photo" (the phone camera) and "Upload" (a photo or PDF) buttons;
// onFile(file) gets the chosen file.
export function PhotoPicker({ onFile, compact = false, disabled = false }) {
  const camera = useRef(null)
  const upload = useRef(null)
  const pick = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) onFile(file)
  }
  const button = cn(
    'flex items-center justify-center gap-1.5 rounded-2xl border border-[var(--color-border)] font-bold text-[var(--color-text)] bg-[var(--color-surface-soft)] disabled:opacity-40',
    compact ? 'p-2 text-[11px]' : 'px-3 py-2.5 text-xs flex-1'
  )
  return (
    <div className={cn('flex gap-2', compact ? '' : 'w-full')}>
      <button type="button" disabled={disabled} onClick={() => camera.current?.click()} className={button} aria-label="Take a photo of the receipt">
        <Camera size={compact ? 14 : 16} /> {compact ? '' : 'Take photo'}
      </button>
      <button type="button" disabled={disabled} onClick={() => upload.current?.click()} className={button} aria-label="Upload a photo or PDF of the receipt">
        <Upload size={compact ? 14 : 16} /> {compact ? '' : 'Upload photo or PDF'}
      </button>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={upload} type="file" accept="image/*,application/pdf" hidden onChange={pick} />
    </div>
  )
}

export function PhotoThumb({ photo, onOpen }) {
  const url = usePhotoUrl(photo)
  return (
    <button
      type="button"
      onClick={() => onOpen(photo)}
      aria-label="Open the receipt photo"
      className="w-16 h-20 shrink-0 rounded-xl overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface-soft)] flex items-center justify-center"
    >
      {isPdf(photo) ? (
        <FileText size={22} className="text-[var(--color-text-muted)]" />
      ) : url ? (
        <img src={url} alt="Receipt" className="w-full h-full object-cover" />
      ) : (
        <span className="w-4 h-4 rounded-full border-2 border-[var(--color-border)] border-t-transparent animate-spin" />
      )}
    </button>
  )
}

// The photo itself, fitted or at full size (tap to switch); a PDF opens in
// its own viewer.
export function PhotoView({ photo, className }) {
  const url = usePhotoUrl(photo)
  const [zoom, setZoom] = useState(false)
  if (!url) return <div className={cn('flex items-center justify-center text-xs text-[var(--color-text-muted)]', className)}>Loading…</div>
  if (isPdf(photo)) {
    return (
      <div className={cn('flex flex-col', className)}>
        <iframe src={url} title="Receipt PDF" className="flex-1 w-full bg-white rounded-xl" />
        <a href={url} target="_blank" rel="noreferrer" className="text-xs font-bold text-[var(--color-primary)] mt-2 text-center">
          Open the PDF
        </a>
      </div>
    )
  }
  return (
    <div className={cn('relative overflow-auto rounded-xl bg-black/40', className)}>
      <img
        src={url}
        alt="Receipt"
        onClick={() => setZoom((z) => !z)}
        className={cn('block mx-auto', zoom ? 'max-w-none w-[200%] cursor-zoom-out' : 'max-w-full max-h-full object-contain cursor-zoom-in')}
      />
      <button
        type="button"
        onClick={() => setZoom((z) => !z)}
        aria-label={zoom ? 'Fit the photo' : 'Zoom in'}
        className="sticky bottom-2 left-full mr-2 float-right p-2 rounded-full bg-black/60 text-white"
      >
        {zoom ? <ZoomOut size={16} /> : <ZoomIn size={16} />}
      </button>
    </div>
  )
}

// Full screen: the photo, with replace, move to another day, delete and
// "Check prices".
export function PhotoViewer({ photo, onClose, onReplace, onMove, onDelete, onCheckPrices }) {
  const replace = useRef(null)
  return (
    <div className="fixed inset-0 z-40 bg-black/90 flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-between gap-2 p-3">
        <p className="text-sm font-bold text-white">Receipt · {photo.receipt_date}</p>
        <button type="button" onClick={onClose} aria-label="Close" className="p-2 text-white">
          <X size={20} />
        </button>
      </div>
      <PhotoView photo={photo} className="flex-1 mx-3" />
      <div className="grid grid-cols-4 gap-2 p-3 text-[11px] font-bold text-white">
        <button type="button" onClick={() => onCheckPrices(photo)} className="flex flex-col items-center gap-1 py-2 rounded-xl bg-white/10">
          <ListChecks size={18} /> Check prices
        </button>
        <button type="button" onClick={() => replace.current?.click()} className="flex flex-col items-center gap-1 py-2 rounded-xl bg-white/10">
          <RefreshCw size={18} /> Replace
        </button>
        <button type="button" onClick={() => onMove(photo)} className="flex flex-col items-center gap-1 py-2 rounded-xl bg-white/10">
          <Calendar size={18} /> Change day
        </button>
        <button type="button" onClick={() => onDelete(photo)} className="flex flex-col items-center gap-1 py-2 rounded-xl bg-white/10 text-rose-300">
          <Trash2 size={18} /> Delete
        </button>
      </div>
      <input
        ref={replace}
        type="file"
        accept="image/*,application/pdf"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) onReplace(photo, file)
        }}
      />
    </div>
  )
}
