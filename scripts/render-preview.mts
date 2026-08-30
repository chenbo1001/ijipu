/**
 * scripts/render-preview.mts — 生成示例谱渲染 SVG（开发检查用）
 * 运行：npm run preview:render（输出到 dist-preview/）
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseJps, layoutScore, renderScoreToSvg, defaultPageConfig } from '@ijipu/engine/index.ts'

const root = process.cwd()
const outDir = join(root, 'dist-preview')
mkdirSync(outDir, { recursive: true })

const files = readdirSync(join(root, 'samples')).filter((f) => f.endsWith('.jps'))
for (const file of files) {
  const name = file.replace(/\.jps$/, '')
  const code = readFileSync(join(root, 'samples', file), 'utf8')
  const result = parseJps(code)
  const layout = layoutScore(result, defaultPageConfig)
  const svgs = renderScoreToSvg(layout)
  svgs.forEach((svg, i) => {
    writeFileSync(join(outDir, `${name}-${i}.svg`), svg, 'utf8')
  })
  const p0 = layout.pages[0]
  console.log(
    `${name}: ${svgs.length} page(s), ${p0.notes.length} notes, ${p0.barlines.length} barlines, ` +
      `${p0.slurs.length} slurs, ${p0.dynamics.length} dynamics, ${p0.voiceBlocks.length} vblocks, errors=${result.errors.length}`,
  )
}
console.log('output -> dist-preview/')
