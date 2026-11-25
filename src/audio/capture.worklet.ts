/**
 * AudioWorklet processor forwarding raw 128-sample microphone frames directly
 * to `line.worker.ts` over a dedicated `MessagePort` (never through the main thread).
 */

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: unknown) => AudioWorkletProcessor,
): void;

type WorkletControlMessage =
  | { t: 'attachPort'; port: MessagePort }
  | { t: 'stop' };

class NeoMinitelCaptureProcessor extends AudioWorkletProcessor {
  private workerPort: MessagePort | null = null;
  private active = true;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<WorkletControlMessage>): void => {
      const msg = event.data;
      if (!msg) return;
      if (msg.t === 'attachPort') {
        this.workerPort = msg.port;
      } else if (msg.t === 'stop') {
        this.active = false;
        if (this.workerPort) {
          this.workerPort.close();
          this.workerPort = null;
        }
      }
    };
  }

  process(inputs: Float32Array[][]): boolean {
    if (!this.active) {
      return false;
    }
    const channel0 = inputs[0]?.[0];
    if (channel0 && channel0.length > 0 && this.workerPort) {
      // Copy quantum buffer before transferring ownership across threads
      const frame = new Float32Array(channel0);
      this.workerPort.postMessage(frame, [frame.buffer]);
    }
    return true;
  }
}

registerProcessor('neominitel-capture-processor', NeoMinitelCaptureProcessor);
export {};
