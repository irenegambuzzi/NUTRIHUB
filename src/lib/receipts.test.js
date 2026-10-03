import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabaseClient', () => ({ supabase: {} }))
const { RECEIPT_READERS, isPdf, photoPath, readReceipt } = await import('./receipts')

describe('receipt files', () => {
  it('go in one folder per shopping day, with the right extension', () => {
    expect(photoPath('2026-10-03', 'image/jpeg', 'IMG_1.HEIC')).toMatch(/^2026-10-03\/[0-9a-f-]{36}\.jpg$/)
    expect(photoPath('2026-10-03', 'application/pdf', 'scan.pdf')).toMatch(/\.pdf$/)
    expect(photoPath('2026-10-03', '', 'receipt.PNG')).toMatch(/\.png$/)
  })

  it('tells PDFs from photos', () => {
    expect(isPdf({ content_type: 'application/pdf', path: 'a/b.pdf' })).toBe(true)
    expect(isPdf({ content_type: null, path: 'a/b.PDF' })).toBe(true)
    expect(isPdf({ content_type: 'image/jpeg', path: 'a/b.jpg' })).toBe(false)
  })

  it('reads nothing automatically until a reader is added', async () => {
    expect(RECEIPT_READERS).toEqual([])
    expect(await readReceipt({ id: 'x', path: 'a/b.jpg' })).toBeNull()
  })
})
