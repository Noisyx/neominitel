// Demo (task 4): writes a listenable V.23 transmission to prototypes/dsp/out/ (git-ignored).
// Run from the repository root:  npx tsx prototypes/dsp/demo-wav.ts [sampleRate]
// Output: connection sequence (answer tone, silence, carrier) then "3615 SOMMAIRE" at 1200 baud,
// mono 16-bit PCM. The file is read back with readWav to check the round trip.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectionSequence, modulate, readWav, writeWav } from '../../src/modem';

const sampleRate = Number(process.argv[2] ?? 48000);
const text = '3615 SOMMAIRE';

const intro = connectionSequence({ sampleRate });
if (intro.length === 0) throw new Error(`connectionSequence rejected sampleRate ${sampleRate}`);
const page = modulate(Uint8Array.from(text, (c) => c.charCodeAt(0)), { sampleRate });
if (!page.ok) throw new Error(`modulate failed: ${JSON.stringify(page.error)}`);

const signal = new Float32Array(intro.length + page.value.length);
signal.set(intro, 0);
signal.set(page.value, intro.length);

const wav = writeWav(signal, sampleRate);
if (!wav.ok) throw new Error(`writeWav failed: ${JSON.stringify(wav.error)}`);

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(outDir, { recursive: true });
const path = join(outDir, `demo-3615-sommaire-${sampleRate}.wav`);
writeFileSync(path, wav.value);

const back = readWav(readFileSync(path));
if (!back.ok) throw new Error(`readWav failed: ${JSON.stringify(back.error)}`);
let maxErr = 0;
for (let i = 0; i < signal.length; i++) maxErr = Math.max(maxErr, Math.abs(back.value.samples[i] - signal[i]));

console.log(`wrote ${path}`);
console.log(
  `${wav.value.length} bytes, ${(signal.length / sampleRate).toFixed(3)} s at ${sampleRate} Hz ` +
    `(connection ${(intro.length / sampleRate).toFixed(3)} s + "${text}" ${(page.value.length / sampleRate).toFixed(3)} s)`,
);
console.log(`read back: ${back.value.samples.length} samples at ${back.value.sampleRate} Hz, max |error| = ${maxErr.toExponential(3)} (bound 0.5/32768 = ${(0.5 / 32768).toExponential(3)})`);
