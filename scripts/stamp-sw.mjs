/**
 * scripts/stamp-sw.mjs — 给构建产物 dist/sw.js 追加「本版构建指纹」（adj400 / E-2026-140）
 *
 * 背景：PWA 的更新提示（adj379「发现新版本，点击刷新」）只在 **sw.js 自身内容变化** 时才会触发
 * ——新 SW 安装 → `skipWaiting()`/`clients.claim()` → `controllerchange` → 弹提示。
 * 此前 sw.js 是纯静态文件、跨版本字节不变，于是已经装到手机主屏的 PWA 会一直跑旧 bundle：
 * 不弹提示、`reg.update()` 也查不到新 SW，用户只能手动把 PWA 关掉重开。
 * （用户实测：部署 0.16.0 后手机上仍是旧界面。）
 *
 * 做法：把上一次的指纹行去掉、追加一行 `// ijipu-build: v<版本> <日期 时间> @<commit>`。
 * 只改字节、不改任何逻辑与缓存名：
 *  - SW 内容变化 → 浏览器判定「有新版本」→ 下次前后台获焦/定时检查时弹更新提示；
 *  - 缓存名（`jps-shell-v3`）保持不变 → 已缓存的 30MB+ 字体不会被清掉重下。
 *
 * 由 `npm run build` 在 `vite build` 之后自动执行（沙箱兼容：不 spawn 子进程，直接读 .git 文件）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const swPath = join(root, 'dist', 'sw.js')
const MARK = '// ijipu-build:'

if (!existsSync(swPath)) {
  console.error('[stamp-sw] 未找到 dist/sw.js —— 应先执行 vite build')
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const now = new Date()
const pad = (n) => String(n).padStart(2, '0')
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`

/** 当前 commit 前 8 位（与 gen-build-info.mjs 同款：读 .git 文件，不 spawn） */
let commit = 'dev'
try {
  const head = readFileSync(join(root, '.git', 'HEAD'), 'utf8').trim()
  if (head.startsWith('ref:')) {
    const ref = head.split(' ')[1].trim()
    commit = readFileSync(join(root, '.git', ref), 'utf8').trim().slice(0, 8)
  } else {
    commit = head.slice(0, 8)
  }
} catch {
  /* 无 git 环境回退 dev */
}

const src = readFileSync(swPath, 'utf8')
const withoutOld = src
  .split('\n')
  .filter((l) => !l.startsWith(MARK))
  .join('\n')
  .trimEnd()

writeFileSync(swPath, `${withoutOld}\n${MARK} v${pkg.version} ${stamp} @${commit}\n`, 'utf8')
console.log(`[stamp-sw] dist/sw.js ← v${pkg.version} ${stamp} @${commit}`)
