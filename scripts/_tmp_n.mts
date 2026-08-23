import { parseJps } from '../src/engine/parser'
import { layoutScore } from '../src/engine/layout'
import { renderScoreToSvg } from '../src/engine/render'
import { defaultPageConfig } from '../src/engine/types'
const r = parseJps('V: 1.0\nB: t\nD: C\nP: 4/4\nS: 这是一段说明\nS: 第二行说明\nQ: 1 2 3 4 | 5 6 7 1 |\n')
console.log('notes:', JSON.stringify(r.header.notes))
const lay = layoutScore(r, defaultPageConfig)
console.log('pages:', lay.pages.length)
const svg = renderScoreToSvg(lay)[0]
console.log('notes text:', svg.includes('这是一段说明'), svg.includes('第二行说明'))
for (const m of svg.matchAll(/data-meta="notes[^"]*"[^>]*>/g)) console.log(m[0])
