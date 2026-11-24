// Hook 4: when a design.md changes, check that every correctness property (M1, V3, H2...)
// of every spec has a test whose name starts with the same ID, and report the missing ones.
// Read-only: it never edits a spec or a test. Always exits 0.
//
// A property is found in the "## Correctness properties" table of .kiro/specs/<spec>/design.md:
//   | M13 `[STRETCH]` | ... |
// A test "covers" ID X when a test name string in tests/**/*.test.ts starts with "X " (or equals X),
// for example it('M1 modulate-demodulate round-trip', ...).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { rel } from './lib.mjs';

const SPECS = rel('.kiro/specs');
const TESTS = rel('tests');

function properties(designText) {
  const out = [];
  const start = designText.search(/^## Correctness properties\s*$/m);
  if (start < 0) return out;
  const rest = designText.slice(start).split(/\r?\n/).slice(1);
  for (const line of rest) {
    if (/^## /.test(line)) break;
    const m = /^\|\s*([A-Z]{1,2}\d+)\b([^|]*)\|/.exec(line);
    if (m) out.push({ id: m[1], stretch: /STRETCH/.test(m[2]) });
  }
  return out;
}

function testFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...testFiles(p));
    else if (/\.test\.[cm]?[jt]sx?$/.test(name)) out.push(p);
  }
  return out;
}

const names = [];
for (const f of testFiles(TESTS)) {
  const src = readFileSync(f, 'utf8');
  const re = /\b(?:it|test|describe)(?:\.\w+)*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  let m;
  while ((m = re.exec(src))) names.push(m[2]);
}

let missingTotal = 0;
const specs = existsSync(SPECS) ? readdirSync(SPECS).filter((s) => existsSync(join(SPECS, s, 'design.md'))) : [];
for (const spec of specs.sort()) {
  const props = properties(readFileSync(join(SPECS, spec, 'design.md'), 'utf8'));
  const covered = (id) => names.some((n) => n === id || n.startsWith(id + ' '));
  const missing = props.filter((p) => !p.stretch && !covered(p.id)).map((p) => p.id);
  const stretch = props.filter((p) => p.stretch && !covered(p.id)).map((p) => p.id);
  missingTotal += missing.length;
  console.log(
    `[hook 4 property coverage] ${spec}: ${props.length} properties, ` +
      `${props.length - missing.length - stretch.length} covered, ` +
      `missing: ${missing.length ? missing.join(', ') : 'none'}` +
      (stretch.length ? `; STRETCH without test (allowed): ${stretch.join(', ')}` : ''),
  );
}
console.log(`[hook 4 property coverage] ${missingTotal} MVP properties without a test of the same name.`);
process.exit(0);
