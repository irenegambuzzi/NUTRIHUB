import { showToast, toastSaveError } from './feedback'

// A Supabase result's data, or its error thrown, so a multi-step write
// stops at the first failure instead of carrying on as if it worked.
export function must({ data, error }) {
  if (error) throw error
  return data
}

const asError = (error) => (error && typeof error === 'object' ? error : new Error(String(error)))

// Runs `fn(onFail)`. Each finished step registers how to undo itself with
// onFail(undo). If a later step throws, the registered undos run newest
// first and the error is rethrown with `rolledBack` telling whether all
// of them worked — so nothing is left half-saved.
export async function inSteps(fn) {
  const undos = []
  try {
    return await fn((undo) => undos.push(undo))
  } catch (error) {
    let rolledBack = true
    for (const undo of undos.reverse()) {
      try {
        await undo()
      } catch (undoError) {
        console.error(undoError)
        rolledBack = false
      }
    }
    throw Object.assign(asError(error), { rolledBack })
  }
}

// A write the user started. On failure it runs `onFail` (usually a reload,
// so the screen shows what's really saved) and shows the save-error toast,
// with Retry when repeating it is safe: `retry` is on and nothing was left
// half-done. Writes started from a form pass retry: false — the form stays
// open and Save can simply be pressed again. Returns { data, error }.
export async function attempt(fn, { retry = true, onFail } = {}) {
  try {
    return { data: await fn(), error: null }
  } catch (error) {
    await settle(onFail)
    const again = retry && error?.rolledBack !== false ? () => attempt(fn, { retry, onFail }) : null
    toastSaveError(error, again)
    return { data: null, error }
  }
}

// A follow-up after the main change was saved (stock history, shopping
// list, a linked expense…). If it fails the main change stays; the toast
// says what's missing and Retry repeats just this step.
export async function followUp(what, fn) {
  try {
    await fn()
    return true
  } catch (error) {
    toastSaveError(error, () => followUp(what, fn), `Saved, but couldn't update ${what} — check your connection.`)
    return false
  }
}

// Deletes right away, then shows "Deleted" with Undo for 5 seconds.
// `remove()` deletes and returns a snapshot of exactly what it removed;
// `restore(snapshot)` puts it back and must be safe to repeat (upsert).
// `onFail` runs after any failure (usually a reload).
export async function deleteWithUndo({ remove, restore, message = 'Deleted', onFail }) {
  let snapshot
  try {
    snapshot = await remove()
  } catch (error) {
    await settle(onFail)
    toastSaveError(error, () => deleteWithUndo({ remove, restore, message, onFail }))
    return { error }
  }
  const undo = async () => {
    try {
      await restore(snapshot)
    } catch (error) {
      await settle(onFail)
      toastSaveError(error, undo, "Couldn't undo — check your connection.")
    }
  }
  showToast({ message, duration: 5000, action: { label: 'Undo', onClick: undo } })
  return { error: null, snapshot }
}

// Runs a cleanup callback without letting its own failure hide the
// original problem.
async function settle(fn) {
  try {
    await fn?.()
  } catch (error) {
    console.error(error)
  }
}
