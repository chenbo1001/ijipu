/**
 * packages/ijipu-cli/vite.config.ts — `@ijipu/cli` 的**可分发产物**构建
 *
 * 产出 `dist/ijipu.cjs`：**自包含**（引擎源码直接打进包内 ⇒ 运行期**零依赖**、也无需先发布
 * `@ijipu/engine`）、带 shebang ⇒ 与 `package.json` 的 `bin: { ijipu: dist/ijipu.cjs }` 对应 ✓。
 *
 * 用法（项目根）：`npm run cli:build`
 * 版本注入：`__IJIPU_CLI_VERSION__` = 本包 `package.json` 的 `version`
 *   （与 `src/brand/version.ts` 的 APP_VERSION 一致性由 cli-assert 闸门守住 ✓）。
 */
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string }

export default defineConfig({
  resolve: {
    // 与 `vite.smoke.config.ts` / `vite.config.ts` 同口径：引擎走**源码**（数值口径同源 ✓）
    alias: [
      { find: /^@ijipu\/engine$/, replacement: fileURLToPath(new URL('../ijipu-engine/src/engine/index.ts', import.meta.url)) },
      { find: /^@ijipu\/engine\//, replacement: fileURLToPath(new URL('../ijipu-engine/src/engine/', import.meta.url)) },
    ],
  },
  /**
   * ⚠ 必须关掉（**顶层选项**，不是 build 里的）：vite 的 root 是**项目根**、`publicDir` 默认 =
   * `<root>/public`，而 `public/` 里是应用的图标/示例谱/音色库 —— 不关就会把它们整个拷进本包的
   * `dist/`（实测踩到：`dist/` 混进 icons/、samples/、spessasynth/、sw.js，`npm pack` 一起打进
   * tarball ✗）。本包只需要 `ijipu.cjs` 一个文件 ✓。
   */
  publicDir: false,
  define: {
    __IJIPU_CLI_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'node18',
    minify: false,
    sourcemap: false,
    emptyOutDir: true,
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    lib: {
      entry: fileURLToPath(new URL('./src/nodeEntry.ts', import.meta.url)),
      formats: ['cjs'],
      fileName: () => 'ijipu.cjs',
    },
    rollupOptions: {
      // 只外置 node 内置模块；引擎与 CLI 逻辑全部打进单文件 ✓
      external: ['node:fs', 'node:fs/promises', 'node:path', 'fs', 'fs/promises', 'path'],
      output: {
        // bin 脚本必须有 shebang（POSIX 下由它决定用 node 执行；Windows 由 npm 的 .cmd 垫片负责 ✓）
        banner: '#!/usr/bin/env node',
      },
    },
  },
})
