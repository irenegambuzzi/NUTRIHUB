import { registerSW } from 'virtual:pwa-register'
import { applyUpdate, getUpdateState, isSafeToReload, setUpdateAvailable, shouldAutoUpdate } from './lib/appUpdate'

// Keeps the app on the newest version (see lib/appUpdate.js and
// public/sw-update.js).
const CHECK_EVERY = 60 * 1000
const JUST_OPENED = 15 * 1000

export function startAppUpdates() {
  if (!('serviceWorker' in navigator)) return
  const openedAt = Date.now()

  // A new service worker asks whether this page handles updates itself
  // (old versions don't, and get reloaded by it).
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'NUTRIHUB_PING') event.ports?.[0]?.postMessage({ type: 'NUTRIHUB_PONG' })
  })

  const maybeAutoUpdate = () => {
    if (!getUpdateState().available) return
    const auto = shouldAutoUpdate({
      hidden: document.visibilityState === 'hidden',
      justOpened: Date.now() - openedAt < JUST_OPENED,
      safe: isSafeToReload(),
    })
    if (auto) applyUpdate()
  }

  const updateSW = registerSW({
    immediate: true,
    // A new version is installed and waiting: offer it (banner), or load it
    // straight away when that's safe.
    onNeedRefresh() {
      setUpdateAvailable(() => updateSW(true))
      maybeAutoUpdate()
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const check = () => registration.update().catch(() => {})
      setInterval(check, CHECK_EVERY)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
        else maybeAutoUpdate()
      })
      window.addEventListener('online', check)
    },
  })

  setInterval(maybeAutoUpdate, CHECK_EVERY / 2)
}
