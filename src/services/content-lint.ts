import {
  cellsEqual,
  decodeBytes,
  encodePage,
  PAGE_FIRST_ROW,
  PAGE_LAST_ROW,
  SCREEN_COLS,
  SCREEN_ROWS,
  type PageSource,
  type Screen,
} from '../videotex';

export const MAX_PAIRWISE_PAGE_SIMILARITY = 0.8;

/**
 * Computes the similarity between two 40x25 screens as the fraction of mutually non-error
 * cells that are equal (ignoring the `error` flag itself), per Requirement 7.4.
 */
export function screenSimilarity(a: Screen, b: Screen): number {
  let validPairs = 0;
  let equalPairs = 0;

  for (let r = 0; r < SCREEN_ROWS; r++) {
    for (let c = 0; c < SCREEN_COLS; c++) {
      const cellA = a.rows[r][c];
      const cellB = b.rows[r][c];
      if (cellA.error || cellB.error) {
        continue;
      }
      validPairs++;
      if (cellsEqual(cellA, cellB, true)) {
        equalPairs++;
      }
    }
  }

  return validPairs === 0 ? 0 : equalPairs / validPairs;
}

export interface ContentLintReport {
  ok: boolean;
  issues: string[];
  maxSimilarity: number;
}

/**
 * Validates a collection of `PageSource` definitions against Property A6:
 * - Unique `id`s
 * - Every row in `1..24`, at most 24 rows, row width `<= 40` cells
 * - Only supported Videotex characters (zero transliteration or delimiter warnings)
 * - Every pair of distinct pages has `< 80%` screen similarity
 */
export function lintPages(pages: readonly PageSource[]): ContentLintReport {
  const issues: string[] = [];
  const seenIds = new Set<string>();
  const decodedScreens: { id: string; screen: Screen }[] = [];

  for (const page of pages) {
    if (seenIds.has(page.id)) {
      issues.push(`Duplicate page id '${page.id}'`);
    }
    seenIds.add(page.id);

    if (page.rows.length > PAGE_LAST_ROW) {
      issues.push(`Page '${page.id}': more than ${PAGE_LAST_ROW} rows (${page.rows.length})`);
      continue;
    }

    for (const r of page.rows) {
      if (r.row < PAGE_FIRST_ROW || r.row > PAGE_LAST_ROW) {
        issues.push(`Page '${page.id}': row index ${r.row} outside 1..24`);
      }
    }

    const encoded = encodePage(page);
    if (!encoded.ok) {
      issues.push(`Page '${page.id}': encodePage failed (${JSON.stringify(encoded.error)})`);
      continue;
    }

    for (const warning of encoded.value.warnings) {
      issues.push(`Page '${page.id}': ${warning}`);
    }

    decodedScreens.push({
      id: page.id,
      screen: decodeBytes(encoded.value.bytes),
    });
  }

  let maxSimilarity = 0;
  for (let i = 0; i < decodedScreens.length; i++) {
    for (let j = i + 1; j < decodedScreens.length; j++) {
      const a = decodedScreens[i];
      const b = decodedScreens[j];
      const sim = screenSimilarity(a.screen, b.screen);
      if (sim > maxSimilarity) {
        maxSimilarity = sim;
      }
      if (sim >= MAX_PAIRWISE_PAGE_SIMILARITY) {
        issues.push(
          `Pages '${a.id}' and '${b.id}' are ${(sim * 100).toFixed(1)}% similar (must be < 80%)`,
        );
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    maxSimilarity,
  };
}
