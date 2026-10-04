#!/usr/bin/env node
/**
 * check-encoding.mjs — 源码/文档**编码与完整性强检**（adj688）
 *
 * 为什么需要它（E-2026-355 的机器化防范）：
 * 本仓库大量文件含中文。**Windows PowerShell（非 Core）默认按系统 ANSI/GBK 解码**，
 * 一旦用 `Get-Content -Raw | -replace | Set-Content` 之类**原地改写**，
 * UTF-8 的中文会被**不可逆**地破坏：注释变乱码（`鈥?鎺掔増`）、换行被吞、内容截断、
 * 文件头被写上 BOM。2026-10 就因此把 `layout/index.ts` 整份改动连同约 240 行内容弄丢过一次。
 *
 * 靠"记住不要这么做"是无效的（跨会话不成立），所以这里放一道**机器闸门**：
 * 任何被误读过的文件都会在 `npm run smoke` 阶段直接失败。
 *
 * 检查项：
 *  ① **严格 UTF-8**：用 `TextDecoder('utf-8', { fatal: true })` 解码，非法字节序列即失败
 *     （GBK 误读后再存回 UTF-8，必然留下非法序列或替换字符）；
 *  ② **替换字符 U+FFFD**：出现即失败——这是"已经丢过信息"的铁证；
 *  ③ **BOM**：本仓库源码一律**无 BOM**，出现即失败（PowerShell 的 `-Encoding utf8` 会加）。
 *
 * 用法：`npm run check:encoding`（已挂进 `npm run smoke` 前置）
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
/** 要检查的扩展名（源码 / 文档 / 配置） */
const EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.jps', '.css', '.html', '.svg'])
/** 跳过的目录 */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-smoke', 'dist-preview', 'target', '.git', 'gen', 'coverage', '.npm-cache'])
/** 允许带 BOM 的例外（无） */
const ALLOW_BOM = new Set([])

const decoder = new TextDecoder('utf-8', { fatal: true })
const problems = []
let checked = 0

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue
      walk(full)
      continue
    }
    if (!EXTS.has(extname(name))) continue
    const rel = relative(ROOT, full).replace(/\\/g, '/')
    const buf = readFileSync(full)
    checked++
    let text
    try {
      text = decoder.decode(buf)
    } catch {
      problems.push(`${rel}：**非法 UTF-8 字节序列**（疑似被按 GBK 等其它编码读写过）`)
      continue
    }
    if (text.includes('\uFFFD')) {
      const n = (text.match(/\uFFFD/g) ?? []).length
      problems.push(`${rel}：含 ${n} 个替换字符 U+FFFD（信息已丢失，必须从 git 或备份恢复）`)
    }
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf && !ALLOW_BOM.has(rel)) {
      problems.push(`${rel}：文件头带 UTF-8 BOM（源码一律无 BOM；` +
        `PowerShell 的 \`Set-Content -Encoding utf8\` 会加上）`)
    }
  }
}

walk(ROOT)

if (problems.length > 0) {
  console.error('❌ 编码检查失败：')
  for (const p of problems) console.error('  ✗ ' + p)
  console.error('\n提示：含中文的文件只能用编辑工具读写，禁止用 shell 原地改写（见 docs/ERRORS-LOG.md 的 E-2026-355）。')
  process.exit(1)
}
console.log(`✓ 编码检查通过（${checked} 个文件：UTF-8 严格可解码、无 U+FFFD、无 BOM）`)
