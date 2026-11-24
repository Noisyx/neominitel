export interface AudioBlockInput {
  id: number;
  audio: Float32Array;
  startSample: number;
  onEnded?: (id: number) => void;
}

export interface GaplessPlayer {
  /** Ensures the AudioContext is created and resumed (call inside a user gesture). Returns active sampleRate. */
  ensureStarted(): Promise<number>;
  /** Current sample rate in Hz (defaults to 48000 before AudioContext creation). */
  getSampleRate(): number;
  /** Schedules a mono Float32Array block gaplessly on the sample timeline. */
  scheduleBlock(block: AudioBlockInput): void;
  /** Returns the cumulative sample index currently heard at the speakers. */
  currentSample(): number;
  /** Mutes/unmutes speaker output via GainNode while keeping the sample clock running. */
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  /** Stops all queued buffers immediately and resets the playback clock anchor. */
  stopAll(): void;
  /** Releases Web Audio resources. */
  dispose(): void;
}

type AudioContextConstructor = typeof AudioContext;

function getAudioContextCtor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const win = window as Window & { webkitAudioContext?: AudioContextConstructor };
  return window.AudioContext ?? win.webkitAudioContext ?? null;
}

/**
 * Gapless Web Audio block player with mute GainNode and sample-accurate playback clock.
 * Falls back cleanly to a `performance.now()` clock if Web Audio is unavailable.
 */
export function createGaplessPlayer(initialMuted = false): GaplessPlayer {
  let ctx: AudioContext | null = null;
  let gainNode: GainNode | null = null;
  let muted = initialMuted;
  let sampleRate = 48000;

  // Maps stream sample 0 to `anchorTimeSec` on the active clock (AudioContext.currentTime or performance.now()/1000)
  let anchorTimeSec: number | null = null;
  let fallbackNextTimeSec = 0;

  const activeSources = new Set<AudioBufferSourceNode>();
  const activeTimers = new Set<number>();

  function nowClockSec(): number {
    if (ctx) {
      return ctx.currentTime;
    }
    return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  }

  return {
    async ensureStarted(): Promise<number> {
      if (!ctx) {
        const Ctor = getAudioContextCtor();
        if (Ctor) {
          try {
            ctx = new Ctor();
            sampleRate = ctx.sampleRate;
            gainNode = ctx.createGain();
            gainNode.gain.value = muted ? 0 : 1;
            gainNode.connect(ctx.destination);
          } catch {
            ctx = null;
            gainNode = null;
          }
        }
      }
      if (ctx && ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch {
          // Ignore autoplay rejection; clock fallback handles restricted environments
        }
      }
      return sampleRate;
    },

    getSampleRate(): number {
      return sampleRate;
    },

    scheduleBlock({ id, audio, startSample, onEnded }): void {
      if (audio.length === 0) {
        onEnded?.(id);
        return;
      }

      if (ctx && gainNode) {
        const now = ctx.currentTime;
        const lookahead = anchorTimeSec === null ? 0.02 : 0.005;
        const idealStart =
          anchorTimeSec === null
            ? now + lookahead
            : anchorTimeSec + startSample / sampleRate;
        const playAt = idealStart < now ? now + lookahead : idealStart;
        anchorTimeSec = playAt - startSample / sampleRate;

        const buffer = ctx.createBuffer(1, audio.length, sampleRate);
        buffer.getChannelData(0).set(audio);

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(gainNode);
        activeSources.add(source);

        source.onended = () => {
          activeSources.delete(source);
          source.disconnect();
          onEnded?.(id);
        };

        source.start(playAt);
        return;
      }

      // Fallback wall-clock scheduling when AudioContext is unavailable
      const nowSec = nowClockSec();
      const idealStart =
        anchorTimeSec === null
          ? nowSec + 0.01
          : Math.max(fallbackNextTimeSec, anchorTimeSec + startSample / sampleRate);
      const playAt = Math.max(nowSec, idealStart);
      anchorTimeSec = playAt - startSample / sampleRate;
      const durationSec = audio.length / sampleRate;
      fallbackNextTimeSec = playAt + durationSec;

      if (typeof window !== 'undefined') {
        const delayMs = Math.max(0, (fallbackNextTimeSec - nowSec) * 1000);
        const timerId = window.setTimeout(() => {
          activeTimers.delete(timerId);
          onEnded?.(id);
        }, delayMs);
        activeTimers.add(timerId);
      } else {
        onEnded?.(id);
      }
    },

    currentSample(): number {
      if (anchorTimeSec === null) {
        return 0;
      }
      const elapsedSec = nowClockSec() - anchorTimeSec;
      if (elapsedSec <= 0) {
        return 0;
      }
      return Math.floor(elapsedSec * sampleRate);
    },

    setMuted(nextMuted: boolean): void {
      muted = nextMuted;
      if (ctx && gainNode) {
        gainNode.gain.setValueAtTime(muted ? 0 : 1, ctx.currentTime);
      }
    },

    isMuted(): boolean {
      return muted;
    },

    stopAll(): void {
      for (const src of activeSources) {
        src.onended = null;
        try {
          src.stop();
        } catch {
          // Already stopped
        }
        src.disconnect();
      }
      activeSources.clear();

      if (typeof window !== 'undefined') {
        for (const t of activeTimers) {
          window.clearTimeout(t);
        }
      }
      activeTimers.clear();

      anchorTimeSec = null;
      fallbackNextTimeSec = 0;
    },

    dispose(): void {
      this.stopAll();
      if (ctx) {
        void ctx.close();
        ctx = null;
        gainNode = null;
      }
    },
  };
}
