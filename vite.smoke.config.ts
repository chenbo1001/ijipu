/**
 * vite.smoke.config.ts — 引擎测试/预览打包配置
 * 将 scripts/*.mts 打包为 Node 可直接运行的 CJS（用于沙箱环境跑引擎测试）。
 * 用法：vite build --config vite.smoke.config.ts
 *   node dist-smoke/smoke.cjs    → 冒烟测试
 *   node dist-smoke/preview.cjs  → 生成示例谱渲染 SVG
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