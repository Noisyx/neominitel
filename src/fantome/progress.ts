export const FANTOME_STORAGE_KEY = 'neominitel.fantome.progress.v1';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface FantomeProgressStore {
  /** Number of cleared levels (`0` initially -> level `1` is accessible; `unlocked + 1` max). */
  readUnlocked(): number;
  /** Monotonically records cleared level count and returns the updated `unlocked` count. */
  recordUnlocked(unlocked: number): number;
  /** Resets stored progress to `0` (for tests or manual reset). */
  reset(): void;
}

/**
 * Resilient progress store keeping `{ unlocked: number }` in `localStorage` when available,
 * with every storage access wrapped in `try/catch` and an in-memory fallback (`Property H6`).
 */
export function createFantomeProgressStore(
  storageProvider?: StorageLike | (() => StorageLike | null | undefined) | null,
): FantomeProgressStore {
  let memoryUnlocked = 0;

  function resolveStorage(): StorageLike | null {
    try {
      if (typeof storageProvider === 'function') {
        return storageProvider() ?? null;
      }
      return storageProvider ?? null;
    } catch {
      return null;
    }
  }

  function sanitizeCount(val: unknown): number {
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      return 0;
    }
    return Math.max(0, Math.floor(val));
  }

  return {
    readUnlocked(): number {
      const storage = resolveStorage();
      if (!storage) {
        return memoryUnlocked;
      }
      try {
        const raw = storage.getItem(FANTOME_STORAGE_KEY);
        if (!raw) {
          return memoryUnlocked;
        }
        const parsed = JSON.parse(raw) as { unlocked?: unknown };
        const fromDisk = sanitizeCount(parsed?.unlocked);
        memoryUnlocked = Math.max(memoryUnlocked, fromDisk);
        return memoryUnlocked;
      } catch {
        return memoryUnlocked;
      }
    },

    recordUnlocked(unlocked: number): number {
      const next = Math.max(memoryUnlocked, sanitizeCount(unlocked));
      memoryUnlocked = next;
      const storage = resolveStorage();
      if (storage) {
        try {
          storage.setItem(
            FANTOME_STORAGE_KEY,
            JSON.stringify({ unlocked: next }),
          );
        } catch {
          // Storage quota exceeded or blocked: keep in-memory progress intact
        }
      }
      return memoryUnlocked;
    },

    reset(): void {
      memoryUnlocked = 0;
      const storage = resolveStorage();
      if (storage) {
        try {
          storage.setItem(
            FANTOME_STORAGE_KEY,
            JSON.stringify({ unlocked: 0 }),
          );
        } catch {
          // Ignore storage error
        }
      }
    },
  };
}
