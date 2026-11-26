import {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactElement,
} from 'react';

export type FileDecodeStatus =
  | 'idle'
  | 'decoding-fast'
  | 'playing-realtime'
  | 'done'
  | 'error';

export interface FileModeState {
  readonly status: FileDecodeStatus;
  readonly fileName: string | null;
  readonly progressPct: number;
  readonly realtime: boolean;
  readonly errorMessage: string | null;
}

export const INITIAL_FILE_MODE_STATE: FileModeState = {
  status: 'idle',
  fileName: null,
  progressPct: 0,
  realtime: false,
  errorMessage: null,
};

export interface FileDropProps {
  fileState: FileModeState;
  hasLoadedBuffer: boolean;
  onSelectWavFile: (file: File) => void;
  onToggleRealtime: (realtime: boolean) => void;
  onReplayFast: () => void;
  onReplayRealtime: () => void;
  onStopPlayback: () => void;
}

/**
 * CRT glass overlay shown in `Fichier` mode before a valid WAV has been decoded
 * (or when a file fails validation, displaying the plain-French error from `src/ui/errors.ts`).
 */
export function FileDrop({
  fileState,
  onSelectWavFile,
  onToggleRealtime,
}: Pick<
  FileDropProps,
  'fileState' | 'onSelectWavFile' | 'onToggleRealtime'
>): ReactElement {
  const inputId = useId();
  const realtimeId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState<boolean>(false);

  const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    if (!dragActive) {
      setDragActive(true);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) {
      onSelectWavFile(dropped);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const picked = event.target.files?.[0];
    if (picked) {
      onSelectWavFile(picked);
    }
    event.target.value = '';
  };

  return (
    <div
      className="nm-start-overlay nm-filedrop-overlay"
      data-drag-active={dragActive ? 'true' : 'false'}
      role="region"
      aria-label="Décodage de fichier WAV"
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <p className="nm-start-memorial">Décodage d&apos;enregistrement WAV V.23</p>
      <p className="nm-start-caption">
        Glissez-déposez un fichier <code>.wav</code> sur l&apos;écran ou sélectionnez-le
        pour le démoduler plus vite que le temps réel (ou l&apos;écouter à cadence réelle).
      </p>

      {fileState.errorMessage && (
        <div className="nm-banner nm-banner-warn nm-filedrop-error" role="alert">
          {fileState.errorMessage}
        </div>
      )}

      <label className="nm-filedrop-mode-toggle" htmlFor={realtimeId}>
        <input
          id={realtimeId}
          type="checkbox"
          checked={fileState.realtime}
          onChange={(e) => onToggleRealtime(e.target.checked)}
        />
        <span>Lecture en temps réel avec son du modem</span>
      </label>

      <div className="nm-permission-actions">
        <input
          ref={fileInputRef}
          id={inputId}
          type="file"
          accept=".wav,audio/wav,audio/wave,audio/x-wav"
          className="nm-sr-only"
          onChange={handleFileChange}
        />
        <button
          type="button"
          className="nm-btn nm-btn-connexion"
          onClick={() => fileInputRef.current?.click()}
        >
          Choisir un fichier .wav
        </button>
      </div>
    </div>
  );
}

/**
 * Footer control bar shown below the Minitel screen in `Fichier` mode:
 * displays decoding progress, fast re-decode, real-time audio playback, and file replacement.
 */
export function FileModeBar({
  fileState,
  hasLoadedBuffer,
  onSelectWavFile,
  onToggleRealtime,
  onReplayFast,
  onReplayRealtime,
  onStopPlayback,
}: FileDropProps): ReactElement {
  const pickerRef = useRef<HTMLInputElement | null>(null);
  const checkboxId = useId();

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const picked = event.target.files?.[0];
    if (picked) {
      onSelectWavFile(picked);
    }
    event.target.value = '';
  };

  const isBusy =
    fileState.status === 'decoding-fast' ||
    fileState.status === 'playing-realtime';

  const statusText = (() => {
    if (fileState.status === 'decoding-fast') {
      return `Décodage rapide en cours (${fileState.progressPct} %)…`;
    }
    if (fileState.status === 'playing-realtime') {
      return `Lecture temps réel : ${fileState.fileName ?? 'fichier.wav'}`;
    }
    if (fileState.status === 'done') {
      return `Fichier décodé : ${fileState.fileName ?? 'fichier.wav'} (100 %)`;
    }
    if (fileState.status === 'error') {
      return `Échec lecture : ${fileState.fileName ?? 'fichier.wav'}`;
    }
    return 'Aucun fichier WAV chargé';
  })();

  return (
    <div
      className="nm-file-panel"
      role="group"
      aria-label="Commandes du mode Fichier WAV"
    >
      <div className="nm-file-panel-top">
        <span className="nm-server-bar-label">{statusText}</span>

        <label className="nm-file-inline-check" htmlFor={checkboxId}>
          <input
            id={checkboxId}
            type="checkbox"
            checked={fileState.realtime}
            onChange={(e) => onToggleRealtime(e.target.checked)}
          />
          <span>Temps réel au prochain import</span>
        </label>
      </div>

      {(fileState.status === 'decoding-fast' || fileState.status === 'done') && (
        <div className="nm-file-progress-wrap">
          <progress
            className="nm-file-progress"
            max={100}
            value={fileState.progressPct}
            aria-label="Progression du décodage WAV"
          />
          <span className="nm-file-progress-pct">{`${fileState.progressPct} %`}</span>
        </div>
      )}

      <div className="nm-file-actions">
        <input
          ref={pickerRef}
          type="file"
          accept=".wav,audio/wav,audio/wave,audio/x-wav"
          className="nm-sr-only"
          onChange={handleFileChange}
        />
        <button
          type="button"
          className="nm-btn"
          onClick={() => pickerRef.current?.click()}
        >
          Charger un .wav…
        </button>

        {hasLoadedBuffer && (
          <>
            <button
              type="button"
              className="nm-btn"
              disabled={fileState.status === 'decoding-fast'}
              onClick={onReplayFast}
            >
              Décoder rapidement
            </button>

            {fileState.status === 'playing-realtime' ? (
              <button
                type="button"
                className="nm-btn nm-btn-fin"
                onClick={onStopPlayback}
              >
                Arrêter la lecture
              </button>
            ) : (
              <button
                type="button"
                className="nm-btn"
                disabled={isBusy}
                onClick={onReplayRealtime}
              >
                Écouter en temps réel
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
