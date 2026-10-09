/**
 * vite.verify.config.ts — 把**插件预览层源码**打成浏览器可用的 IIFE（仅用于真机行为验证）
 *
 * 为什么需要：`scorePane.ts` 的裁剪逻辑依赖真实 DOM API（`getBBox()`），
 * 而 `npm run smoke` 跑在 Node 里、没有 DOM ⇒ 那段逻辑**永远不会被执行到**（会走"测不到就退回按边距裁"的分支）。
 * 这个产物让同一份源码在**真实 Chrome** 里跑，从而能对"只显示内容部分"做行为验证。
 *
 * 产物只写 `dist-preview/`（临时验证目录），不参与发布。
 */
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@ijipu\/engine$/, replacement: fileURLToPath(new URL('./packages/ijipu-engine/src/engine/index.ts', import.meta.url)) },
      { find: /^@ijipu\/engine\//, replacement: fileURLToPath(new URL('./packages/ijipu-engine/src/engine/', import.meta.url)) },
      // 插件的 scorePane 从 ../vendor/engine 引引擎；这里指回应用仓库的同一份源码
      { find: /^\.\.\/vendor\/engine$/, replacement: fileURLToPath(new URL('./packages/ijipu-engine/src/engine/index.ts', import.meta.url)) },
      /**
       * 两处替身（只为让浏览器构建通过，**不参与发布**）：
       * ① `obsidian`：宿主模块，浏览器里没有 → 换成本仓库的最小替身；
       * ② `./main` / `../src/main`：scorePane 只取两个事件常量，真 main.ts 会牵进
       *    `spessasynth_processor.min.js`（worklet）等与本次验证无关、且在浏览器构建里会报
       *    `MISSING_EXPORT` 的东西 → 换成只导出常量的替身。
       */
      { find: /^obsidian$/, replacement: fileURLToPath(new URL('./scripts/verify-stubs/obsidian.ts', import.meta.url)) },
      { find: /(^|\/)\.\.\/main$/, replacement: fileURLToPath(new URL('./scripts/verify-stubs/main.ts', import.meta.url)) },
      { find: /(^|\/)\.\/main$/, replacement: fileURLToPath(new URL('./scripts/verify-stubs/main.ts', import.meta.url)) },
    ],
  },
  build: {
    outDir: 'dist-preview',
    emptyOutDir: false,
    target: 'chrome120',
    minify: false,
    sourcemap: false,
    lib: {
      entry: fileURLToPath(new URL('../obsidian-ijipu/src/scorePane.ts', import.meta.url)),
      formats: ['iife'],
      name: 'IJipuPane',
      fileName: () => 'ijipu-pane.js',
    },
    rollupOptions: {
      // 不再把 obsidian 标 external：已用上面的 alias 换成本仓库替身
      external: [],
    },
  },
})
