/**
 * scripts/_tmp_shot.mjs — 临时：把 bug-0.svg 的指定区域放大截成 PNG（定位用）
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const root = process.cwd()
const src = join(root, 'dist-preview/bug-0.svg')
const svg = readFileSync(src, 'utf8')

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const shots = [
  { name: 'sys1', x: 40, y: 130, w: 520, h: 120 },
  { name: 'sys2', x: 40, y: 225, w: 520, h: 110 },
  { name: 'sys3', x: 40, y: 315, w: 520, h: 110 },
]
for (const s of shots) {
  const k = 3
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff}` +
    `#vp{width:${s.w * k}px;height:${s.h * k}px;overflow:hidden;position:relative}` +
    `#in{position:absolute;left:${-s.x * k}px;top:${-s.y * k}px;width:${595.28 * k}px;height:${841.89 * k}px}` +
    `svg{width:100%;height:100%}</style></head><body><div id="vp"><div id="in">${svg}</div></div></body></html>`
  const htmlPath = join(root, `dist-preview/bug-${s.name}.html`)
  writeFileSync(htmlPath, html, 'utf8')
  const out = join(root, `dist-preview/bug-${s.name}.png`)
  execFileSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      `--screenshot=${out}`,
      `--window-size=${s.w * k},${s.h * k}`,
      '--force-device-scale-factor=1',
      '--default-background-color=FFFFFFFF',
      `file:///${htmlPath.replace(/\\/g, '/')}`,
    ],
    { stdio: 'ignore' },
  )
  console.log('shot ->', out)
}
