// Shared helpers for the NeoMinitel Kiro hook scripts.
// Plain Node, zero dependencies. Every script exits 0: hooks report, they never block.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

/** Workspace root: hooks run from the workspace root; fall back to two levels above this file. */
export const ROOT = existsSync(resolve(process.cwd(), '.kiro'))
  ? process.cwd()
  : resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..', '..', '..');

export function rel(p) {
  return resolve(ROOT, p);
}

/** Print one clear "skipped" line and exit 0. */
export function skip(hook, reason) {
  console.log(`[${hook}] skipped: ${reason}`);
  process.exit(0);
}

/**
 * Run an npm-installed binary through npx without going through PowerShell's npx.ps1
 * (blocked by the default execution policy on Windows). Returns the exit code.
 */
export function runNpx(args, env = {}) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const r = spawnSync(npx, ['--no-install', ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });
  if (r.error) {
    console.log(`could not start ${npx}: ${r.error.message}`);
    return 1;
  }
  return r.status ?? 1;
}
