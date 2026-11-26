# Design: fantome

## Overview
Two parts:
1. **Offline generation** (`scripts/generate-transmissions.ts`, Node): from `content/fantome/levels.json` and the level pages, it produces the WAV files and the manifest, and verifies every level.
2. **Runtime** (`src/services/fantome.ts` + `src/fantome/`): the 3615 FANTOME service reads the manifest, plays a level through the normal pipeline, checks codes and keeps the progress.

## Level source (`content/fantome/levels.json`, not served)

```ts
interface LevelSource {
  id: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  title: string;
  storyPage: string;              // PageSource id in content/pages/fantome.ts
  transmissionPage: string;       // PageSource id of the page carrying the code
  codeRow: number;                // row holding the code word
  code: string;                   // plain text, used only to compute the hash
  hint: string;
  damage:
    | { kind: 'clean' }
    | { kind: 'noise'; ebN0Db: number }
    | { kind: 'offset'; offsetHz: number; ebN0Db: number }
    | { kind: 'whisper'; ebN0Db: number; repeats: number; gapMs: number }
    | { kind: 'backward'; decoyPage: string; ebN0Db: number };
  feature: 'none' | 'parity' | 'adaptive' | 'vote' | 'backward';
  seed: number;                   // first seed to try
}
```

Starting values (to calibrate, task 5):
| Level | Damage |
|---|---|
| L1 | clean |
| L2 | noise, Eb/N0 ≈ 13.5 dB (initial draft: 10 dB; then 12.5 dB for ~17 parity erasures with CER = 0 on code row; raised to 13.5 dB by the task 5 simulated pre-calibration, because at 12.5 dB any new noise on an acoustic path breaks the code row about one time in two, see `docs/calibration.md` "FANTOME") |
| L3 | offset +380 Hz, Eb/N0 ≈ 18 dB |
| L4 | whisper, Eb/N0 ≈ 11.5 dB, 7 repeats, 1 s gaps (initial draft: 5 dB; adjusted for Curve-3 BER where 5 dB has 60% BER, while 11.5 dB gives 100% single-pass code-row CER and 0% 7-vote CER) |
| L5 | `[STRETCH]` backward channel carries the code page; forward carries a decoy page ("Il n'y a rien ici…") — added to `levels.json` in task 7 once `v23-modem` task 14 lands |

## Manifest (`public/transmissions/manifest.json`, served)

```ts
interface Manifest {
  version: 1;
  salt: string;                               // random hex, generated once
  levels: {
    id: string; title: string; hint: string;
    storyPage: string; wav: string;           // 'transmissions/L3.wav'
    feature: LevelSource['feature'];
    codeHash: string;                         // hex SHA-256(salt + normalize(code))
    seedUsed: number;
  }[];
}
```
`normalize(s)` = trim, lower case, NFD then remove combining marks, collapse spaces.
The hash is a deterrent, not real security: codes are short and the salt is public. This is acceptable for a game.

## Generation pipeline
For each level, for seed = `seed`, `seed + 1`, … (at most 50):
1. Encode `transmissionPage` with `videotex.encodePage`.
2. Modulate (forward). For `whisper`, repeat the page `repeats` times with `gapMs` of idle carrier. For `backward`, modulate the decoy page on the forward channel and the code page on the backward channel, then mix.
3. Apply the damage with `modem/channel.ts` and the seed.
4. Add the procedural drone: a sum of 3 sines between 55 and 220 Hz with slow random amplitude modulation, 20 dB below the modem signal. It stays below the 300 Hz edge of the backward band.
5. Normalize the peak to −1 dBFS, write the 16-bit WAV.
6. **Verify** by decoding the written WAV with the same pipeline as the app (Node, no Worker):
   - Feature on → code row CER = 0.
   - L3-L5: feature off → code row CER ≥ 50%.
   - L2: at least 1 error cell on the page, 0 on the code row.
7. On success, record the level; on failure, try the next seed.

"Feature on / off" means:
| Feature | On | Off |
|---|---|---|
| parity | default decoder | default decoder (no check) |
| adaptive | threshold `adaptive` | threshold `fixed` |
| vote | vote over all repetitions | last reception only |
| backward | backward demodulator enabled | forward only |

Defaults for all other levels: adaptive threshold on, vote on.

## Runtime
- `src/services/fantome.ts`: a `Service` with states `menu`, `story(level)`, `receiving(level)`, `answer(level)`, `success(level)`, `final`.
  - *Envoi* on a story page starts the transmission; *Suite* after reception goes to the answer page with an input field.
  - *Guide* shows the level's hint.
- The service asks the app to play a WAV instead of sending bytes: `ServiceOutput` gets an optional `{ playWav: string; simulate: false }`. The app's worker decodes the WAV in real-time file mode (scheduled reveal). The field is declared in the `neominitel-app` design and wired by task 4.1 here. Receptions from a WAV join the vote by similarity matching, as in `Écoute` mode.
- For L5, the app enables the backward demodulator view in the HUD when the player turns on "Écoute voie retour".
- `src/fantome/progress.ts`: `{ unlocked: number }` in `localStorage`, every access wrapped in try/catch; without storage, progress lives in memory.
- `src/fantome/check.ts`: `await crypto.subtle.digest('SHA-256', salt + normalize(input))`, compared in hex.

## Correctness properties
| ID | Property |
|---|---|
| H1 | Determinism: running the generator twice gives byte-identical WAVs and manifest. |
| H2 | Solvable: for every level, decoding with the feature on gives the exact code row. |
| H3 | Necessary: for L3-L5, decoding with the feature off gives a code row CER ≥ 50%. |
| H4 | No leak: no file in `dist/` or `public/` contains any code (normalized or not) as a substring. |
| H5 | Check: for any string s, `check(s)` is true if and only if normalize(s) equals the normalized code. |
| H6 | Progress: the service never shows a level above `unlocked + 1`, and works when storage throws. |

H2 and H3 are checked by the generator at build time and again by a test that decodes the committed WAVs.

## Testing
- `tests/properties/fantome.test.ts`: H1 (small run), H4 on the build output, H5, H6.
- `scripts/generate-transmissions.ts --verify-only` in CI before deployment.
