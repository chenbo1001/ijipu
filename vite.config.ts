import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

/**
 * adj876（官网分层）：改成**多页面**构建。
 *
 * 原来只有根 `index.html`（就是应用本身）。现在有五份 HTML，各自对应一个入口：
 *
 * | 产物 | URL | 是什么 | 入口脚本 |
 * |---|---|---|---|
 * | `dist/index.html` | `/` | 介绍首页 | `src/landing/main.ts`（无 React） |
 * | `dist/app/index.html` | `/app/` | **应用**（原来的根 index.html） | `src/main.tsx` |
 * | `dist/manual/index.html` | `/manual/` | 操作手册（网页版） | `src/docs/manual.ts` |
 * | `dist/syntax/index.html` | `/syntax/` | 脚本语法说明（网页版） | `src/docs/syntax.ts` |
 * | `dist/plugin/index.html` | `/plugin/` | **插件手册**（Obsidian 插件，adj905x 用户要求） | `src/docs/plugin.ts` |
 *
 * 注意几点：
 *  · 资源引用一律是绝对路径（Vite 默认 `base: '/'`）⇒ Cloudflare Pages、PWA、
 *    桌面壳（`http://tauri.localhost/`）三处都能正确解析子路径页面里的 `/assets/...`。
 *  · `app/index.html` 同时被 **Obsidian 嵌入版**（`vite.config.embed.mjs`）当入口用，
 *    所以它是"应用外壳"的**唯一来源**——不要再单独复制一份。
 *  · 五份 HTML 的 `<title>` 各不相同，有 smoke 断言守着（改漏会红灯）。
 */
const entry = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@ijipu\/engine$/, replacement: fileURLToPath(new URL('./packages/ijipu-engine/src/engine/index.ts', import.meta.url)) },
      { find: /^@ijipu\/engine\//, replacement: fileURLToPath(new URL('./packages/ijipu-engine/src/engine/', import.meta.url)) },
    ],
  },
  build: {
    rollupOptions: {
      input: {
        landing: entry('./index.html'),
        app: entry('./app/index.html'),
        manual: entry('./manual/index.html'),
        syntax: entry('./syntax/index.html'),
        plugin: entry('./plugin/index.html'),
      },
    },
  },
})
