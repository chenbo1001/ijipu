/**
 * vite.smoke.config.ts — 把 `scripts/*.mts` 打包成 **Node 可跑的 CJS**（冒烟测试 / 渲染预览 / 命令行）。
 *
 * 用法：
 *   vite build --config vite.smoke.config.ts
 *   node dist-smoke/smoke.cjs    → 引擎冒烟测试
 *   node dist-smoke/preview.cjs  → 生成样例谱的 SVG
 *   node dist-smoke/cli.cjs …    → iJipu 命令行（`npm run cli -- <命令>`）
 *
 * ⚠ 本文件头部注释此前被"用 shell 改含中文文件"弄成了乱码（AGENTS §六之二·1 记过的那种损害）；
 *    这里按实际用途重写为准确描述 —— 之后**只用编辑工具**改本文件。
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
        // adj801（A·P1）：命令行入口 ⇒ `dist-smoke/cli.cjs`（`npm run cli -- …`）
        cli: 'scripts/ijipu-cli.mts',
        // adj806（A·P1–P4 的机器闸门）：命令行断言套件 ⇒ `dist-smoke/cli-assert.cjs`
        'cli-assert': 'scripts/cli-assert.mts',
      },
      formats: ['cjs'],
      fileName: (_format, entryName) => `${entryName}.cjs`,
    },
    rollupOptions: {
      // adj458：加重建内置模块 `node:zlib`（smoke 里解 PNG 的 IDAT，核对按钮图标的像素口径）
      // adj801：命令行入口用 `node:fs/promises`
      external: ['node:fs', 'node:fs/promises', 'node:url', 'node:path', 'node:zlib', 'fs', 'url', 'path', 'zlib'],
    },
  },
})