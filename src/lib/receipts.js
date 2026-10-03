import { supabase } from './supabaseClient'
import { must } from './db'

// Receipt photos (and PDFs) in the private "receipts" Storage bucket,
// linked to a shopping day in receipt_photos (supabase/013).

export const BUCKET = 'receipts'
const MAX_SIDE = 2000 // px; phone photos are shrunk to about this
const URL_LIFETIME = 60 * 60 // seconds a viewing link stays valid

export const isPdf = (photo) => (photo.content_type || '').includes('pdf') || /\.pdf$/i.test(photo.path || '')

const extensionOf = (type, name = '') =>
  ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf' })[type] ||
  name.split('.').pop()?.toLowerCase() ||
  'bin'

// Where a new file goes: one folder per shopping day.
export const photoPath = (date, type, name) => `${date}/${crypto.randomUUID()}.${extensionOf(type, name)}`

// Phone photos are large; shrink them to a readable JPEG before upload.
// Files the browser can't draw (PDF, sometimes HEIC) go up unchanged.
export async function shrinkImage(file) {
  if (!file.type.startsWith('image/') || typeof createImageBitmap === 'undefined') return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file
  } catch {
    return file
  }
}

export async function uploadFile(path, file) {
  must(await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false }))
}

export async function removeFiles(paths) {
  if (paths.length) must(await supabase.storage.from(BUCKET).remove(paths))
}

// Viewing links for private files, reused until shortly before they expire.
const links = new Map()
export async function photoUrl(path) {
  const cached = links.get(path)
  if (cached && cached.until > Date.now()) return cached.url
  const { signedUrl } = must(await supabase.storage.from(BUCKET).createSignedUrl(path, URL_LIFETIME))
  links.set(path, { url: signedUrl, until: Date.now() + (URL_LIFETIME - 60) * 1000 })
  return signedUrl
}

// Reading a receipt automatically, for later (e.g. an AI model behind a
// Supabase Edge Function). A reader: { name, read(photo, { url }) →
// { date?, total?, lines: [{ description, amount }] } }. The result is
// meant for receipt_photos.parsed, to suggest prices in "Check prices".
export const RECEIPT_READERS = []

export async function readReceipt(photo) {
  const reader = RECEIPT_READERS[0]
  if (!reader) return null
  const parsed = await reader.read(photo, { url: await photoUrl(photo.path) })
  must(await supabase.from('receipt_photos').update({ parsed, parsed_at: new Date().toISOString() }).eq('id', photo.id))
  return parsed
}
