import captureWorkletUrl from './capture.worklet?worker&url';

export const RAW_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

export interface RawAudioSettingsSummary {
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  sampleRate?: number;
  channelCount?: number;
}

export interface RawAudioCheckResult {
  rawOk: boolean;
  settings: RawAudioSettingsSummary;
  /** French explanation of ignored raw-audio constraints when `rawOk === false`. */
  warningMessage: string | null;
}

function formatFlagFr(val: boolean | undefined): string {
  if (val === true) return 'activé';
  if (val === false) return 'désactivé';
  return 'inconnu';
}

/**
 * Pure check inspecting `MediaTrackSettings` returned by the browser after requesting
 * `{ echoCancellation: false, noiseSuppression: false, autoGainControl: false }` (Req 10.2).
 */
export function evaluateRawAudioSettings(
  rawSettings: MediaTrackSettings | RawAudioSettingsSummary,
): RawAudioCheckResult {
  const settings: RawAudioSettingsSummary = {
    echoCancellation: rawSettings.echoCancellation,
    noiseSuppression: rawSettings.noiseSuppression,
    autoGainControl: rawSettings.autoGainControl,
    sampleRate: rawSettings.sampleRate,
    channelCount: rawSettings.channelCount,
  };

  const ignored =
    settings.echoCancellation === true ||
    settings.noiseSuppression === true ||
    settings.autoGainControl === true;

  if (!ignored) {
    return {
      rawOk: true,
      settings,
      warningMessage: null,
    };
  }

  const details = [
    `annulation d’écho : ${formatFlagFr(settings.echoCancellation)}`,
    `réduction de bruit : ${formatFlagFr(settings.noiseSuppression)}`,
    `gain automatique : ${formatFlagFr(settings.autoGainControl)}`,
  ].join(', ');

  return {
    rawOk: false,
    settings,
    warningMessage: `Attention : le navigateur applique un traitement audio qui peut dégrader le signal V.23 (${details}).`,
  };
}

export type CaptureErrorKind =
  | 'denied'
  | 'no-device'
  | 'insecure-context'
  | 'unsupported'
  | 'unknown';

export interface CaptureFailure {
  kind: CaptureErrorKind;
  message: string;
}

export function classifyCaptureError(err: unknown): CaptureFailure {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return {
      kind: 'insecure-context',
      message:
        'L’accès au microphone nécessite une page servie en HTTPS (ou localhost en développement).',
    };
  }

  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  if (
    name === 'NotAllowedError' ||
    name === 'PermissionDeniedError' ||
    name === 'SecurityError'
  ) {
    return {
      kind: 'denied',
      message: 'L’autorisation d’utiliser le microphone a été refusée.',
    };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return {
      kind: 'no-device',
      message: 'Aucun microphone n’a été détecté sur cet appareil.',
    };
  }
  return {
    kind: 'unknown',
    message:
      err instanceof Error
        ? `Impossible d’ouvrir le microphone (${err.message}).`
        : 'Impossible d’ouvrir le microphone.',
  };
}

export interface ActiveMicCapture {
  /** Port to transfer directly to `line.worker.ts` (`{ t: 'capturePort', port, sampleRate }`). */
  workerPort: MessagePort;
  sampleRate: number;
  rawCheck: RawAudioCheckResult;
  stop(): void;
}

export type StartCaptureResult =
  | { ok: true; value: ActiveMicCapture }
  | { ok: false; error: CaptureFailure };

type AudioContextConstructor = typeof AudioContext;

function getAudioContextCtor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null;
  const win = window as Window & { webkitAudioContext?: AudioContextConstructor };
  return window.AudioContext ?? win.webkitAudioContext ?? null;
}

/**
 * Requests raw microphone audio, checks `track.getSettings()`, instantiates the capture
 * `AudioWorkletNode`, and wires a direct `MessageChannel` to the DSP Web Worker.
 */
export async function startMicrophoneCapture(): Promise<StartCaptureResult> {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return {
      ok: false,
      error: {
        kind: 'insecure-context',
        message:
          'L’accès au microphone nécessite HTTPS (ou localhost en développement).',
      },
    };
  }

  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== 'function'
  ) {
    return {
      ok: false,
      error: {
        kind: 'unsupported',
        message: 'Ce navigateur ne prend pas en charge la capture microphone WebRTC.',
      },
    };
  }

  const Ctor = getAudioContextCtor();
  if (!Ctor) {
    return {
      ok: false,
      error: {
        kind: 'unsupported',
        message: 'Web Audio API indisponible sur ce navigateur.',
      },
    };
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: RAW_AUDIO_CONSTRAINTS,
      video: false,
    });
  } catch (err) {
    return { ok: false, error: classifyCaptureError(err) };
  }

  const track = stream.getAudioTracks()[0];
  const rawSettings = track && typeof track.getSettings === 'function'
    ? track.getSettings()
    : {};
  const rawCheck = evaluateRawAudioSettings(rawSettings);

  let ctx: AudioContext | null = null;
  try {
    ctx = new Ctor();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    if (!ctx.audioWorklet) {
      throw new Error('AudioWorklet non pris en charge');
    }

    await ctx.audioWorklet.addModule(captureWorkletUrl);

    const sourceNode = ctx.createMediaStreamSource(stream);
    const workletNode = new AudioWorkletNode(
      ctx,
      'neominitel-capture-processor',
      {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
      },
    );

    const channel = new MessageChannel();
    workletNode.port.postMessage(
      { t: 'attachPort', port: channel.port1 },
      [channel.port1],
    );
    sourceNode.connect(workletNode);

    let stopped = false;
    const activeCtx = ctx;

    return {
      ok: true,
      value: {
        workerPort: channel.port2,
        sampleRate: activeCtx.sampleRate,
        rawCheck,
        stop(): void {
          if (stopped) return;
          stopped = true;
          try {
            workletNode.port.postMessage({ t: 'stop' });
          } catch {
            // Port may already be closed
          }
          sourceNode.disconnect();
          workletNode.disconnect();
          for (const t of stream.getTracks()) {
            t.stop();
          }
          void activeCtx.close();
        },
      },
    };
  } catch (err) {
    for (const t of stream.getTracks()) {
      t.stop();
    }
    if (ctx) {
      void ctx.close();
    }
    return { ok: false, error: classifyCaptureError(err) };
  }
}
