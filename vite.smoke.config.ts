/**
 * vite.smoke.config.ts 鈥?寮曟搸娴嬭瘯/棰勮鎵撳寘閰嶇疆
 * 灏?scripts/*.mts 鎵撳寘涓?Node 鍙洿鎺ヨ繍琛岀殑 CJS锛堢敤浜庢矙绠辩幆澧冭窇寮曟搸娴嬭瘯锛夈€? * 鐢ㄦ硶锛歷ite build --config vite.smoke.config.ts
 *   node dist-smoke/smoke.cjs    鈫?鍐掔儫娴嬭瘯
 *   node dist-smoke/preview.cjs  鈫?鐢熸垚绀轰緥璋辨覆鏌?SVG
 */
import { defineConfig } from 'vite'

export default defineConfig({
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


















