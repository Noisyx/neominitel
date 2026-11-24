export interface ScheduledSampleEvent {
  atSample: number;
}

export interface EventScheduler<E extends ScheduledSampleEvent> {
  /** Enqueues timed events (preserving insertion order for ties in `atSample`). */
  enqueue(events: readonly E[]): void;
  /**
   * Releases and returns all queued events with `atSample <= currentPlaybackSample`,
   * ordered strictly by `(atSample, insertionOrder)`. Never emits an event early (Property A5).
   */
  drainUpTo(currentPlaybackSample: number): E[];
  /** Number of events still waiting for their playback sample. */
  pendingCount(): number;
  /** Discards all pending events. */
  clear(): void;
}

interface QueueEntry<E> {
  event: E;
  seq: number;
}

/**
 * Pure sample-synchronized event scheduler (Property A5).
 */
export function createEventScheduler<
  E extends ScheduledSampleEvent,
>(): EventScheduler<E> {
  const queue: QueueEntry<E>[] = [];
  let nextSeq = 0;

  return {
    enqueue(events: readonly E[]): void {
      if (events.length === 0) {
        return;
      }
      for (const ev of events) {
        queue.push({ event: ev, seq: nextSeq++ });
      }
      queue.sort(
        (a, b) => a.event.atSample - b.event.atSample || a.seq - b.seq,
      );
    },

    drainUpTo(currentPlaybackSample: number): E[] {
      if (!Number.isFinite(currentPlaybackSample) || queue.length === 0) {
        return [];
      }
      let cut = 0;
      while (cut < queue.length && queue[cut].event.atSample <= currentPlaybackSample) {
        cut++;
      }
      if (cut === 0) {
        return [];
      }
      const ready = queue.splice(0, cut);
      return ready.map((entry) => entry.event);
    },

    pendingCount(): number {
      return queue.length;
    },

    clear(): void {
      queue.length = 0;
    },
  };
}

/**
 * Drives an `EventScheduler` on every browser `requestAnimationFrame` against a sample clock.
 */
export function startRafScheduler<E extends ScheduledSampleEvent>(
  scheduler: EventScheduler<E>,
  getCurrentSample: () => number,
  onDueEvents: (events: E[]) => void,
): { stop(): void } {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return { stop: () => undefined };
  }

  let rafId: number | null = null;
  let active = true;

  const tick = (): void => {
    if (!active) return;
    const due = scheduler.drainUpTo(getCurrentSample());
    if (due.length > 0) {
      onDueEvents(due);
    }
    rafId = window.requestAnimationFrame(tick);
  };

  rafId = window.requestAnimationFrame(tick);

  return {
    stop(): void {
      active = false;
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
    },
  };
}
