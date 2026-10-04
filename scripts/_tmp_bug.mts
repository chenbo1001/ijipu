/**
 * scripts/_tmp_bug.mts — 临时复现脚本（用户新报两处问题）
 * 运行：node --experimental-strip-types scripts/_tmp_bug2.mts && node dist-smoke/bug.cjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseJps, layoutScore, renderScoreToSvg, defaultPageConfig } from '@ijipu/engine/index.ts'

const root = process.cwd()
const outDir = join(root, 'dist-preview')
mkdirSync(outDir, { recursive: true })

const code = readFileSync(join(root, 'scripts/_tmp_bug.jps'), 'utf8')
const result = parseJps(code)
console.log('errors:', JSON.stringify(result.errors, null, 2))
const layout = layoutScore(result, { ...defaultPageConfig })
const svgs = renderScoreToSvg(layout)
svgs.forEach((svg, i) => writeFileSync(join(outDir, `bug-${i}.svg`), svg, 'utf8'))

const p = layout.pages[0]
console.log('=== SLUR keys ===')
console.log(JSON.stringify(p.slurs[0]))
console.log('=== NOTE keys ===')
console.log(JSON.stringify(p.notes[0]))
console.log('=== LYRIC keys ===')
console.log(JSON.stringify(p.lyrics[0]))
console.log('=== SEGBRACKETS ===')
console.log(JSON.stringify(p.segmentBrackets ?? null))
console.log('=== VOICEBLOCKS ===')
console.log(JSON.stringify(p.voiceBlocks ?? null)?.slice(0, 1200))
