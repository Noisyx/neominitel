import { useId, type FormEvent, type ReactElement } from 'react';
import type { InputFieldSpec } from '../../services';

export interface InputOverlayProps {
  field: InputFieldSpec;
  value: string;
  onChangeText: (next: string) => void;
  onSubmitEnvoi: () => void;
}

/**
 * Touch-accessible text input synchronized with the terminal's local-echo field (Req 4.3 & 4.5).
 * Submitting the form (Enter / mobile virtual keyboard "Envoyer") triggers Minitel *Envoi*;
 * visible *Envoi* and *Annulation* keys live once on the Minitel keypad right below.
 */
export function InputOverlay({
  field,
  value,
  onChangeText,
  onSubmitEnvoi,
}: InputOverlayProps): ReactElement {
  const inputId = useId();

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSubmitEnvoi();
  };

  return (
    <form className="nm-input-bar" onSubmit={handleSubmit}>
      <label htmlFor={inputId} className="nm-input-label">
        Saisie
      </label>
      <input
        id={inputId}
        type="text"
        className="nm-input-field"
        value={value}
        maxLength={field.maxLength}
        placeholder="Tapez ici puis touchez Envoi…"
        enterKeyHint="send"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        spellCheck={false}
        onChange={(e) => onChangeText(e.target.value)}
      />
    </form>
  );
}
