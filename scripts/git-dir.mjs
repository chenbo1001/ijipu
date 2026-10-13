/**
 * scripts/git-dir.mjs — 定位 git 目录（**普通克隆 与 `git worktree` 的链接工作树都支持**）
 *
 * ## 为什么需要它
 *
 * `scripts/gen-build-info.mjs` 要读 `.git/HEAD` 与**提交对象**（拿到"该提交自身的日期"，
 * 好让"同一提交 ⇒ 同一产物"成立，见 `adj772`）。而两种检出形态长得**不一样**：
 *
 * | 形态 | `.git` 是什么 | 对象库在哪 |
 * |---|---|---|
 * | 普通克隆 / 主工作区 | **目录** | `<root>/.git/objects` |
 * | `git worktree add` 的链接工作树 | **文件**，内容是 `gitdir: <主仓库>/.git/worktrees/<名>` | `<gitdir>/commondir` 指过去（通常是主仓库的 `.git`） |
 *
 * 旧写法 `readFileSync(join(root, '.git', 'HEAD'))` 在工作树里**直接抛异常** ⇒ 构建信息退化成
 * `dev` / `未知日期`。而嵌入版产物（`obsidian-ijipu/src/gen/webappAssets.ts`）是把
 * **当时的构建信息一起冻进插件仓库**的 ⇒ 这种退化会**永久留在插件里**（`E-2026-374` 同族）。
 *
 * ## 为什么做成"注入 fs 的纯函数"
 *
 * 是为了让 `npm run smoke` 能用**假的文件系统**把两种形态都断言掉（含负对照），
 * 不必真去建一个工作树（冒烟必须是纯的、可复现的、不碰 git）。
 */
import { join, resolve } from 'node:path'
import { readFileSync, statSync, existsSync } from 'node:fs'

/** 注入的 fs 子集（冒烟用假的；真实调用不传就走 node:fs） */
export const realFs = { readFileSync, statSync, existsSync }

/**
 * 解析仓库的 git 目录。
 *
 * @param {string} root 仓库根（含 `.git` 的那一层）
 * @param {{ readFileSync: Function, statSync: Function, existsSync: Function }} [fs]
 * @returns {{ gitDir: string, commonDir: string } | null}
 *   `gitDir` = 读 `HEAD` 的地方；`commonDir` = **对象库**所在（`objects/` 在它下面）。
 *   读不到（不是 git 仓库 / `.git` 内容不认识）⇒ `null`，由调用方按"拿不到"处理（**不猜** ✗）。
 */
export function resolveGitDirs(root, fs = realFs) {
  const dotGit = join(root, '.git')
  /** ① 普通克隆：`.git` 是目录 ⇒ gitDir 与对象库都在这里 */
  try {
    if (fs.statSync(dotGit).isDirectory()) return { gitDir: dotGit, commonDir: dotGit }
  } catch {
    /**
     * ⚠ **这里不能 `return null`**（第一版就是这么写的，被冒烟的"工作树"断言当场抓出来）：
     * `.git` 是**文件**时 `statSync` 不会抛（stat 对文件也成功）—— 真正会抛的是**不存在**；
     * 但两种情况的处理**完全不同**，所以这里只是"没命中目录形态"，必须继续往下走，
     * 由下面那段读 `gitdir:` 去分辨"工作树文件"与"根本不是 git 仓库"。
     */
  }
  /** ② 链接工作树：`.git` 是文件，第一行 `gitdir: <路径>` */
  try {
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotGit, 'utf8'))
    if (m === null) return null
    const gitDir = resolve(root, m[1])
    /**
     * ③ 对象库：工作树的 gitdir 里只有一个 `commondir` 指回主仓库的 `.git`
     *    （没有这个文件时 gitdir 自己就是对象库 —— 那是"子模块/独立 gitdir"的形态）。
     */
    const commonMarker = join(gitDir, 'commondir')
    const commonDir = fs.existsSync(commonMarker) ? resolve(gitDir, fs.readFileSync(commonMarker, 'utf8').trim()) : gitDir
    return { gitDir, commonDir }
  } catch {
    return null
  }
}
