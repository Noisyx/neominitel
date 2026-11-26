import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/** Requirement 13.3: first load SHALL be under 1 MB of JavaScript (gzipped), excluding audio files. */
export const MAX_GZIPPED_JS_BYTES = 1_048_576;

export interface BundleAssetStat {
  readonly relPath: string;
  readonly rawBytes: number;
  readonly gzipBytes: number;
}

export interface BundleSizeReport {
  readonly ok: boolean;
  readonly distDir: string;
  readonly jsAssets: readonly BundleAssetStat[];
  readonly totalRawJsBytes: number;
  readonly totalGzipJsBytes: number;
  readonly maxAllowedGzipBytes: number;
  readonly issues: readonly string[];
}

function collectFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectFilesRecursive(full));
    } else if (st.isFile()) {
      out.push(full);
    }
  }
  return out.sort();
}

export function checkBundleSize(
  distDir = resolve(process.cwd(), 'dist'),
): BundleSizeReport {
  const issues: string[] = [];

  if (!existsSync(distDir)) {
    return {
      ok: false,
      distDir,
      jsAssets: [],
      totalRawJsBytes: 0,
      totalGzipJsBytes: 0,
      maxAllowedGzipBytes: MAX_GZIPPED_JS_BYTES,
      issues: [`Build directory not found: ${distDir} (run "npm run build" first)`],
    };
  }

  const indexHtmlPath = join(distDir, 'index.html');
  if (!existsSync(indexHtmlPath)) {
    issues.push('Missing dist/index.html static entry point');
  }

  const allFiles = collectFilesRecursive(distDir);
  const jsFiles = allFiles.filter(
    (f) => f.endsWith('.js') || f.endsWith('.mjs'),
  );
  if (jsFiles.length === 0) {
    issues.push('No JavaScript bundles found in dist/');
  }

  const jsAssets: BundleAssetStat[] = [];
  let totalRawJsBytes = 0;
  let totalGzipJsBytes = 0;

  for (const filePath of jsFiles) {
    const raw = readFileSync(filePath);
    const gz = gzipSync(raw, { level: 9 });
    const relPath = relative(distDir, filePath).replace(/\\/g, '/');
    jsAssets.push({
      relPath,
      rawBytes: raw.byteLength,
      gzipBytes: gz.byteLength,
    });
    totalRawJsBytes += raw.byteLength;
    totalGzipJsBytes += gz.byteLength;

    // Ensure raw RIFF/WAVE payloads were not accidentally inlined into JS bundles
    const text = raw.toString('latin1');
    if (text.includes('data:audio/wav;base64,')) {
      issues.push(`${relPath} contains inlined base64 WAV audio`);
    }
  }

  if (totalGzipJsBytes >= MAX_GZIPPED_JS_BYTES) {
    issues.push(
      `Total gzipped JS (${(totalGzipJsBytes / 1024).toFixed(2)} KiB) exceeds 1 MiB budget (${(
        MAX_GZIPPED_JS_BYTES / 1024
      ).toFixed(0)} KiB)`,
    );
  }

  return {
    ok: issues.length === 0,
    distDir,
    jsAssets,
    totalRawJsBytes,
    totalGzipJsBytes,
    maxAllowedGzipBytes: MAX_GZIPPED_JS_BYTES,
    issues,
  };
}

const isDirectCli =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectCli) {
  const report = checkBundleSize();
  for (const asset of report.jsAssets) {
    console.log(
      `  ${asset.relPath.padEnd(40)} raw: ${(asset.rawBytes / 1024)
        .toFixed(2)
        .padStart(7)} KiB | gzip: ${(asset.gzipBytes / 1024)
        .toFixed(2)
        .padStart(6)} KiB`,
    );
  }
  console.log(
    `\nTotal JS (excluding audio): ${(report.totalRawJsBytes / 1024).toFixed(
      2,
    )} KiB raw / ${(report.totalGzipJsBytes / 1024).toFixed(2)} KiB gzipped (limit < ${(
      report.maxAllowedGzipBytes / 1024
    ).toFixed(0)} KiB)`,
  );

  if (!report.ok) {
    for (const issue of report.issues) {
      console.error(`ERROR: ${issue}`);
    }
    process.exit(1);
  }
}
