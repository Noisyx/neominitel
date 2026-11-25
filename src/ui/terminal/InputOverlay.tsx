import { useId, type ReactElement } from 'react';
import type { InputFieldSpec } from '../../services';

export interface InputOverlayProps {
  field: InputFieldSpec;
  value: string;
  onChangeText: (next: string) => void;
  onSubmitEnvoi: () => void;
  onClearAnnulation: () => void;
}

/**
 * Touch-accessible text input synchronized with the terminal's local-echo field (Req 4.3 & 4.5).
 */
export function InputOverlay({
  field,
  value,
  onChangeText,
  onSubmitEnvoi,
  onClearAnnulation,
}: InputOverlayProps): ReactElement {
  const inputId = useId();

  return (
    <div className="nm-input-bar">
      <label htmlFor={inputId} className="nm-input-label">
        Saisie Minitel
      </label>
      <input
        id={inputId}
        type="text"
        className="nm-input-field"
        value={value}
        maxLength={field.maxLength}
        placeholder="MATHS, FANTOME, LIBRE"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        spellCheck={false}
        onChange={(e) => onChangeText(e.target.value)}
      />
      {value.length > 0 && (
        <button
          type="button"
          className="nm-btn"
          onClick={onClearAnnulation}
        >
          Annulation
        </button>
      )}
      <button
        type="button"
        className="nm-btn nm-btn-envoi-inline"
        onClick={onSubmitEnvoi}
      >
        Envoi
      </button>
    </div>
  );
}
