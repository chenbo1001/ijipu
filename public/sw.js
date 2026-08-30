/* iJipu PWA Service Worker（adj155：可安装为浏览器应用）
 * 策略：
 *  - 导航请求（HTML）：network-first，离线回退缓存首页（保证拿到最新构建）
 *  - 静态资源（/assets/* 带 hash）：cache-first，后台刷新缓存
 *  - 大体积字体（/fonts/*.otf，累计 ~33MB）：cache-first，命中缓存直接返回，
 *    避免每次浏览都重新下载字体（adj192：字体按需加载后常驻缓存）
 *  - manifest / 图标 / favicon：cache-first
 * 版本号变化时 activate 清理旧缓存（adj192：升 v3，强制清掉旧 CSS/字体缓存）。
 */
const CACHE = 'jps-shell-v3'
const PRECACHE = ['/', '/index.html', '/manifest.webmanifest', '/Jianpu.ico', '/Jianpu.png', '/pwa-192.png', '/pwa-512.png', '/good.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // 仅同源（不缓存跨域请求）

  // 导航请求：网络优先，离线回退缓存
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('/index.html', copy))
          return res
        })
        .catch(() => caches.match('/index.html')),
    )
    return
  }

  // 大体积字体（/fonts/*.otf）：cache-first，命中即回——字体按需只下载一次，节省流量
  if (url.pathname.startsWith('/fonts/')) {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit
        return fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone()
              caches.open(CACHE).then((c) => c.put(req, copy))
            }
            return res
          })
          .catch(() => hit)
      }),
    )
    return
  }

  // 静态资源与 manifest/图标：缓存优先，后台更新
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        })
        .catch(() => hit)
      return hit || network
    }),
  )
})
