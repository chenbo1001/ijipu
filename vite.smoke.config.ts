/**
 * vite.smoke.config.ts 閳?瀵洘鎼稿ù瀣槸/妫板嫯顫嶉幍鎾冲瘶闁板秶鐤? * 鐏?scripts/*.mts 閹垫挸瀵樻稉?Node 閸欘垳娲块幒銉ㄧ箥鐞涘瞼娈?CJS閿涘牏鏁ゆ禍搴㈢煓缁犺京骞嗘晶鍐獓瀵洘鎼稿ù瀣槸閿涘鈧? * 閻劍纭堕敍姝穒te build --config vite.smoke.config.ts
 *   node dist-smoke/smoke.cjs    閳?閸愭帞鍎ù瀣槸
 *   node dist-smoke/preview.cjs  閳?閻㈢喐鍨氱粈杞扮伐鐠嬭鲸瑕嗛弻?SVG
 */
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@ijipu\/engine$/, replacement: fileURLToPath(new URL('./packages/ijipu-engine/src/engine/index.ts', import.meta.url)) },
      { find: /^@ijipu\/engine\//, replacement: fileURLToPath(new URL('./packages/ijipu-engine/src/engine/', import.meta.url)) },
    ],
  },
  build: {
    outDir: 'dist-smoke',
    target: 'node22',
    minify: false,
    sourcemap: false,
    lib: {
      entry: {
        smoke: 'scripts/smoke.mts',
        preview: 'scripts/render-preview.mts',
      },
      formats: ['cjs'],
      fileName: (_format, entryName) => `${entryName}.cjs`,
    },
    rollupOptions: {
      external: ['node:fs', 'node:url', 'node:path', 'fs', 'url', 'path'],
    },
  },
})