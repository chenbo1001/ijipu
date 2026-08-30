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
