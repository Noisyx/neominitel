/**
 * Normalizes a 3615 FANTOME code word per `fantome/design.md`:
 * trim, lower case, NFD decomposition with combining marks stripped, internal whitespace collapsed.
 */
export function normalizeFantomeCode(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}
