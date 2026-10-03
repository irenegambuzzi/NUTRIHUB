/* Loaded into the service worker (workbox importScripts).
 *
 * Pages from versions before the "New version available" banner can't
 * update themselves, and an old page can process purchases the old way.
 * So a new service worker asks every open page whether it handles updates
 * itself (the app answers NUTRIHUB_PING); pages that don't answer are old:
 * the new worker takes over at once and reloads them into the new version.
 * Pages that answer decide themselves when it's safe to update.
 */
const PING_TIMEOUT = 1500

function answers(client) {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve(false), PING_TIMEOUT)
    channel.port1.onmessage = () => {
      clearTimeout(timer)
      resolve(true)
    }
    try {
      client.postMessage({ type: 'NUTRIHUB_PING' }, [channel.port2])
    } catch {
      clearTimeout(timer)
      resolve(false)
    }
  })
}

async function oldPages() {
  const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const replies = await Promise.all(pages.map(answers))
  return pages.filter((_, i) => !replies[i])
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    oldPages().then((old) => {
      if (old.length) return self.skipWaiting()
    })
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    oldPages().then(async (old) => {
      if (!old.length) return
      await self.clients.claim()
      await Promise.all(old.map((page) => page.navigate(page.url).catch(() => {})))
    })
  )
})
