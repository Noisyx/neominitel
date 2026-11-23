// Hook 3: when content/fantome/levels.json changes, run
// `scripts/generate-transmissions.ts --verify-only` (Role A's script) with tsx.
// Skips cleanly while the script or its runner is absent.
import { existsSync } from 'node:fs';
import { rel, skip, runNpx } from './lib.mjs';

const HOOK = 'hook 3 fantome levels verify';
const SCRIPT = 'scripts/generate-transmissions.ts';

if (!existsSync(rel('content/fantome/levels.json'))) skip(HOOK, 'content/fantome/levels.json does not exist yet');
if (!existsSync(rel(SCRIPT))) skip(HOOK, `${SCRIPT} does not exist yet`);
if (!existsSync(rel('node_modules/tsx'))) skip(HOOK, 'tsx is not installed (devDependency, decision A6)');

const code = runNpx(['tsx', SCRIPT, '--verify-only']);
console.log(`[${HOOK}] exit code ${code}`);
process.exit(0);
