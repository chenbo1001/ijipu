/* iJipu PWA Service Worker（adj155：可安装为浏览器应用）
 * 策略：
 *  - 导航请求（HTML）：network-first，离线回退缓存首页（保证拿到最新构建）
 *  - 静态资源（/assets/* 带 hash）：cache-first，后台刷新缓存
 *  - 大体积字体（/fonts/*.otf，累计 ~33MB）：cache-first，命中缓存直接返回，
 *    避免每次浏览都重新下载字体（adj192：字体按需加载后常驻缓存）
 *  - manifest / 图标 / favicon：cache-first
 * 版本号变化时 activate 清理旧缓存（adj192：升 v3，强制清掉旧 CSS/字体缓存）。
 * adj417：图标集中在 `/icons/`（`public/icons/`），dist 根目录不再散落几十个 png。
 */
const CACHE = 'jps-shell-v3'
const PRECACHE = ['/', '/index.html', '/manifest.webmanifest', '/icons/Jianpu.ico', '/icons/Jianpu.png', '/icons/pwa-192.png', '/icons/pwa-512.png', '/icons/good.png']
/* adj408：按钮 PNG 图标（`public/icons/*.png`，约 60KB）——首屏渲染就会用到，离线时必须命中缓存。
   单独**逐个**预热而**不并进 PRECACHE**：`addAll` 是"任一失败则整体失败"，图标文件名是中文，
   万一编码/改名对不上就会让整个 install 失败 → 更新提示再也弹不出来（E-2026-140），
   故这里用非致命写法（单个失败忽略）。
   adj417：清单必须与 `src/ui/toolIcons.ts` 的 ICON_FILES 完全一致（smoke 有断言兜底——
   此前这里漏了「暂停」「下载」，属于清单漂移）。
   adj456：**再次漂移**——adj426 新增的「自动主题」「浅色主题」「深色主题」三个图标没进这份清单，
   表现为 PWA 离线/首次安装后顶栏「浅深模式」按钮**空白**（图标是 CSS mask 的 URL，缺文件即无形状）。
   本次补齐并把该断言从"基线里的一条已知失败"变成"零容忍"（smoke 现在 0 失败）。
   adj458：拆分两个方向改用专属图标（「左右」「上下」）、「导出」改用专属图标（不再借用「下载」）、
   「编码」「预览」「输入条」也各自换成对应图标（不再借用「文件」「查看」「键盘」）——
   清单随之一并替换/移除。 */
const ICON_FILES = ['菜单', '编码', '左右', '上下', '预览', '排版', '播放', '停止', '暂停', '设置', '导出', '折行', '字体', '爱心', '下', '上', '更多', '输入', '自动主题', '浅色主题', '深色主题']
const ICONS = ICON_FILES.map((n) => `/icons/${n}.png`)

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) =>
        c.addAll(PRECACHE).then(() =>
          Promise.all(
            ICONS.map((u) =>
              /**
               * adj457：图标**强制走网络校验**（`cache: 'reload'`）再写缓存。
               * 起因：图标文件名固定不带 hash，`cache.add()` 的 fetch 可能命中**浏览器 HTTP 缓存**
               * （部署侧通常 `max-age=600`）→ 新构建把图标换了图，SW 却把**旧图**写进缓存并一直用下去
               * （要等下一次构建触发 SW 更新才可能换掉），用户会以为"换了图没生效"。
               * 仍然**逐个非致命**（单个失败忽略）——中文文件名 + `addAll` 的"任一失败全失败"
               * 曾让整个 install 挂掉、更新提示再也弹不出来（E-2026-140）。
               */
              fetch(new Request(u, { cache: 'reload' }))
                .then((res) => (res.ok ? c.put(u, res) : undefined))
                .catch(() => undefined),
            ),
          ),
        ),
      )
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
