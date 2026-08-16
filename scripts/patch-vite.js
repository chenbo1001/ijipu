/**
 * patch-vite.js — DSH sandbox compatibility patch for Vite on Windows.
 *
 * Vite's windowsSafeRealPathSync() runs `exec("net use", ...)` once to probe
 * mapped network drives. Under the DSH file sandbox, spawning a child process
 * with piped stdio throws EPERM synchronously, which crashes `vite build`/`vite dev`
 * while loading the config. We wrap that probe in try/catch — on sandboxed
 * environments it is skipped entirely; everywhere else behaviour is unchanged.
 *
 * Idempotent: safe to run repeatedly. Run with: node scripts/patch-vite.js
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const target = join(__dirname, '..', 'node_modules', 'vite', 'dist', 'node', 'chunks', 'node.js');

const MARK = '/* dsh-sandbox: net use probe wrapped */';
const ORIGINAL = `	exec("net use", { windowsHide: true }, (error, stdout) => {`;
const PATCHED = `	try { exec("net use", { windowsHide: true }, (error, stdout) => {`;

if (!existsSync(target)) {
  console.error('[patch-vite] target not found:', target);
  process.exit(1);
}

let src = readFileSync(target, 'utf8');

if (src.includes(MARK)) {
  console.log('[patch-vite] already patched, nothing to do.');
  process.exit(0);
}

if (!src.includes(ORIGINAL)) {
  console.error('[patch-vite] expected marker not found — Vite may have been upgraded; inspect manually.');
  process.exit(1);
}

src = src.replace(ORIGINAL, `${PATCHED} ${MARK}`);
// close the try block before the function's closing brace
src = src.replace(
  `		if (windowsNetworkMap.size === 0) safeRealpathSync = fs.realpathSync.native;\n		else safeRealpathSync = windowsMappedRealpathSync;\n	});\n}`,
  `		if (windowsNetworkMap.size === 0) safeRealpathSync = fs.realpathSync.native;\n		else safeRealpathSync = windowsMappedRealpathSync;\n	}); } catch (e) { /* dsh-sandbox: spawn may be blocked */ }\n}`,
);

writeFileSync(target, src);
console.log('[patch-vite] patched OK.');
