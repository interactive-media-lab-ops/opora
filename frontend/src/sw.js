/* Service worker «Опори» (PWA-оболонка, D-18).
 *
 * Що кешуємо: лише статичну оболонку застосунку (index.html, хешовані скрипти/стилі, шрифти, логотипи, іконки).
 * Чого НЕ кешуємо: жодних /api/*: персональні дані кандидатів на пристрої HR/адміна не зберігаються (DD-13).
 * Дані кабінету кандидата для офлайну зберігає сам застосунок (IndexedDB) і лише для його власника.
 *
 * Версію й перелік файлів у двох константах нижче підставляє плагін збірки (vite.config.ts): кожна збірка — новий кеш.
 */
const VERSION = '__VERSION__'
const CACHE = `opora-shell-${VERSION}`
const PRECACHE = __PRECACHE__

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('opora-shell-') && k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

const STATIC = /^\/(assets\/|fonts\/|icons\/|logo|favicon|manifest\.webmanifest)/

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return // мережа як є

  // перехід по сторінці: мережа, а без зв'язку — закешована оболонка (SPA)
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/index.html').then((r) => r || Response.error())))
    return
  }

  if (STATIC.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(CACHE).then((c) => c.put(req, copy))
            }
            return res
          }),
      ),
    )
  }
})
