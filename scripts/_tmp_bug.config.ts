/**
 * scripts/_tmp_bug.config.ts — 临时构建配置（复现脚本用，验证后删除）
 */
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@ijipu\/engine$/, replacement: fileURLToPath(new URL('../packages/ijipu-engine/src/engine/index.ts', import.meta.url)) },
      { find: /^@ijipu\/engine\//, replacement: fileURLToPath(new URL('../packages/ijipu-engine/src/engine/', import.meta.url)) },
    ],
  },
  build: {
    outDir: '../dist-smoke',
    emptyOutDir: false,
    target: 'node22',
    minify: false,
    sourcemap: false,
    lib: {
      entry: { bug: 'scripts/_tmp_bug.mts' },
      formats: ['cjs'],
      fileName: (_format, entryName) => `${entryName}.cjs`,
    },
    rollupOptions: {
      external: ['node:fs', 'node:url', 'node:path', 'node:zlib', 'fs', 'url', 'path', 'zlib'],
    },
  },
})
