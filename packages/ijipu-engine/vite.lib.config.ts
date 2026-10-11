import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

/**
 * @ijipu/engine 独立可引入产物构建（lib ESM + d.ts）
 * 用法（项目根）：npx vite build --config packages/ijipu-engine/vite.lib.config.ts && npx tsc -p packages/ijipu-engine/tsconfig.json
 *   - vite  : 打包单文件 ESM 到 packages/ijipu-engine/dist/engine/index.js（engine 零第三方运行时依赖）
 *   - tsc   : 产出对应的 dist/engine/*.d.ts 类型声明
 * Obsidian / 外部宿主可 import '@ijipu/engine' 使用 parseJps/layoutScore/renderScoreToSvg 等。
 */
export default defineConfig({
  /**
   * ⚠ 必须关掉（**顶层**选项，不在 build 里）：vite 的 root 是项目根、`publicDir` 默认 = `<root>/public`，
   * 而 `public/` 里是应用的图标/示例谱/音色库 —— 输出目录落在包内的 lib 构建会把它们**整个拷进**
   * `packages/ijipu-engine/dist/`（实测本该只有 `dist/engine/`，却混着 `good.png`/`Jianpu.ico`/
   * `manifest.webmanifest`/`sw.js`，`npm pack` 会一起打包 ✗）。同族缺陷见 `E-2026-391`（CLI 包）。
   */
  publicDir: false,
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/engine/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: (format) => `engine/index.${format === 'es' ? 'js' : 'cjs'}`,
    },
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    minify: false,
    sourcemap: true,
  },
})
