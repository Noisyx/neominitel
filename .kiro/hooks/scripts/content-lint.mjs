// Hook 2: on save in content/pages/**, run the A6 content lint test (neominitel-app spec).
// The test file belongs to Role A; this hook only runs it, and skips cleanly while it is absent.
import { existsSync, readFileSync } from 'node:fs';
import { rel, skip, runNpx } from './lib.mjs';

const HOOK = 'hook 2 content lint (A6)';
const TEST = 'tests/properties/neominitel-app.test.ts';

if (!existsSync(rel('package.json'))) skip(HOOK, 'no package.json yet (scaffold, modem task 1)');
if (!existsSync(rel('node_modules'))) skip(HOOK, 'dependencies not installed (run npm install)');
if (!existsSync(rel(TEST))) skip(HOOK, `${TEST} does not exist yet`);
if (!/\bA6\b/.test(readFileSync(rel(TEST), 'utf8'))) skip(HOOK, `no test named A6 in ${TEST} yet`);

const code = runNpx(['vitest', 'run', TEST, '-t', 'A6']);
console.log(`[${HOOK}] vitest exit code ${code}`);
process.exit(0);
