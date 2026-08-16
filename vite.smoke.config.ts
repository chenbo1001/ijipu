/**
 * vite.smoke.config.ts — 冒烟测试打包配置
 * 将 scripts/smoke.mts 打包为 Node 可直接运行的 CJS（用于沙箱环境跑引擎测试）。
 * 用法：vite build --config vite.smoke.config.ts && node dist-smoke/smoke.cjs
 */
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    outDir: 'dist-smoke',
    target: 'node22',
    minify: false,
    sourcemap: false,
    lib: {
      entry: 'scripts/smoke.mts',
      formats: ['cjs'],
      fileName: () => 'smoke.cjs',
    },
    rollupOptions: {
      external: ['node:fs', 'node:url', 'node:path', 'fs', 'url', 'path'],
    },
  },
})
