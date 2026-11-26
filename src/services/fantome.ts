import {
  FANTOME_ACCUEIL_PAGE,
  FANTOME_FINAL_PAGE,
  FANTOME_GUIDE_PAGE,
  FANTOME_STORY_L1_PAGE,
  FANTOME_STORY_L2_PAGE,
  FANTOME_STORY_L3_PAGE,
  FANTOME_STORY_L4_PAGE,
  FANTOME_STORY_L5_PAGE,
} from '../../content/pages/fantome';
import defaultManifestJson from '../../public/transmissions/manifest.json';
import {
  checkFantomeCodeSync,
  createFantomeProgressStore,
  type FantomeManifest,
  type FantomeProgressStore,
  type ManifestLevel,
} from '../fantome';
import { COLOURS, encodePage, type PageSource } from '../videotex';
import type { InputFieldSpec, Service, ServiceInput, ServiceOutput } from './types';

export const FANTOME_MENU_INPUT: InputFieldSpec = {
  row: 21,
  col: 17,
  maxLength: 2,
};

export const FANTOME_CODE_INPUT: InputFieldSpec = {
  row: 15,
  col: 14,
  maxLength: 16,
};

const STORY_PAGES_BY_ID: Readonly<Record<string, PageSource>> = {
  'fantome/story-l1': FANTOME_STORY_L1_PAGE,
  'fantome/story-l2': FANTOME_STORY_L2_PAGE,
  'fantome/story-l3': FANTOME_STORY_L3_PAGE,
  'fantome/story-l4': FANTOME_STORY_L4_PAGE,
  'fantome/story-l5': FANTOME_STORY_L5_PAGE,
};

export type FantomeReturnView = 'menu' | 'story' | 'receiving' | 'answer' | 'wrong';

export type FantomeViewState =
  | { readonly kind: 'menu' }
  | { readonly kind: 'locked'; readonly attemptedLevel: number }
  | { readonly kind: 'story'; readonly levelIndex: number }
  | { readonly kind: 'receiving'; readonly levelIndex: number }
  | { readonly kind: 'answer'; readonly levelIndex: number }
  | { readonly kind: 'wrong'; readonly levelIndex: number }
  | { readonly kind: 'success'; readonly levelIndex: number }
  | {
      readonly kind: 'guide';
      readonly returnTo: FantomeReturnView;
      readonly levelIndex: number | null;
    }
  | { readonly kind: 'final' };

export interface FantomeState {
  /** Number of cleared levels (`0..levels.length`); highest accessible level is `unlocked + 1`. */
  readonly unlocked: number;
  readonly view: FantomeViewState;
}

function wrapTextWords(text: string, maxCols: number): string[] {
  const normalized = text.replace(/[«»]/g, '"').replace(/’/g, ' ');
  const words = normalized.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const cleanWord = word.replace(/'/g, ' ');
    if (current.length === 0) {
      current = cleanWord.slice(0, maxCols);
    } else if (current.length + 1 + cleanWord.length <= maxCols) {
      current += ` ${cleanWord}`;
    } else {
      lines.push(current);
      current = cleanWord.slice(0, maxCols);
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

function downloadMeta(level: ManifestLevel): NonNullable<ServiceOutput['downloadWav']> {
  const cleanRel = level.wav.replace(/^\/+/, '');
  return {
    url: `/${cleanRel}`,
    filename: `neominitel-${level.id.toLowerCase()}.wav`,
    label: `${level.id} · ${level.title}`,
  };
}

function encodePageToOutput(
  page: PageSource,
  extras?: Partial<Omit<ServiceOutput, 'pageId' | 'bytes'>>,
): ServiceOutput {
  const res = encodePage(page);
  return {
    pageId: page.id,
    bytes: res.ok ? res.value.bytes : new Uint8Array([0x0c]),
    ...extras,
  };
}

function buildLockedPage(attemptedLevel: number, maxAllowed: number): PageSource {
  return {
    id: `fantome/locked-${attemptedLevel}`,
    status: '3615 FANTOME          RELAIS SCELLE',
    rows: [
      {
        row: 1,
        col: 1,
        segments: [
          {
            text: ' ACCES REFUSE - RELAIS ENCORE VERROUILLE',
            fg: COLOURS.WHITE,
            bg: COLOURS.RED,
          },
        ],
      },
      {
        row: 6,
        col: 2,
        segments: [
          {
            text: `La transmission ${attemptedLevel} reste scellée.`,
            fg: COLOURS.YELLOW,
          },
        ],
      },
      {
        row: 9,
        col: 2,
        segments: [
          {
            text: `Résolvez d abord le niveau ${maxAllowed}`,
            fg: COLOURS.WHITE,
          },
        ],
      },
      {
        row: 10,
        col: 2,
        segments: [
          {
            text: 'pour ouvrir la suite des archives.',
            fg: COLOURS.WHITE,
          },
        ],
      },
      {
        row: 19,
        col: 2,
        segments: [
          { text: ' SUITE ', fg: COLOURS.BLACK, bg: COLOURS.CYAN },
          { text: ` ouvrir niveau ${maxAllowed} `, fg: COLOURS.WHITE, bg: COLOURS.BLACK },
          { text: ' SOMMAIRE ', fg: COLOURS.BLACK, bg: COLOURS.CYAN },
        ],
      },
    ],
  };
}

function buildAnswerPage(level: ManifestLevel, isRetry: boolean): PageSource {
  const headerText = isRetry
    ? ' LES ESPRITS RESTENT MUETS...           '
    : ` SAISIE DU CODE - ${level.id}                    `.slice(0, 40);

  return {
    id: isRetry
      ? `fantome/wrong-${level.id.toLowerCase()}`
      : `fantome/answer-${level.id.toLowerCase()}`,
    status: `3615 FANTOME - ${level.id}       IDENTIFICATION`,
    rows: [
      {
        row: 1,
        col: 1,
        segments: [
          {
            text: headerText,
            fg: isRetry ? COLOURS.WHITE : COLOURS.BLACK,
            bg: isRetry ? COLOURS.RED : COLOURS.CYAN,
          },
        ],
      },
      {
        row: 4,
        col: 2,
        segments: [
          {
            text: isRetry
              ? 'Ce mot ne réveille pas le répartiteur.'
              : `Transmission : ${level.title}`.slice(0, 38),
            fg: isRetry ? COLOURS.YELLOW : COLOURS.WHITE,
          },
        ],
      },
      {
        row: 6,
        col: 2,
        segments: [
          {
            text: isRetry
              ? 'Essayez à nouveau (casse et accents'
              : 'Inscrivez la clef lue dans le signal',
            fg: COLOURS.WHITE,
          },
        ],
      },
      {
        row: 7,
        col: 2,
        segments: [
          {
            text: isRetry
              ? 'ignorés) ou réécoutez avec RETOUR :'
              : '(majuscules et accents ignorés) :',
            fg: COLOURS.CYAN,
          },
        ],
      },
      {
        row: 15,
        col: 2,
        segments: [
          { text: 'Code lu :   ................', fg: COLOURS.YELLOW },
        ],
      },
      {
        row: 20,
        col: 2,
        segments: [
          { text: ' ENVOI ', fg: COLOURS.BLACK, bg: COLOURS.GREEN },
          { text: ' valider ', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
          { text: ' RETOUR ', fg: COLOURS.BLACK, bg: COLOURS.YELLOW },
          { text: ' réécouter', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
        ],
      },
      {
        row: 22,
        col: 2,
        segments: [
          { text: ' GUIDE ', fg: COLOURS.BLACK, bg: COLOURS.MAGENTA },
          { text: ' indice radio du niveau', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
        ],
      },
    ],
  };
}

function buildSuccessPage(
  level: ManifestLevel,
  hasNextLevel: boolean,
): PageSource {
  return {
    id: `fantome/success-${level.id.toLowerCase()}`,
    status: `3615 FANTOME - ${level.id}          DEVERROUILLE`,
    rows: [
      {
        row: 1,
        col: 1,
        segments: [
          {
            text: ` RELAIS ${level.id} APAISE - CLEF RECONNUE       `.slice(0, 40),
            fg: COLOURS.BLACK,
            bg: COLOURS.GREEN,
          },
        ],
      },
      {
        row: 5,
        col: 2,
        segments: [
          {
            text: `Le spectre "${level.title}"`.slice(0, 38),
            fg: COLOURS.GREEN,
          },
        ],
      },
      {
        row: 6,
        col: 2,
        segments: [
          { text: 'vous ouvre le passage suivant.', fg: COLOURS.WHITE },
        ],
      },
      {
        row: 11,
        col: 2,
        segments: [
          {
            text: hasNextLevel
              ? 'Une nouvelle porteuse s éveille plus'
              : 'Toutes les transmissions ont livré',
            fg: COLOURS.CYAN,
          },
        ],
      },
      {
        row: 12,
        col: 2,
        segments: [
          {
            text: hasNextLevel
              ? 'loin sur le câble souterrain...'
              : 'leur secret. Découvrez l épilogue !',
            fg: COLOURS.CYAN,
          },
        ],
      },
      {
        row: 19,
        col: 2,
        segments: [
          { text: ' SUITE ', fg: COLOURS.BLACK, bg: COLOURS.GREEN },
          {
            text: hasNextLevel ? ' niveau suivant ' : ' lire épilogue ',
            fg: COLOURS.WHITE,
            bg: COLOURS.BLACK,
          },
          { text: ' SOMMAIRE ', fg: COLOURS.BLACK, bg: COLOURS.GREEN },
        ],
      },
    ],
  };
}

function buildLevelHintPage(level: ManifestLevel): PageSource {
  const wrapped = wrapTextWords(level.hint, 36).slice(0, 6);
  return {
    id: `fantome/hint-${level.id.toLowerCase()}`,
    status: `3615 FANTOME - INDICE ${level.id}     AIDE RADIO`,
    rows: [
      {
        row: 1,
        col: 1,
        segments: [
          {
            text: ` INDICE RADIO - ${level.id}                      `.slice(0, 40),
            fg: COLOURS.BLACK,
            bg: COLOURS.MAGENTA,
          },
        ],
      },
      {
        row: 4,
        col: 2,
        segments: [
          { text: level.title.slice(0, 38), fg: COLOURS.YELLOW },
        ],
      },
      ...wrapped.map((line, idx) => ({
        row: 7 + idx * 2,
        col: 2,
        segments: [{ text: line, fg: COLOURS.WHITE }],
      })),
      {
        row: 21,
        col: 2,
        segments: [
          { text: ' RETOUR ', fg: COLOURS.BLACK, bg: COLOURS.MAGENTA },
          { text: ' revenir au niveau ', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
          { text: ' SOMMAIRE ', fg: COLOURS.BLACK, bg: COLOURS.MAGENTA },
        ],
      },
    ],
  };
}

function parseRequestedLevelNumber(raw: string): number | null {
  const cleaned = raw.trim().toUpperCase().replace(/^L/, '');
  if (!/^[1-9]$/.test(cleaned)) {
    return null;
  }
  return Number.parseInt(cleaned, 10);
}

export interface FantomeServiceOptions {
  readonly manifest?: FantomeManifest;
  readonly progressStore?: FantomeProgressStore | null;
}

/**
 * Pure state-machine factory for `3615 FANTOME` (`fantome` Task 4.2 & Properties H5, H6).
 */
export function createFantomeService(
  options?: FantomeServiceOptions,
): Service<FantomeState> {
  const manifest =
    options?.manifest ?? (defaultManifestJson as unknown as FantomeManifest);
  const progressStore = options?.progressStore ?? null;
  const levels = manifest.levels;

  function clampIndex(idx: number): number {
    return Math.max(0, Math.min(levels.length - 1, idx));
  }

  function maxAccessibleLevelNumber(unlocked: number): number {
    return Math.min(levels.length, Math.max(0, unlocked) + 1);
  }

  function storyOutput(levelIndex: number): ServiceOutput {
    const lvl = levels[clampIndex(levelIndex)];
    const page = STORY_PAGES_BY_ID[lvl.storyPage] ?? FANTOME_STORY_L1_PAGE;
    return encodePageToOutput(page, { downloadWav: downloadMeta(lvl) });
  }

  function receivingOutput(levelIndex: number): ServiceOutput {
    const lvl = levels[clampIndex(levelIndex)];
    return {
      pageId: `fantome/rx-${lvl.id.toLowerCase()}`,
      bytes: new Uint8Array([0x0c]),
      playWav: `/${lvl.wav.replace(/^\/+/, '')}`,
      downloadWav: downloadMeta(lvl),
    };
  }

  function answerOutput(levelIndex: number, isRetry: boolean): ServiceOutput {
    const lvl = levels[clampIndex(levelIndex)];
    return encodePageToOutput(buildAnswerPage(lvl, isRetry), {
      input: FANTOME_CODE_INPUT,
      downloadWav: downloadMeta(lvl),
    });
  }

  function menuOutput(): ServiceOutput {
    return encodePageToOutput(FANTOME_ACCUEIL_PAGE, {
      input: FANTOME_MENU_INPUT,
    });
  }

  return {
    id: 'FANTOME',

    init(): [FantomeState, ServiceOutput] {
      const initialUnlocked = progressStore ? progressStore.readUnlocked() : 0;
      return [
        {
          unlocked: Math.min(levels.length, Math.max(0, initialUnlocked)),
          view: { kind: 'menu' },
        },
        menuOutput(),
      ];
    },

    handle(
      state: FantomeState,
      input: ServiceInput,
    ): [FantomeState, ServiceOutput | null] {
      const syncedUnlocked = progressStore
        ? Math.max(state.unlocked, progressStore.readUnlocked())
        : state.unlocked;
      const maxLevelNum = maxAccessibleLevelNumber(syncedUnlocked);

      if (input.key === 'Sommaire') {
        return [
          { unlocked: syncedUnlocked, view: { kind: 'menu' } },
          menuOutput(),
        ];
      }

      if (input.key === 'Guide') {
        const v = state.view;
        if (
          v.kind === 'story' ||
          v.kind === 'receiving' ||
          v.kind === 'answer' ||
          v.kind === 'wrong'
        ) {
          const lvl = levels[clampIndex(v.levelIndex)];
          return [
            {
              unlocked: syncedUnlocked,
              view: {
                kind: 'guide',
                returnTo: v.kind,
                levelIndex: v.levelIndex,
              },
            },
            encodePageToOutput(buildLevelHintPage(lvl), {
              downloadWav: downloadMeta(lvl),
            }),
          ];
        }
        return [
          {
            unlocked: syncedUnlocked,
            view: { kind: 'guide', returnTo: 'menu', levelIndex: null },
          },
          encodePageToOutput(FANTOME_GUIDE_PAGE),
        ];
      }

      switch (state.view.kind) {
        case 'menu': {
          if (input.key === 'Envoi') {
            if (input.text.trim().length === 0) {
              if (syncedUnlocked >= levels.length) {
                return [
                  { unlocked: syncedUnlocked, view: { kind: 'final' } },
                  encodePageToOutput(FANTOME_FINAL_PAGE),
                ];
              }
              const frontierIdx = clampIndex(syncedUnlocked);
              return [
                {
                  unlocked: syncedUnlocked,
                  view: { kind: 'story', levelIndex: frontierIdx },
                },
                storyOutput(frontierIdx),
              ];
            }

            const reqNum = parseRequestedLevelNumber(input.text);
            if (reqNum === null || reqNum > maxLevelNum || reqNum > levels.length) {
              const attempted = reqNum ?? maxLevelNum + 1;
              return [
                {
                  unlocked: syncedUnlocked,
                  view: { kind: 'locked', attemptedLevel: attempted },
                },
                encodePageToOutput(buildLockedPage(attempted, maxLevelNum)),
              ];
            }
            const idx = reqNum - 1;
            return [
              {
                unlocked: syncedUnlocked,
                view: { kind: 'story', levelIndex: idx },
              },
              storyOutput(idx),
            ];
          }

          if (input.key === 'Suite') {
            if (syncedUnlocked >= levels.length) {
              return [
                { unlocked: syncedUnlocked, view: { kind: 'final' } },
                encodePageToOutput(FANTOME_FINAL_PAGE),
              ];
            }
            const frontierIdx = clampIndex(syncedUnlocked);
            return [
              {
                unlocked: syncedUnlocked,
                view: { kind: 'story', levelIndex: frontierIdx },
              },
              storyOutput(frontierIdx),
            ];
          }
          return [state, null];
        }

        case 'locked': {
          if (input.key === 'Suite' || input.key === 'Envoi') {
            const frontierIdx = clampIndex(maxLevelNum - 1);
            return [
              {
                unlocked: syncedUnlocked,
                view: { kind: 'story', levelIndex: frontierIdx },
              },
              storyOutput(frontierIdx),
            ];
          }
          if (input.key === 'Retour') {
            return [
              { unlocked: syncedUnlocked, view: { kind: 'menu' } },
              menuOutput(),
            ];
          }
          return [state, null];
        }

        case 'story': {
          const idx = clampIndex(state.view.levelIndex);
          if (input.key === 'Envoi') {
            return [
              {
                unlocked: syncedUnlocked,
                view: { kind: 'receiving', levelIndex: idx },
              },
              receivingOutput(idx),
            ];
          }
          if (input.key === 'Suite') {
            // Allows jumping straight to code entry when playing the WAV from a second device
            return [
              {
                unlocked: syncedUnlocked,
                view: { kind: 'answer', levelIndex: idx },
              },
              answerOutput(idx, false),
            ];
          }
          if (input.key === 'Retour') {
            return [
              { unlocked: syncedUnlocked, view: { kind: 'menu' } },
              menuOutput(),
            ];
          }
          return [state, null];
        }

        case 'receiving': {
          const idx = clampIndex(state.view.levelIndex);
          if (input.key === 'Suite' || input.key === 'Envoi') {
            return [
              {
                unlocked: syncedUnlocked,
                view: { kind: 'answer', levelIndex: idx },
              },
              answerOutput(idx, false),
            ];
          }
          if (input.key === 'Retour') {
            return [
              {
                unlocked: syncedUnlocked,
                view: { kind: 'story', levelIndex: idx },
              },
              storyOutput(idx),
            ];
          }
          return [state, null];
        }

        case 'answer':
        case 'wrong': {
          const idx = clampIndex(state.view.levelIndex);
          const lvl = levels[idx];
          if (input.key === 'Envoi') {
            const matched = checkFantomeCodeSync(
              input.text,
              manifest.salt,
              lvl.codeHash,
            );
            if (matched) {
              const nextUnlocked = Math.min(
                levels.length,
                Math.max(syncedUnlocked, idx + 1),
              );
              progressStore?.recordUnlocked(nextUnlocked);
              return [
                {
                  unlocked: nextUnlocked,
                  view: { kind: 'success', levelIndex: idx },
                },
                encodePageToOutput(
                  buildSuccessPage(lvl, idx + 1 < levels.length),
                ),
              ];
            }
            return [
              {
                unlocked: syncedUnlocked,
                view: { kind: 'wrong', levelIndex: idx },
              },
              answerOutput(idx, true),
            ];
          }
          if (input.key === 'Retour') {
            return [
              {
                unlocked: syncedUnlocked,
                view: { kind: 'story', levelIndex: idx },
              },
              storyOutput(idx),
            ];
          }
          return [state, null];
        }

        case 'success': {
          const idx = clampIndex(state.view.levelIndex);
          if (input.key === 'Suite' || input.key === 'Envoi') {
            if (idx + 1 < levels.length) {
              const nextIdx = idx + 1;
              return [
                {
                  unlocked: syncedUnlocked,
                  view: { kind: 'story', levelIndex: nextIdx },
                },
                storyOutput(nextIdx),
              ];
            }
            return [
              { unlocked: syncedUnlocked, view: { kind: 'final' } },
              encodePageToOutput(FANTOME_FINAL_PAGE),
            ];
          }
          if (input.key === 'Retour') {
            return [
              { unlocked: syncedUnlocked, view: { kind: 'menu' } },
              menuOutput(),
            ];
          }
          return [state, null];
        }

        case 'guide': {
          if (input.key === 'Retour' || input.key === 'Suite') {
            const lvlIdx = state.view.levelIndex;
            if (lvlIdx === null || state.view.returnTo === 'menu') {
              return [
                { unlocked: syncedUnlocked, view: { kind: 'menu' } },
                menuOutput(),
              ];
            }
            if (state.view.returnTo === 'receiving') {
              return [
                {
                  unlocked: syncedUnlocked,
                  view: { kind: 'receiving', levelIndex: lvlIdx },
                },
                receivingOutput(lvlIdx),
              ];
            }
            if (
              state.view.returnTo === 'answer' ||
              state.view.returnTo === 'wrong'
            ) {
              return [
                {
                  unlocked: syncedUnlocked,
                  view: {
                    kind: state.view.returnTo,
                    levelIndex: lvlIdx,
                  },
                },
                answerOutput(lvlIdx, state.view.returnTo === 'wrong'),
              ];
            }
            return [
              {
                unlocked: syncedUnlocked,
                view: { kind: 'story', levelIndex: lvlIdx },
              },
              storyOutput(lvlIdx),
            ];
          }
          return [state, null];
        }

        case 'final': {
          if (input.key === 'Retour' || input.key === 'Suite') {
            return [
              { unlocked: syncedUnlocked, view: { kind: 'menu' } },
              menuOutput(),
            ];
          }
          return [state, null];
        }
      }
    },
  };
}

const browserProgressStore =
  typeof window !== 'undefined'
    ? createFantomeProgressStore(() => window.localStorage)
    : null;

export const fantomeService: Service<FantomeState> = createFantomeService({
  progressStore: browserProgressStore,
});
