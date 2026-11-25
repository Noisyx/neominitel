import type { ReactElement } from 'react';
import type { FunctionKey } from '../../videotex';

export interface KeyDescriptor {
  key: FunctionKey;
  label: string;
  shortcut: string;
  variant?: 'default' | 'envoi' | 'fin';
}

export const MINITEL_KEY_DESCRIPTORS: readonly KeyDescriptor[] = [
  { key: 'Sommaire', label: 'Sommaire', shortcut: 'Début' },
  { key: 'Annulation', label: 'Annulation', shortcut: 'Échap' },
  { key: 'Retour', label: 'Retour', shortcut: 'Pg.Haut' },
  { key: 'Repetition', label: 'Répétition', shortcut: 'Alt+R' },
  { key: 'Guide', label: 'Guide', shortcut: 'Alt+G' },
  { key: 'Correction', label: 'Correction', shortcut: 'Ret.Arr' },
  { key: 'Suite', label: 'Suite', shortcut: 'Pg.Bas' },
  { key: 'ConnexionFin', label: 'Connexion/Fin', shortcut: 'Fin', variant: 'fin' },
  { key: 'Envoi', label: 'Envoi', shortcut: 'Entrée', variant: 'envoi' },
] as const;

export interface KeyboardEventLike {
  code: string;
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export type MappedKeyboardAction =
  | { kind: 'functionKey'; key: FunctionKey }
  | { kind: 'char'; char: string }
  | null;

/**
 * Maps a DOM `KeyboardEvent` to a Minitel function key or printable character using
 * `KeyboardEvent.code` for shortcuts (Requirement 4.2). Never maps browser F-keys (F1..F12).
 */
export function mapKeyboardEventToMinitel(
  event: KeyboardEventLike,
  options?: { insideTextInput?: boolean },
): MappedKeyboardAction {
  if (event.ctrlKey || event.metaKey) {
    return null;
  }

  // Explicitly never bind F1..F12
  if (/^F([1-9]|1[0-2])$/.test(event.code)) {
    return null;
  }

  if (event.altKey) {
    if (event.code === 'KeyG') {
      return { kind: 'functionKey', key: 'Guide' };
    }
    if (event.code === 'KeyR') {
      return { kind: 'functionKey', key: 'Repetition' };
    }
    return null;
  }

  switch (event.code) {
    case 'Enter':
    case 'NumpadEnter':
      return { kind: 'functionKey', key: 'Envoi' };
    case 'Escape':
      return { kind: 'functionKey', key: 'Annulation' };
    case 'PageDown':
      return { kind: 'functionKey', key: 'Suite' };
    case 'PageUp':
      return { kind: 'functionKey', key: 'Retour' };
    case 'Home':
      return { kind: 'functionKey', key: 'Sommaire' };
    case 'End':
      return { kind: 'functionKey', key: 'ConnexionFin' };
    case 'Backspace':
      // When inside the HTML <input>, let native Backspace edit the field via onChange
      if (options?.insideTextInput) {
        return null;
      }
      return { kind: 'functionKey', key: 'Correction' };
    default:
      break;
  }

  if (options?.insideTextInput) {
    return null;
  }

  if (event.key.length === 1) {
    return { kind: 'char', char: event.key };
  }

  return null;
}

export interface FunctionKeysProps {
  online: boolean;
  onPressKey: (key: FunctionKey) => void;
}

/**
 * On-screen Minitel function keycap cluster (touch-friendly + PC shortcut labels).
 */
export function FunctionKeys({ online, onPressKey }: FunctionKeysProps): ReactElement {
  return (
    <div
      className="nm-keypad"
      role="group"
      aria-label="Touches de fonction Minitel"
    >
      {MINITEL_KEY_DESCRIPTORS.map((item) => {
        const disabled = !online && item.key !== 'ConnexionFin';
        const variantClass =
          item.variant === 'envoi'
            ? ' nm-keycap-envoi'
            : item.variant === 'fin'
              ? ' nm-keycap-fin'
              : '';
        return (
          <button
            key={item.key}
            type="button"
            className={`nm-keycap${variantClass}`}
            disabled={disabled}
            onClick={() => onPressKey(item.key)}
          >
            <span className="nm-keycap-label">{item.label}</span>
            <kbd className="nm-keycap-shortcut">{item.shortcut}</kbd>
          </button>
        );
      })}
    </div>
  );
}
