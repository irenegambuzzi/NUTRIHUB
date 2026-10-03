import { useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { attempt, deleteWithUndo, followUp, inSteps, must } from '../lib/db'
import { receiptPhotoStore } from '../lib/stores'
import { photoPath, removeFiles, shrinkImage, uploadFile } from '../lib/receipts'

// How long a deleted photo's file is kept, so Undo can bring it back.
const KEEP_FOR_UNDO = 7000

// Receipt photos: adding (camera or file), replacing and deleting them.
export function useReceiptPhotos() {
  const { rows: photos, loaded } = receiptPhotoStore.useRows()

  // Uploads the file, then records it for that shopping day (and confirmed
  // purchase, if given). If recording fails, the uploaded file is removed
  // again.
  const addPhoto = useCallback(
    (file, date, tripId = null) =>
      attempt(
        () =>
          inSteps(async (onFail) => {
            const ready = await shrinkImage(file)
            const path = photoPath(date, ready.type, ready.name)
            await uploadFile(path, ready)
            onFail(() => removeFiles([path]))
            const row = must(
              await supabase
                .from('receipt_photos')
                .insert([{ receipt_date: date, trip_id: tripId, path, content_type: ready.type || null, file_name: file.name || null }])
                .select()
                .single()
            )
            receiptPhotoStore.upsertLocal([row])
            return row
          }),
        { retry: false, onFail: receiptPhotoStore.refresh }
      ),
    []
  )

  // A new file for the same photo; the old file goes once it's replaced.
  const replacePhoto = useCallback(
    async (photo, file) => {
      const result = await attempt(
        () =>
          inSteps(async (onFail) => {
            const ready = await shrinkImage(file)
            const path = photoPath(photo.receipt_date, ready.type, ready.name)
            await uploadFile(path, ready)
            onFail(() => removeFiles([path]))
            const row = must(
              await supabase
                .from('receipt_photos')
                .update({ path, content_type: ready.type || null, file_name: file.name || null, parsed: null, parsed_at: null, updated_at: new Date().toISOString() })
                .eq('id', photo.id)
                .select()
                .single()
            )
            receiptPhotoStore.upsertLocal([row])
            return row
          }),
        { retry: false, onFail: receiptPhotoStore.refresh }
      )
      if (!result.error) await followUp('the old photo file', () => removeFiles([photo.path]))
      return result
    },
    []
  )

  // Moves a photo to another shopping day.
  const movePhoto = useCallback(
    (photo, date) =>
      attempt(
        async () => {
          const row = must(await supabase.from('receipt_photos').update({ receipt_date: date, updated_at: new Date().toISOString() }).eq('id', photo.id).select().single())
          receiptPhotoStore.upsertLocal([row])
        },
        { onFail: receiptPhotoStore.refresh }
      ),
    []
  )

  // Deleted at once with Undo; the file itself goes only after Undo is no
  // longer offered.
  const deletePhoto = useCallback(async (photo) => {
    let undone = false
    const result = await deleteWithUndo({
      message: 'Receipt photo deleted',
      remove: async () => {
        const [row] = must(await supabase.from('receipt_photos').delete().eq('id', photo.id).select())
        receiptPhotoStore.removeLocal([photo.id])
        return row
      },
      restore: async (row) => {
        undone = true
        if (row) must(await supabase.from('receipt_photos').upsert(row))
        await receiptPhotoStore.refresh()
      },
      onFail: receiptPhotoStore.refresh,
    })
    if (!result.error) {
      setTimeout(() => {
        if (!undone) followUp('the deleted photo file', () => removeFiles([photo.path]))
      }, KEEP_FOR_UNDO)
    }
    return result
  }, [])

  return { photos, loaded, addPhoto, replacePhoto, movePhoto, deletePhoto }
}
