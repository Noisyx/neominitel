// Hook 1: on save in src/modem/**, run the FAST tests of tests/properties/v23-modem.test.ts.
// Fast mode = NEOMINITEL_SLOW unset. Never blocks (always exits 0); the test output is the report.
import { existsSync } from 'node:fs';
import { rel, skip, runNpx } from './lib.mjs';

const HOOK = 'hook 1 modem fast tests';
const TEST = 'tests/properties/v23-modem.test.ts';

if (!existsSync(rel('package.json'))) skip(HOOK, 'no package.json yet (scaffold, modem task 1)');
if (!existsSync(rel('node_modules'))) skip(HOOK, 'dependencies not installed (run npm install)');
if (!existsSync(rel(TEST))) skip(HOOK, `${TEST} does not exist yet`);

delete process.env.NEOMINITEL_SLOW;
const code = runNpx(['vitest', 'run', TEST]);
console.log(`[${HOOK}] vitest exit code ${code}`);
process.exit(0);
