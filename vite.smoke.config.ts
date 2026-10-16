/**
 * vite.smoke.config.ts — 把 `scripts/*.mts` 打包成 **Node 可跑的 CJS**（冒烟测试 / 渲染预览 / 命令行）。
 *
 * 运行：
 *   vite build --config vite.smoke.config.ts
 *   node dist-smoke/smoke.cjs    → 引擎冒烟测试
 *   node dist-smoke/cli-assert.cjs → 命令行机器闸门
 *   node dist-smoke/preview.cjs  → 生成样例谱的 SVG
 *   （**命令行本体**不在本文件里构建：见 `packages/ijipu-cli/vite.config.ts` / `npm run cli:build` ✓）
 *
 * ⚠ 本文件头部注释此前被"用 shell 改含中文文件"弄成了乱码（AGENTS §六之二·1 记过的那种损害）；
 *    这里按实际用途重写为准确描述 —— 之后**只用编辑工具**改本文件。
 */
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

/**
 * adj942：`cli-assert` 现在也**真跑一遍内嵌入口**（`packages/ijipu-cli/src/embedEntry.ts`），
 * 而内嵌入口的版本来自构建期 `define` 注入的宏（Node 版与内嵌版的 vite 配置各有一份）——
 * 这里补同一个宏，好让冒烟里 `--version` 报的是**真实版本**而不是兜底的 `'dev'` ✓。
 */
const cliPkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./packages/ijipu-cli/package.json', import.meta.url)), 'utf8'),
) as { version: string }

export default defineConfig({
  define: {
    __IJIPU_CLI_VERSION__: JSON.stringify(cliPkg.version),
  },
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
        // 命令行入口已独立成 `@ijipu/cli` 包（`packages/ijipu-cli/src/nodeEntry.ts`，
        // 由 `npm run cli:build` 产出 `packages/ijipu-cli/dist/ijipu.cjs`）——
        // 不再从这里出 `dist-smoke/cli.cjs`，避免同一份入口两处构建而漂移 ✓。
        // adj806（A·P1–P4 的机器闸门）：命令行断言套件 ⇒ `dist-smoke/cli-assert.cjs`
        'cli-assert': 'scripts/cli-assert.mts',
        /**
         * adj951：工作区"首次冷启动"竞态夹具 ⇒ `dist-smoke/adj951-cold-start.cjs`
         * （由 `smoke.mts` 起独立进程跑：`getWorkspace()` 的"首次加载"一个进程只发生一次，
         *  而 smoke 主进程早就 import 过 `docStore` ⇒ 必须另起一个进程才有冷态 ✓）
         */
        'adj951-cold-start': 'scripts/adj951ColdStart.mts',
      },
      formats: ['cjs'],
      fileName: (_format, entryName) => `${entryName}.cjs`,
    },
    rollupOptions: {
      // adj458：加重建内置模块 `node:zlib`（smoke 里解 PNG 的 IDAT，核对按钮图标的像素口径）
      // adj801：命令行入口用 `node:fs/promises`
      // adj874：cli-assert 要真的把 CLI 产物当命令跑一次（`execFileSync`）
      external: ['node:fs', 'node:fs/promises', 'node:url', 'node:path', 'node:zlib', 'node:child_process', 'fs', 'url', 'path', 'zlib'],
      /**
       * adj969（**构建期问题，与本次功能改动无关**）：**关掉 tree-shaking**。
       *
       * 为什么必须关：本配置有 4 个入口（smoke / preview / cli-assert / adj951-cold-start），
       * 引擎入口 `packages/ijipu-engine/src/engine/index.ts` 被它们共享。rolldown 8 在这种
       * "多入口 + 共享模块"的图里会把引擎入口里**谁都没用到的再导出**判成"不在任何 chunk 里"
       * 并**直接 panic 终止构建**（`error during build: [Panic in async function]`）：
       *
       * ```
       * thread '<unnamed>' panicked at crates\rolldown\src\module_finalizers\mod.rs:596:13:
       * SymbolRef { owner: 53, symbol: SymbolId(1) } "DEFAULT_NEW_JPS_BASE" is not in any chunk, which is unexpected
       * ```
       *
       * 触发条件**与功能改动无关**：往这张模块图里多挂**任意**一个模块就必现
       * （本轮用一个只有一行 `export const PROBE = 1` 的临时模块复现过；把报出来的那个符号
       * 在冒烟里用掉之后，它立刻换成下一个死再导出，如 `ASSET_MAX_EDGE` ⇒ 一个一个补是补不完的）。
       *
       * 只影响**测试产物**（`dist-smoke/*.cjs`）：应用本体的 `vite.config.ts` 是单入口、
       * 不受影响（本轮实测 `npx vite build` 正常）；断言一条不动（关掉 tree-shaking 只会让
       * 产物里多留代码，不会让任何 `check` 变绿或变红）。
       *
       * 其它试过但**不管用**的旋钮：`treeshake:'safest'`、把引擎整份钉进 `manualChunks`。
       * 上游相关修复（升级 rolldown/vite 后应重试并删掉本项）：
       * https://github.com/rolldown/rolldown/pull/9836 、 https://github.com/rolldown/rolldown/pull/9669
       */
      treeshake: false,
    },
  },
})