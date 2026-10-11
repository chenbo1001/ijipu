/**
 * vite.config.embed.mjs — **嵌入版**构建配置（产物用于打包进 Obsidian 插件）
 *
 * 与 `vite.config.ts`（网页版/PWA）的区别：
 *
 * | 项 | 网页版 | 嵌入版（本文件） |
 * |---|---|---|
 * | `base` | `/`（绝对路径） | **`./`**（产物被非根路径托管） |
 * | `publicDir` | `public/`（全量拷贝） | **`dist-embed/public`**（`scripts/embed-assets.mjs` 精简后） |
 * | 产物 | `dist/`（28 chunk + css + 资源） | **`dist-embed/`（单个 index.html）** |
 * | SW / manifest | 有 | **无**（iframe 里不需要 PWA） |
 *
 * 用法：`npm run build:embed`
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { embedInlinePlugin } from './scripts/embed-inline-plugin.mjs'

const publicDir = fileURLToPath(new URL('./dist-embed/public', import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    /** 必须放最后：它要拿到"所有 chunk 都已产出"的 bundle */
    embedInlinePlugin({ publicDir }),
  ],
  base: './',
  publicDir,
  resolve: {
    alias: [
      { find: /^@ijipu\/engine$/, replacement: fileURLToPath(new URL('./packages/ijipu-engine/src/engine/index.ts', import.meta.url)) },
      { find: /^@ijipu\/engine\//, replacement: fileURLToPath(new URL('./packages/ijipu-engine/src/engine/', import.meta.url)) },
    ],
  },
  build: {
    outDir: 'dist-embed-app',
    emptyOutDir: true,
    target: 'es2020',
    // 单文件产物：不要 sourcemap（会白占体积）
    sourcemap: false,
    rollupOptions: {
      /**
       * adj876（官网分层）：入口从根 `index.html` 改成 **`app/index.html`**。
       *
       * 根 `index.html` 现在是"介绍首页"，嵌入版要的是**应用**——`app/index.html` 才是
       * 应用外壳的唯一来源（网页版 `/app/`、桌面壳也都用它）。不改这一处的话，
       * Obsidian 笔记里渲染出来的会是介绍首页 ✗。
       *
       * ⚠ 产物路径随之变成 `dist-embed-app/app/index.html`（Vite 保留入口相对 root 的目录），
       *   所以下面这三个脚本里的路径要一起改，缺一处嵌入版就断：
       *   `scripts/embed-inline-plugin.mjs`、`scripts/embed-emit.mjs`、`scripts/embed-smoke.mjs`。
       */
      input: fileURLToPath(new URL('./app/index.html', import.meta.url)),
      /**
       * **关键**：让 rollup 自己把动态 `import()` 内联成"promise 化的内联模块"。
       *
       * 不能事后用文本替换去改 `import()`——那会同时破坏
       * "按需加载"语义与"返回值是 Promise"的约定（调用方 `.then()` 会炸）。
       * 交给 rollup ⇒ 只产出 1 个 JS chunk，`import()` 语义仍然正确。
       */
      output: { codeSplitting: false },
    },
  },
})
