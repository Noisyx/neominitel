import { MATHS_COURS_PAGES } from '../../content/pages/maths';
import { COLOURS, encodePage, type PageSource } from '../videotex';
import type { InputFieldSpec, Service, ServiceInput, ServiceOutput } from './types';

/** Number of 7-bit PN9 frames streamed after the Banc d'essai page (~60 s at 120 car/s). */
export const MATHS_BENCH_PN9_FRAMES = 7200;

export const MATHS_MENU_INPUT: InputFieldSpec = {
  row: 22,
  col: 18,
  maxLength: 8,
};

/**
 * Menu, bench and vote pages of 3615 MATHS. The six course pages written by the mathematician live
 * in `content/pages/maths.ts` (MATHS_COURS_PAGES) and open with menu choice 4 (app task 11.1).
 */
export const MATHS_PROVISIONAL_PAGES: readonly PageSource[] = [
  {
    id: 'maths/accueil',
    status: '3615 MATHS                SIGNAL & MODEM',
    rows: [
      {
        row: 1,
        col: 1,
        segments: [
          {
            text: ' 3615 MATHS - LABORATOIRE DU MODEM V.23 ',
            fg: COLOURS.BLACK,
            bg: COLOURS.CYAN,
          },
        ],
      },
      {
        row: 4,
        col: 2,
        segments: [
          {
            text: 'Explorez la théorie et mesurez en live',
            fg: COLOURS.WHITE,
          },
        ],
      },
      {
        row: 5,
        col: 2,
        segments: [
          { text: 'le récepteur FSK dans le Math HUD :', fg: COLOURS.WHITE },
        ],
      },
      {
        row: 8,
        col: 3,
        segments: [
          { text: ' 1 ', fg: COLOURS.BLACK, bg: COLOURS.CYAN },
          { text: ' Modulation FSK et indice h = 2/3', fg: COLOURS.CYAN, bg: COLOURS.BLACK },
        ],
      },
      {
        row: 11,
        col: 3,
        segments: [
          { text: ' 2 ', fg: COLOURS.BLACK, bg: COLOURS.YELLOW },
          { text: ' BANC : trames PN9 & courbes BER', fg: COLOURS.YELLOW, bg: COLOURS.BLACK },
        ],
      },
      {
        row: 14,
        col: 3,
        segments: [
          { text: ' 3 ', fg: COLOURS.BLACK, bg: COLOURS.GREEN },
          { text: ' VOTE : erreur sur 1/3/5/7 reçus', fg: COLOURS.GREEN, bg: COLOURS.BLACK },
        ],
      },
      {
        row: 16,
        col: 3,
        segments: [
          { text: ' 4 ', fg: COLOURS.BLACK, bg: COLOURS.WHITE },
          { text: ' COURS : les 6 pages expliquées', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
        ],
      },
      {
        row: 18,
        col: 2,
        segments: [
          { text: ' SUITE ', fg: COLOURS.BLACK, bg: COLOURS.CYAN },
          { text: ' parcourir ', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
          { text: ' GUIDE ', fg: COLOURS.BLACK, bg: COLOURS.CYAN },
          { text: ' aide', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
        ],
      },
      {
        row: 22,
        col: 2,
        segments: [
          { text: 'Choix ou code : ........', fg: COLOURS.YELLOW },
        ],
      },
    ],
  },
  {
    id: 'maths/fsk',
    status: '3615 MATHS - FSK V.23          PAGE 2/4',
    rows: [
      {
        row: 1,
        col: 1,
        segments: [
          {
            text: ' DEUX FREQUENCES POUR CODER LES BITS    ',
            fg: COLOURS.BLACK,
            bg: COLOURS.YELLOW,
          },
        ],
      },
      {
        row: 4,
        col: 2,
        segments: [
          { text: 'Sur la voie descendante du Minitel,', fg: COLOURS.WHITE },
        ],
      },
      {
        row: 5,
        col: 2,
        segments: [
          { text: 'chaque bit devient une tonalité pure :', fg: COLOURS.WHITE },
        ],
      },
      {
        row: 8,
        col: 4,
        segments: [
          {
            text: ' Bit 1 (mark)  -> tonalité grave ',
            fg: COLOURS.BLACK,
            bg: COLOURS.GREEN,
          },
        ],
      },
      {
        row: 10,
        col: 4,
        segments: [
          {
            text: ' Bit 0 (space) -> tonalité aiguë ',
            fg: COLOURS.WHITE,
            bg: COLOURS.BLUE,
          },
        ],
      },
      {
        row: 13,
        col: 2,
        segments: [
          { text: 'Indice de modulation : h = 2 / 3', fg: COLOURS.CYAN },
        ],
      },
      {
        row: 14,
        col: 2,
        segments: [
          { text: 'Corrélation |rho| = 0,4135 entre tons.', fg: COLOURS.CYAN },
        ],
      },
      {
        row: 19,
        col: 2,
        segments: [
          { text: ' SUITE ', fg: COLOURS.BLACK, bg: COLOURS.YELLOW },
          { text: ' Banc BER  ', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
          { text: ' SOMMAIRE ', fg: COLOURS.BLACK, bg: COLOURS.YELLOW },
          { text: ' menu', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
        ],
      },
    ],
  },
  {
    id: 'maths/banc',
    status: '3615 MATHS - BANC D ESSAI      PAGE 3/4',
    rows: [
      {
        row: 1,
        col: 1,
        segments: [
          {
            text: ' BANC D ESSAI : SEQUENCE PN9 & BER      ',
            fg: COLOURS.BLACK,
            bg: COLOURS.GREEN,
          },
        ],
      },
      {
        row: 4,
        col: 2,
        segments: [
          {
            text: 'Envoi continu de trames PN9 (x9+x5+1)',
            fg: COLOURS.WHITE,
          },
        ],
      },
      {
        row: 5,
        col: 2,
        segments: [
          {
            text: 'juste après affichage de cette page.',
            fg: COLOURS.WHITE,
          },
        ],
      },
      {
        row: 8,
        col: 2,
        segments: [
          { text: 'Dans le panneau Math HUD à droite :', fg: COLOURS.YELLOW },
        ],
      },
      {
        row: 10,
        col: 3,
        segments: [
          { text: '- Courbe 1 : FSK orthogonal idéal', fg: COLOURS.GREEN },
        ],
      },
      {
        row: 12,
        col: 3,
        segments: [
          { text: '- Courbe 2 : FSK corrélé (Marcum Q1)', fg: COLOURS.CYAN },
        ],
      },
      {
        row: 14,
        col: 3,
        segments: [
          { text: '- Courbe 3 : discriminateur simulé', fg: COLOURS.YELLOW },
        ],
      },
      {
        row: 15,
        col: 3,
        segments: [
          { text: '- Courbe 4 : corrélateurs simulés', fg: COLOURS.MAGENTA },
        ],
      },
      {
        row: 17,
        col: 2,
        segments: [
          {
            text: 'Variez Eb/N0 : un nouveau point BER',
            fg: COLOURS.WHITE,
          },
        ],
      },
      {
        row: 18,
        col: 2,
        segments: [
          {
            text: 'avec intervalle 95% arrive en < 2 s.',
            fg: COLOURS.WHITE,
          },
        ],
      },
      {
        row: 21,
        col: 2,
        segments: [
          { text: ' REPETITION ', fg: COLOURS.BLACK, bg: COLOURS.GREEN },
          { text: ' relancer ', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
          { text: ' SUITE ', fg: COLOURS.BLACK, bg: COLOURS.GREEN },
          { text: ' Vote', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
        ],
      },
    ],
  },
  {
    id: 'maths/vote',
    status: '3615 MATHS - VOTE MAJORITAIRE  PAGE 4/4',
    rows: [
      {
        row: 1,
        col: 1,
        segments: [
          {
            text: ' REPARATION PAR VOTE : 1, 3, 5, 7 RECUS ',
            fg: COLOURS.WHITE,
            bg: COLOURS.MAGENTA,
          },
        ],
      },
      {
        row: 4,
        col: 2,
        segments: [
          {
            text: '1 bit de parité détecte toute erreur',
            fg: COLOURS.WHITE,
          },
        ],
      },
      {
        row: 5,
        col: 2,
        segments: [
          {
            text: 'simple (effacement p), pas double :',
            fg: COLOURS.WHITE,
          },
        ],
      },
      {
        row: 7,
        col: 3,
        segments: [
          { text: 'P(non détectée) ~ 28 * eps^2 (q)', fg: COLOURS.CYAN },
        ],
      },
      {
        row: 10,
        col: 3,
        segments: [
          { text: 'Effacements seuls : P_echec = p^N', fg: COLOURS.GREEN },
        ],
      },
      {
        row: 12,
        col: 3,
        segments: [
          { text: 'Majorité brute : Somme C(N,k) q^k', fg: COLOURS.YELLOW },
        ],
      },
      {
        row: 16,
        col: 2,
        segments: [
          {
            text: 'Réglez Eb/N0 vers 12-14 dB et lancez',
            fg: COLOURS.WHITE,
          },
        ],
      },
      {
        row: 17,
        col: 2,
        segments: [
          {
            text: '7 réceptions face aux formules HUD.',
            fg: COLOURS.WHITE,
          },
        ],
      },
      {
        row: 21,
        col: 2,
        segments: [
          { text: ' REPETITION ', fg: COLOURS.WHITE, bg: COLOURS.MAGENTA },
          { text: ' +1 reçu ', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
          { text: ' SOMMAIRE ', fg: COLOURS.WHITE, bg: COLOURS.MAGENTA },
          { text: ' menu', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
        ],
      },
    ],
  },
];

export const MATHS_GUIDE_PAGE: PageSource = {
  id: 'maths/guide',
  status: '3615 MATHS - GUIDE             AIDE LABO',
  rows: [
    {
      row: 1,
      col: 1,
      segments: [
        {
          text: ' AIDE DU SERVICE 3615 MATHS             ',
          fg: COLOURS.WHITE,
          bg: COLOURS.BLUE,
        },
      ],
    },
    {
      row: 4,
      col: 2,
      segments: [
        { text: '- Tapez 1 à 4 puis ENVOI (4 = COURS)', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 6,
      col: 2,
      segments: [
        { text: '- Sur BANC : bougez le curseur Eb/N0', fg: COLOURS.CYAN },
      ],
    },
    {
      row: 7,
      col: 2,
      segments: [
        { text: '  pour tracer les points sur le HUD.', fg: COLOURS.CYAN },
      ],
    },
    {
      row: 9,
      col: 2,
      segments: [
        { text: '- Sur VOTE : cumulez 1, 3, 5, 7 reçus', fg: COLOURS.YELLOW },
      ],
    },
    {
      row: 10,
      col: 2,
      segments: [
        { text: '  face aux formules p^N et majorité.', fg: COLOURS.YELLOW },
      ],
    },
    {
      row: 19,
      col: 2,
      segments: [
        { text: ' SOMMAIRE ', fg: COLOURS.BLACK, bg: COLOURS.CYAN },
        { text: ' retour au menu MATHS', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
      ],
    },
  ],
};

export interface MathsState {
  readonly index: number;
  readonly inGuide: boolean;
  /** Position in MATHS_COURS_PAGES while the course (menu choice 4) is open; absent otherwise. */
  readonly cours?: number;
}

/** Menu choice that opens the course pages of `content/pages/maths.ts` (app task 11.1). */
export const MATHS_COURS_CHOICE = 4;

const HOME: MathsState = { index: 0, inGuide: false };

function coursOutput(i: number): [MathsState, ServiceOutput] {
  return [{ index: 0, inGuide: false, cours: i }, toOutput(MATHS_COURS_PAGES[i])];
}

function toOutput(page: PageSource): ServiceOutput {
  const res = encodePage(page);
  const base: ServiceOutput = {
    pageId: page.id,
    bytes: res.ok ? res.value.bytes : new Uint8Array([0x0c]),
  };
  if (page.id === 'maths/accueil') {
    return { ...base, input: MATHS_MENU_INPUT };
  }
  if (page.id === 'maths/banc') {
    return { ...base, testPattern: { frames: MATHS_BENCH_PN9_FRAMES } };
  }
  return base;
}

function resolveMenuChoice(raw: string): number | null {
  const cleaned = raw.trim().toUpperCase();
  if (cleaned === '1' || cleaned === 'FSK') return 1;
  if (cleaned === '2' || cleaned === 'BANC' || cleaned === 'BER') return 2;
  if (cleaned === '3' || cleaned === 'VOTE') return 3;
  if (cleaned === '4' || cleaned === 'COURS') return MATHS_COURS_CHOICE;
  return null;
}

export const mathsService: Service<MathsState> = {
  id: 'MATHS',

  init(): [MathsState, ServiceOutput] {
    return [{ index: 0, inGuide: false }, toOutput(MATHS_PROVISIONAL_PAGES[0])];
  },

  handle(state: MathsState, input: ServiceInput): [MathsState, ServiceOutput | null] {
    // Course pages (menu choice 4): SUITE / RETOUR walk the six pages, then back to the menu.
    if (state.cours !== undefined) {
      const c = state.cours;
      switch (input.key) {
        case 'Sommaire':
          return [HOME, toOutput(MATHS_PROVISIONAL_PAGES[0])];
        case 'Guide':
          return [{ ...state, inGuide: true }, toOutput(MATHS_GUIDE_PAGE)];
        case 'Suite':
          if (state.inGuide) return coursOutput(c);
          return c + 1 < MATHS_COURS_PAGES.length ? coursOutput(c + 1) : [HOME, toOutput(MATHS_PROVISIONAL_PAGES[0])];
        case 'Retour':
          if (state.inGuide) return coursOutput(c);
          return c > 0 ? coursOutput(c - 1) : [HOME, toOutput(MATHS_PROVISIONAL_PAGES[0])];
        default:
          return [state, null];
      }
    }
    switch (input.key) {
      case 'Sommaire':
        return [{ index: 0, inGuide: false }, toOutput(MATHS_PROVISIONAL_PAGES[0])];

      case 'Guide':
        return [{ index: state.index, inGuide: true }, toOutput(MATHS_GUIDE_PAGE)];

      case 'Envoi': {
        if (!state.inGuide && state.index === 0) {
          const targetIdx = resolveMenuChoice(input.text);
          if (targetIdx === MATHS_COURS_CHOICE) return coursOutput(0);
          if (targetIdx !== null) {
            return [
              { index: targetIdx, inGuide: false },
              toOutput(MATHS_PROVISIONAL_PAGES[targetIdx]),
            ];
          }
        }
        return [state, null];
      }

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
