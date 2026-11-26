export interface AudioBlockInput {
  id: number;
  audio: Float32Array;
  startSample: number;
  /** Optional buffer sample rate (e.g. 16000 Hz when playing a WAV file on a 48000 Hz AudioContext). */
  sampleRate?: number;
  onEnded?: (id: number) => void;
}

export interface GaplessPlayer {
  /** Synchronously creates and unlocks the AudioContext inside a DOM user gesture (pointerdown/keydown/click). */
  unlockFromGesture(): void;
  /** Ensures the AudioContext is created and attempts to resume it without ever hanging if autoplay is blocked. */
  ensureStarted(): Promise<number>;
  /** Current hardware AudioContext sample rate in Hz (defaults to 48000 before AudioContext creation). */
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
  /** Closes and recreates the AudioContext on next playback (recovers CoreAudio/Safari after mic capture). */
  resetContext(): void;
  /** Releases Web Audio resources. */
  dispose(): void;
}

export interface GaplessPlayerOptions {
  initialMuted?: boolean;
  audioContextCtor?: AudioContextConstructor | null;
  resumeTimeoutMs?: number;
}

export type AudioContextConstructor = new (
  contextOptions?: AudioContextOptions,
) => AudioContext;

function getAudioContextCtor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const win = window as Window & { webkitAudioContext?: AudioContextConstructor };
  return (window.AudioContext ?? win.webkitAudioContext ?? null) as AudioContextConstructor | null;
}

function wallNowSec(): number {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
}

function isContextRunning(ctx: AudioContext | null): boolean {
  return ctx !== null && (ctx.state as string) === 'running';
}

function isContextClosed(ctx: AudioContext | null): boolean {
  return ctx !== null && (ctx.state as string) === 'closed';
}

/**
 * Resamples a mono block from `fromRate` to the hardware `AudioContext.sampleRate` (`toRate`)
 * using exact cumulative sample boundaries so consecutive blocks never drift or click,
 * and `AudioContext.createBuffer` always runs at the native hardware sample rate.
 */
export function resampleBlockForPlayback(
  audio: Float32Array,
  startSample: number,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (audio.length === 0 || fromRate <= 0 || toRate <= 0 || fromRate === toRate) {
    return audio;
  }
  const outStart = Math.round((startSample * toRate) / fromRate);
  const outEnd = Math.round(((startSample + audio.length) * toRate) / fromRate);
  const outLen = Math.max(1, outEnd - outStart);
  const out = new Float32Array(outLen);
  const ratio = fromRate / toRate;
  const maxIdx = audio.length - 1;

  for (let i = 0; i < outLen; i++) {
    const srcPos = (outStart + i) * ratio - startSample;
    if (srcPos <= 0) {
      out[i] = audio[0];
    } else if (srcPos >= maxIdx) {
      out[i] = audio[maxIdx];
    } else {
      const idx = Math.floor(srcPos);
      const frac = srcPos - idx;
      const s0 = audio[idx];
      const s1 = audio[idx + 1];
      out[i] = s0 + (s1 - s0) * frac;
    }
  }
  return out;
}

/**
 * Gapless Web Audio block player with mute GainNode, synchronous gesture unlock,
 * Safari `'interrupted'` recovery, native-rate resampling, and non-blocking clock fallback.
 */
export function createGaplessPlayer(
  initialMutedOrOptions: boolean | GaplessPlayerOptions = false,
): GaplessPlayer {
  const opts: GaplessPlayerOptions =
    typeof initialMutedOrOptions === 'boolean'
      ? { initialMuted: initialMutedOrOptions }
      : initialMutedOrOptions;

  let ctx: AudioContext | null = null;
  let gainNode: GainNode | null = null;
  let muted = opts.initialMuted ?? false;
  let sampleRate = 48000;
  let streamSampleRate = 48000;
  const resumeTimeoutMs = opts.resumeTimeoutMs ?? 150;

  // Maps stream sample 0 to `anchorTimeSec` on the active clock ('ctx' when AudioContext is running, 'wall' otherwise)
  let anchorTimeSec: number | null = null;
  let clockMode: 'ctx' | 'wall' | null = null;
  let fallbackNextTimeSec = 0;

  const activeSources = new Set<AudioBufferSourceNode>();
  const activeTimers = new Set<ReturnType<typeof setTimeout>>();

  function applyGain(): void {
    if (!ctx || !gainNode) {
      return;
    }
    const target = muted ? 0 : 1;
    try {
      gainNode.gain.cancelScheduledValues(0);
    } catch {
      // Optional in minimal test doubles
    }
    gainNode.gain.value = target;
    try {
      gainNode.gain.setValueAtTime(target, ctx.currentTime);
    } catch {
      // Optional in minimal test doubles
    }
  }

  function ensureContextCreated(): AudioContext | null {
    if (ctx && !isContextClosed(ctx)) {
      return ctx;
    }
    const Ctor =
      opts.audioContextCtor !== undefined
        ? opts.audioContextCtor
        : getAudioContextCtor();
    if (!Ctor) {
      return null;
    }
    try {
      try {
        ctx = new Ctor({ latencyHint: 'interactive' });
      } catch {
        ctx = new Ctor();
      }
      sampleRate = ctx.sampleRate;
      gainNode = ctx.createGain();
      applyGain();
      gainNode.connect(ctx.destination);
      ctx.onstatechange = () => {
        if (isContextRunning(ctx)) {
          applyGain();
        }
      };
      return ctx;
    } catch {
      ctx = null;
      gainNode = null;
      return null;
    }
  }

  return {
    unlockFromGesture(): void {
      const activeCtx = ensureContextCreated();
      if (!activeCtx) {
        return;
      }
      applyGain();

      // Handles both 'suspended' and WebKit/Safari 'interrupted' states synchronously inside a user gesture
      if (!isContextRunning(activeCtx)) {
        try {
          const maybePromise = activeCtx.resume();
          if (maybePromise && typeof maybePromise.catch === 'function') {
            void maybePromise.catch(() => undefined);
          }
        } catch {
          // Ignore synchronous resume errors
        }

        try {
          if (gainNode) {
            const silent = activeCtx.createBuffer(1, 1, activeCtx.sampleRate);
            const unlockSource = activeCtx.createBufferSource();
            unlockSource.buffer = silent;
            unlockSource.connect(gainNode);
            unlockSource.start(0);
          }
        } catch {
          // Ignore if buffer scheduling is unavailable before running
        }
      }
    },

    async ensureStarted(): Promise<number> {
      this.unlockFromGesture();
      if (ctx && !isContextRunning(ctx)) {
        try {
          await Promise.race([
            Promise.resolve(ctx.resume()).catch(() => undefined),
            new Promise<void>((resolve) => {
              setTimeout(resolve, resumeTimeoutMs);
            }),
          ]);
        } catch {
          // Ignore autoplay rejection; wall-clock fallback keeps transmission running until next click
        }
      }
      applyGain();
      return sampleRate;
    },

    getSampleRate(): number {
      return sampleRate;
    },

    scheduleBlock({ id, audio, startSample, sampleRate: blockSampleRate, onEnded }): void {
      if (audio.length === 0) {
        onEnded?.(id);
        return;
      }

      const blockRate =
        blockSampleRate && blockSampleRate > 0 ? blockSampleRate : sampleRate;
      streamSampleRate = blockRate;

      const activeCtx = ensureContextCreated();
      if (activeCtx && !isContextRunning(activeCtx)) {
        try {
          const p = activeCtx.resume();
          if (p && typeof p.catch === 'function') {
            void p.catch(() => undefined);
          }
        } catch {
          // Ignore if outside gesture
        }
      }

      if (activeCtx && gainNode && isContextRunning(activeCtx)) {
        if (clockMode !== 'ctx') {
          anchorTimeSec = null;
          clockMode = 'ctx';
        }
        const hwRate = activeCtx.sampleRate;
        const playbackAudio = resampleBlockForPlayback(
          audio,
          startSample,
          blockRate,
          hwRate,
        );
        const hwStartSample = Math.round((startSample * hwRate) / blockRate);

        const now = activeCtx.currentTime;
        const lookahead = anchorTimeSec === null ? 0.02 : 0.005;
        const idealStart =
          anchorTimeSec === null
            ? now + lookahead
            : anchorTimeSec + hwStartSample / hwRate;
        const playAt = idealStart < now ? now + lookahead : idealStart;
        anchorTimeSec = playAt - hwStartSample / hwRate;

        const buffer = activeCtx.createBuffer(1, playbackAudio.length, hwRate);
        buffer.getChannelData(0).set(playbackAudio);

        const source = activeCtx.createBufferSource();
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

      // Fallback wall-clock scheduling when AudioContext is unavailable or temporarily locked by autoplay
      if (clockMode !== 'wall') {
        anchorTimeSec = null;
        fallbackNextTimeSec = 0;
        clockMode = 'wall';
      }
      const nowSec = wallNowSec();
      const idealStart =
        anchorTimeSec === null
          ? nowSec + 0.01
          : Math.max(fallbackNextTimeSec, anchorTimeSec + startSample / blockRate);
      const playAt = Math.max(nowSec, idealStart);
      anchorTimeSec = playAt - startSample / blockRate;
      const durationSec = audio.length / blockRate;
      fallbackNextTimeSec = playAt + durationSec;

      const delayMs = Math.max(0, (fallbackNextTimeSec - nowSec) * 1000);
      const timerId = setTimeout(() => {
        activeTimers.delete(timerId);
        onEnded?.(id);
      }, delayMs);
      activeTimers.add(timerId);
    },

    currentSample(): number {
      if (anchorTimeSec === null) {
        return 0;
      }
      const nowSec =
        clockMode === 'ctx' && ctx ? ctx.currentTime : wallNowSec();
      const elapsedSec = nowSec - anchorTimeSec;
      if (elapsedSec <= 0) {
        return 0;
      }
      return Math.floor(elapsedSec * streamSampleRate + 1e-9);
    },

    setMuted(nextMuted: boolean): void {
      muted = nextMuted;
      applyGain();
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

      for (const t of activeTimers) {
        clearTimeout(t);
      }
      activeTimers.clear();

      anchorTimeSec = null;
      clockMode = null;
      fallbackNextTimeSec = 0;
    },

    resetContext(): void {
      this.dispose();
    },

    dispose(): void {
      this.stopAll();
      if (ctx) {
        ctx.onstatechange = null;
        try {
          void Promise.resolve(ctx.close()).catch(() => undefined);
        } catch {
          // Ignore close errors
        }
        ctx = null;
        gainNode = null;
      }
    },
  };
}
