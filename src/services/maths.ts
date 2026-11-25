import { COLOURS, encodePage, type PageSource } from '../videotex';
import type { Service, ServiceInput, ServiceOutput } from './types';

/**
 * Provisional 3615 MATHS pages inside `src/services/maths.ts` (Role A folder) while
 * `content/pages/maths.ts` remains reserved for Role B (the mathematician, J9).
 */
const MATHS_PROVISIONAL_PAGES: readonly PageSource[] = [
  {
    id: 'maths/accueil',
    status: '3615 MATHS                SIGNAL & MODEM',
    rows: [
      {
        row: 1,
        col: 1,
        segments: [
          { text: ' 3615 MATHS - LABORATOIRE DU MODEM V.23 ', fg: COLOURS.BLACK, bg: COLOURS.CYAN },
        ],
      },
      {
        row: 4,
        col: 2,
        segments: [
          { text: 'Comment faire voyager du texte dans un', fg: COLOURS.WHITE },
        ],
      },
      {
        row: 5,
        col: 2,
        segments: [
          { text: 'simple sifflement téléphonique ?', fg: COLOURS.WHITE },
        ],
      },
      {
        row: 8,
        col: 3,
        segments: [
          { text: '1. Modulation FSK continue en phase', fg: COLOURS.CYAN },
        ],
      },
      {
        row: 10,
        col: 3,
        segments: [
          { text: '2. Trame asynchrone 7E1 et parité', fg: COLOURS.YELLOW },
        ],
      },
      {
        row: 12,
        col: 3,
        segments: [
          { text: '3. Discriminateur complexe et filtre', fg: COLOURS.GREEN },
        ],
      },
      {
        row: 14,
        col: 3,
        segments: [
          { text: '4. Seuil adaptatif et courbes Eb/N0', fg: COLOURS.MAGENTA },
        ],
      },
      {
        row: 19,
        col: 2,
        segments: [
          { text: ' SUITE ', fg: COLOURS.BLACK, bg: COLOURS.CYAN },
          { text: ' page FSK   ', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
          { text: ' GUIDE ', fg: COLOURS.BLACK, bg: COLOURS.CYAN },
          { text: ' navigation', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
        ],
      },
    ],
  },
  {
    id: 'maths/fsk',
    status: '3615 MATHS - FSK V.23          PAGE 2/2',
    rows: [
      {
        row: 1,
        col: 1,
        segments: [
          { text: ' DEUX FREQUENCES POUR CODER LES BITS    ', fg: COLOURS.BLACK, bg: COLOURS.YELLOW },
        ],
      },
      {
        row: 4,
        col: 2,
        segments: [
          { text: 'Sur la voie descendante à 1200 bauds,', fg: COLOURS.WHITE },
        ],
      },
      {
        row: 5,
        col: 2,
        segments: [
          { text: 'chaque bit dure 1/1200 s (0,833 ms) :', fg: COLOURS.WHITE },
        ],
      },
      {
        row: 8,
        col: 4,
        segments: [
          { text: ' Bit 1 (mark)  -> 1300 Hz ', fg: COLOURS.BLACK, bg: COLOURS.GREEN },
        ],
      },
      {
        row: 10,
        col: 4,
        segments: [
          { text: ' Bit 0 (space) -> 2100 Hz ', fg: COLOURS.WHITE, bg: COLOURS.BLUE },
        ],
      },
      {
        row: 13,
        col: 2,
        segments: [
          { text: 'Indice de modulation : h = 800/1200', fg: COLOURS.CYAN },
        ],
      },
      {
        row: 14,
        col: 2,
        segments: [
          { text: 'soit h = 2/3 (signaux corrélés).', fg: COLOURS.CYAN },
        ],
      },
      {
        row: 19,
        col: 2,
        segments: [
          { text: ' RETOUR ', fg: COLOURS.BLACK, bg: COLOURS.YELLOW },
          { text: ' ou ', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
          { text: ' SOMMAIRE ', fg: COLOURS.BLACK, bg: COLOURS.YELLOW },
          { text: ' accueil MATHS', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
        ],
      },
    ],
  },
];

const MATHS_GUIDE_PAGE: PageSource = {
  id: 'maths/guide',
  status: '3615 MATHS - GUIDE             AIDE LABO',
  rows: [
    {
      row: 1,
      col: 1,
      segments: [
        { text: ' AIDE DU SERVICE 3615 MATHS             ', fg: COLOURS.WHITE, bg: COLOURS.BLUE },
      ],
    },
    {
      row: 4,
      col: 2,
      segments: [
        { text: 'Parcourez les chapitres avec SUITE et', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 5,
      col: 2,
      segments: [
        { text: 'RETOUR. Le banc d essai BER en direct', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 6,
      col: 2,
      segments: [
        { text: 'et la page Vote arrivent au jalon J8.', fg: COLOURS.YELLOW },
      ],
    },
    {
      row: 19,
      col: 2,
      segments: [
        { text: ' SOMMAIRE ', fg: COLOURS.BLACK, bg: COLOURS.CYAN },
        { text: ' retour au menu 3615 MATHS', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
      ],
    },
  ],
};

export interface MathsState {
  readonly index: number;
  readonly inGuide: boolean;
}

function toOutput(page: PageSource): ServiceOutput {
  const res = encodePage(page);
  return {
    pageId: page.id,
    bytes: res.ok ? res.value.bytes : new Uint8Array([0x0c]),
  };
}

export const mathsService: Service<MathsState> = {
  id: 'MATHS',

  init(): [MathsState, ServiceOutput] {
    return [{ index: 0, inGuide: false }, toOutput(MATHS_PROVISIONAL_PAGES[0])];
  },

  handle(state: MathsState, input: ServiceInput): [MathsState, ServiceOutput | null] {
    switch (input.key) {
      case 'Sommaire':
        return [{ index: 0, inGuide: false }, toOutput(MATHS_PROVISIONAL_PAGES[0])];

      case 'Guide':
        return [{ index: state.index, inGuide: true }, toOutput(MATHS_GUIDE_PAGE)];

      case 'Suite': {
        const nextIndex = state.inGuide
          ? state.index
          : (state.index + 1) % MATHS_PROVISIONAL_PAGES.length;
        return [
          { index: nextIndex, inGuide: false },
          toOutput(MATHS_PROVISIONAL_PAGES[nextIndex]),
        ];
      }

      case 'Retour': {
        if (state.inGuide) {
          return [
            { index: state.index, inGuide: false },
            toOutput(MATHS_PROVISIONAL_PAGES[state.index]),
          ];
        }
        if (state.index > 0) {
          const prevIndex = state.index - 1;
          return [
            { index: prevIndex, inGuide: false },
            toOutput(MATHS_PROVISIONAL_PAGES[prevIndex]),
          ];
        }
        return [state, null];
      }

      default:
        return [state, null];
    }
  },
};
