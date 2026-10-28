// Сеть в приоритете, кэш — запасной вариант без интернета
const CACHE = 'windauto-v6'
// приложение и сервер на одном адресе: API, ссылки из писем и юридические страницы — мимо кэша
// (данные заказов не оседают в кэше, поток событий и видео с перемоткой идут напрямую)
const PASS = /^\/(api|auth|legal)\//

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  const keys = await caches.keys()
  await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
  await self.clients.claim()
})()))

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin || PASS.test(url.pathname)) return
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(e.request, copy))
        return res
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))),
  )
})
