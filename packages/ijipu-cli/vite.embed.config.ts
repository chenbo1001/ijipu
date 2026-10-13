/**
 * packages/ijipu-cli/vite.embed.config.ts — **内嵌 CLI 产物**的构建（adj942）
 *
 * 产出 `dist/ijipu-embed.js`：**单个 IIFE 脚本**（无 import/export、无 `node:*`），
 * 由 `src-tauri/src/cli_embed.rs` 用 `include_bytes!` 编进 `ijipu.exe`，
 * 再交给内嵌的 QuickJS 跑（宿主注入 `__ijipuHost`，见 `src/embedEntry.ts`）。
 *
 * 为什么**另起一份配置**（而不是给现有 `vite.config.ts` 加一个入口）：
 *   ① 现有产物 `dist/ijipu.cjs` 是**对外承诺**（Node 用户的 `bin: ijipu`、`cli-assert` 的断言都指它）
 *      —— 它必须保持 CJS + shebang + `node:fs` 外置，**不能**被这次改动碰 ✓；
 *   ② 本产物的运行环境是 QuickJS：**格式（iife，可被 `eval` 直接跑）**、**目标（es2020，
 *      QuickJS 的语法档位）**、**是否压缩（压，进 exe 的体积要省）** 三条都与 Node 版不同。
 *
 * 用法（项目根）：`npm run cli:embed`
 * ⚠ 顺序：本配置 `emptyOutDir: false` —— 反过来 `cli:build`（`emptyOutDir: true`）会清目录，
 *   所以**先 `cli:build` 再 `cli:embed`**（`npm run smoke` 与 `tauri.conf.json` 的
 *   `beforeBuildCommand` 都按这个顺序串好了 ✓）。
 */
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string }

export default defineConfig({
  resolve: {
    // 与另外两份配置同口径：引擎走**源码**（数值口径同源 ✓）
    alias: [
      { find: /^@ijipu\/engine$/, replacement: fileURLToPath(new URL('../ijipu-engine/src/engine/index.ts', import.meta.url)) },
      { find: /^@ijipu\/engine\//, replacement: fileURLToPath(new URL('../ijipu-engine/src/engine/', import.meta.url)) },
    ],
  },
  // 关掉（与 `vite.config.ts` 同一原因）：`public/` 里是应用的图标/示例谱/音色库，本包只要一个文件 ✓
  publicDir: false,
  define: {
    // 与 Node 版同一个宏：内嵌版报的版本号也必须等于 APP_VERSION（cli-assert 守着这条 ✓）
    __IJIPU_CLI_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    // QuickJS 的口径是 ES2020 ⇒ 语法一律降到这一档（新语法不保证 QuickJS 认得）
    target: 'es2020',
    // 压缩：这份产物要**进 exe**，体积直接体现在安装包上（口径见 docs/CLI.md §一之二）
    // ⚠ 本仓库的 vite 是 **rolldown-vite**（`minify: 'esbuild'` 会去 import 未安装的 esbuild ⇒ 直接失败），
    //   用 `true`（= oxc 压缩器）✓
    minify: true,
    sourcemap: false,
    // 关键：**不许清目录** —— `dist/` 里还有 `ijipu.cjs`（Node 版产物）
    emptyOutDir: false,
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    lib: {
      entry: fileURLToPath(new URL('./src/embedEntry.ts', import.meta.url)),
      // iife：不用模块加载器，宿主 `eval` 一段脚本即可（QuickJS 侧零 loader 配置 ✓）
      formats: ['iife'],
      name: 'IjipuEmbedCli',
      fileName: () => 'ijipu-embed.js',
    },
  },
})
