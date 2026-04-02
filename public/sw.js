/* ──────────────────────────────────────────────────────────────────────────
   Music Sort — Service Worker
   Cache-first for app shell, network-first for Spotify API requests.
   ────────────────────────────────────────────────────────────────────────── */

const CACHE = 'music-sort-v3'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll([self.registration.scope, `${self.registration.scope}index.html`]).catch(() => undefined),
    ),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Skip cross-origin requests (Spotify API, CDNs) — let them go to network
  if (url.origin !== self.location.origin) return

  // Never cache auth callbacks; these carry one-time OAuth params.
  if (url.searchParams.has('code') || url.searchParams.has('state')) return

  const isNavigation = event.request.mode === 'navigate'
  const isStaticAsset = /\.(js|css|png|jpg|jpeg|svg|webp|ico|json|woff2?)$/i.test(url.pathname)

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && (isNavigation || isStaticAsset)) {
          const clone = response.clone()
          caches.open(CACHE).then((cache) => cache.put(event.request, clone))
        }
        return response
      })
      .catch(() =>
        caches.match(event.request).then((cached) => {
          if (cached) return cached
          return isNavigation
            ? caches.match(`${self.registration.scope}index.html`)
            : Response.error()
        }),
      ),
  )
})
