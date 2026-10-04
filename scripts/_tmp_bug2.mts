/**
 * scripts/_tmp_bug2.mts — 临时构建入口（不落 config 文件，规避沙箱写 node_modules，验证后删除）
 */
import { build } from 'vite'

await build({
  configFile: false,
  root: process.cwd(),
  resolve: {
    alias: [
      { find: /^@ijipu\/engine$/, replacement: '/packages/ijipu-engine/src/engine/index.ts' },
      { find: /^@ijipu\/engine\//, replacement: '/packages/ijipu-engine/src/engine/' },
    ],
  },
  build: {
    outDir: 'dist-smoke',
    emptyOutDir: false,
    target: 'node22',
    minify: false,
    sourcemap: false,
    lib: {
      entry: { bug: 'scripts/_tmp_bug.mts' },
      formats: ['cjs'],
      fileName: (_format: string, entryName: string) => `${entryName}.cjs`,
    },
    rollupOptions: {
      external: ['node:fs', 'node:url', 'node:path', 'node:zlib', 'fs', 'url', 'path', 'zlib'],
    },
  },
})
