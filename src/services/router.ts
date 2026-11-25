import {
  ACCENT_BY_CHAR,
  COLOURS,
  createBlankCell,
  SCREEN_COLS,
  SCREEN_ROWS,
  type Cell,
  type FunctionKey,
  type Screen,
} from '../videotex';
import { fantomeService } from './fantome';
import { libreService } from './libre';
import { mathsService } from './maths';
import { sommaireService } from './sommaire';
import type {
  InputFieldSpec,
  Service,
  ServiceId,
  ServiceOutput,
} from './types';

const SERVICES: Readonly<Record<ServiceId, Service<unknown>>> = {
  SOMMAIRE: sommaireService as Service<unknown>,
  MATHS: mathsService as Service<unknown>,
  FANTOME: fantomeService as Service<unknown>,
  LIBRE: libreService as Service<unknown>,
};

export const ALL_SERVICE_IDS: readonly ServiceId[] = [
  'SOMMAIRE',
  'MATHS',
  'FANTOME',
  'LIBRE',
];

export function getServiceById(id: ServiceId): Service<unknown> {
  return SERVICES[id];
}

/**
 * Normalizes user-typed Télétel service codes (e.g. "3615 maths", "fantôme", "LIBRE")
 * to a known `ServiceId`, or `null` if unknown.
 */
export function resolveServiceCode(rawInput: string): ServiceId | null {
  const cleaned = rawInput
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/^3615\s*/, '')
    .trim();

  if (
    cleaned === 'SOMMAIRE' ||
    cleaned === 'MATHS' ||
    cleaned === 'FANTOME' ||
    cleaned === 'LIBRE'
  ) {
    return cleaned;
  }
  return null;
}

export interface RouterState {
  readonly activeServiceId: ServiceId;
  readonly serviceState: unknown;
  readonly lastOutput: ServiceOutput;
  readonly inputBuffer: string;
}

export type RouterEffect =
  | {
      kind: 'transmit';
      output: ServiceOutput;
      isRepetition: boolean;
      withConnectionSequence: boolean;
    }
  | { kind: 'localEcho'; field: InputFieldSpec; text: string }
  | { kind: 'disconnect' }
  | { kind: 'none' };

function cloneOutput(out: ServiceOutput): ServiceOutput {
  return {
    pageId: out.pageId,
    bytes: out.bytes.slice(),
    ...(out.input ? { input: { ...out.input } } : {}),
    ...(out.testPattern ? { testPattern: { ...out.testPattern } } : {}),
    ...(out.playWav !== undefined ? { playWav: out.playWav } : {}),
  };
}

/**
 * Starts a new online Télétel session on `3615 SOMMAIRE`.
 */
export function connectRouter(): { state: RouterState; effect: RouterEffect } {
  const [serviceState, rawOut] = sommaireService.init();
  const output = cloneOutput(rawOut);
  return {
    state: {
      activeServiceId: 'SOMMAIRE',
      serviceState,
      lastOutput: output,
      inputBuffer: '',
    },
    effect: {
      kind: 'transmit',
      output: cloneOutput(output),
      isRepetition: false,
      withConnectionSequence: true,
    },
  };
}

function sanitizeInputChars(raw: string, maxLength: number): string {
  let out = '';
  for (const ch of raw) {
    if (out.length >= maxLength) break;
    if (ACCENT_BY_CHAR.has(ch)) {
      out += ch;
      continue;
    }
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x20 && cp <= 0x7e) {
      out += ch;
    }
  }
  return out;
}

/**
 * Appends printable character(s) into the active input field (local echo).
 */
export function stepRouterChar(
  state: RouterState,
  chars: string,
): { state: RouterState; effect: RouterEffect } {
  const field = state.lastOutput.input;
  if (!field || chars.length === 0) {
    return { state, effect: { kind: 'none' } };
  }
  const combined = sanitizeInputChars(state.inputBuffer + chars, field.maxLength);
  if (combined === state.inputBuffer) {
    return { state, effect: { kind: 'none' } };
  }
  const nextState: RouterState = {
    ...state,
    inputBuffer: combined,
  };
  return {
    state: nextState,
    effect: { kind: 'localEcho', field, text: combined },
  };
}

/**
 * Replaces the entire local-echo input buffer (used by mobile `<input>` overlay).
 */
export function stepRouterSetInput(
  state: RouterState,
  rawText: string,
): { state: RouterState; effect: RouterEffect } {
  const field = state.lastOutput.input;
  if (!field) {
    return { state, effect: { kind: 'none' } };
  }
  const sanitized = sanitizeInputChars(rawText, field.maxLength);
  if (sanitized === state.inputBuffer) {
    return { state, effect: { kind: 'none' } };
  }
  const nextState: RouterState = {
    ...state,
    inputBuffer: sanitized,
  };
  return {
    state: nextState,
    effect: { kind: 'localEcho', field, text: sanitized },
  };
}

/**
 * Processes one of the nine Minitel function keys on an active `RouterState`.
 */
export function stepRouterKey(
  state: RouterState,
  key: FunctionKey,
): { state: RouterState | null; effect: RouterEffect } {
  // 1. Connexion/Fin always disconnects and returns to the start screen
  if (key === 'ConnexionFin') {
    return { state: null, effect: { kind: 'disconnect' } };
  }

  // 2. Répétition resends the last ServiceOutput byte-for-byte unchanged
  if (key === 'Repetition') {
    const resent = cloneOutput(state.lastOutput);
    const nextState: RouterState = {
      ...state,
      inputBuffer: '',
    };
    return {
      state: nextState,
      effect: {
        kind: 'transmit',
        output: resent,
        isRepetition: true,
        withConnectionSequence: false,
      },
    };
  }

  // 3. Correction deletes the last character in the local input field
  if (key === 'Correction') {
    const field = state.lastOutput.input;
    if (!field) {
      return { state, effect: { kind: 'none' } };
    }
    const shortened = Array.from(state.inputBuffer).slice(0, -1).join('');
    const nextState: RouterState = {
      ...state,
      inputBuffer: shortened,
    };
    return {
      state: nextState,
      effect: { kind: 'localEcho', field, text: shortened },
    };
  }

  // 4. Annulation clears the entire local input field
  if (key === 'Annulation') {
    const field = state.lastOutput.input;
    if (!field) {
      return { state, effect: { kind: 'none' } };
    }
    const nextState: RouterState = {
      ...state,
      inputBuffer: '',
    };
    return {
      state: nextState,
      effect: { kind: 'localEcho', field, text: '' },
    };
  }

  // 5. On 3615 SOMMAIRE, Envoi with a valid service code opens that service
  if (
    key === 'Envoi' &&
    state.activeServiceId === 'SOMMAIRE' &&
    state.lastOutput.input !== undefined
  ) {
    const targetId = resolveServiceCode(state.inputBuffer);
    if (targetId !== null) {
      const targetService = getServiceById(targetId);
      const [nextServiceState, rawOut] = targetService.init();
      const output = cloneOutput(rawOut);
      return {
        state: {
          activeServiceId: targetId,
          serviceState: nextServiceState,
          lastOutput: output,
          inputBuffer: '',
        },
        effect: {
          kind: 'transmit',
          output: cloneOutput(output),
          isRepetition: false,
          withConnectionSequence: false,
        },
      };
    }
  }

  // 6. Delegate navigation / Envoi / Sommaire / Guide / Suite / Retour to the active service
  const activeService = getServiceById(state.activeServiceId);
  const [nextServiceState, maybeOut] = activeService.handle(state.serviceState, {
    kind: 'key',
    key,
    text: state.inputBuffer,
  });

  if (maybeOut === null) {
    return {
      state: {
        ...state,
        serviceState: nextServiceState,
      },
      effect: { kind: 'none' },
    };
  }

  const output = cloneOutput(maybeOut);
  return {
    state: {
      activeServiceId: state.activeServiceId,
      serviceState: nextServiceState,
      lastOutput: output,
      inputBuffer: '',
    },
    effect: {
      kind: 'transmit',
      output: cloneOutput(output),
      isRepetition: false,
      withConnectionSequence: false,
    },
  };
}

/**
 * Overlays the local-echo input buffer and blinking/inverted cursor onto a `Screen`
 * without mutating `screen`.
 */
export function overlayInputFieldOnScreen(
  screen: Screen,
  field: InputFieldSpec | undefined,
  text: string,
): Screen {
  if (!field) {
    if (!screen.cursor.visible) {
      return screen;
    }
    return {
      rows: screen.rows,
      cursor: { ...screen.cursor, visible: false },
      attrs: { ...screen.attrs },
    };
  }

  const r = field.row;
  if (r < 0 || r >= SCREEN_ROWS) {
    return screen;
  }

  const nextRows = screen.rows.slice();
  const rowCopy = nextRows[r].slice();
  nextRows[r] = rowCopy;

  const chars = Array.from(text);
  const startCol0 = Math.max(0, field.col - 1);

  for (let i = 0; i < field.maxLength; i++) {
    const c = startCol0 + i;
    if (c >= SCREEN_COLS) break;

    if (i < chars.length) {
      const ch = chars[i];
      const accent = ACCENT_BY_CHAR.get(ch);
      const cell: Cell = accent
        ? createBlankCell({
            code: accent.baseCode,
            set: 'G2',
            accent: accent.diacritic,
            fg: COLOURS.CYAN,
            bg: COLOURS.BLACK,
          })
        : createBlankCell({
            code: ch.codePointAt(0) ?? 0x20,
            set: 'G0',
            fg: COLOURS.CYAN,
            bg: COLOURS.BLACK,
          });
      rowCopy[c] = cell;
    } else {
      rowCopy[c] = createBlankCell({
        code: 0x2e, // '.'
        set: 'G0',
        fg: COLOURS.CYAN,
        bg: COLOURS.BLACK,
      });
    }
  }

  const cursorOffset = Math.min(chars.length, Math.max(0, field.maxLength - 1));
  const cursorCol = Math.min(SCREEN_COLS - 1, startCol0 + cursorOffset);

  return {
    rows: nextRows,
    cursor: { row: r, col: cursorCol, visible: true },
    attrs: { ...screen.attrs },
  };
}
