import { COLOURS, type PageSource } from '../../src/videotex';

export const FANTOME_ACCUEIL_PAGE: PageSource = {
  id: 'fantome/accueil',
  status: '3615 FANTOME           FREQUENCE NOIRE',
  mosaics: [
    {
      row: 3,
      col: 2,
      fg: COLOURS.MAGENTA,
      bg: COLOURS.BLACK,
      bitmap: [
        '..######..',
        '.########.',
        '##########',
        '##..##..##',
        '##########',
        '##########',
        '##########',
        '##..##..##',
        '#...##...#',
      ],
    },
  ],
  rows: [
    {
      row: 1,
      col: 1,
      segments: [
        { text: ' 3615 FANTOME - ARCHIVES HANTEES P.T.T. ', fg: COLOURS.BLACK, bg: COLOURS.MAGENTA },
      ],
    },
    {
      row: 3,
      col: 9,
      segments: [
        { text: 'Depuis le soir du 30 juin 2012,', fg: COLOURS.MAGENTA },
      ],
    },
    {
      row: 4,
      col: 9,
      segments: [
        { text: 'un central oublié émet encore', fg: COLOURS.MAGENTA },
      ],
    },
    {
      row: 5,
      col: 9,
      segments: [
        { text: 'sur les vieilles paires P.T.T.', fg: COLOURS.MAGENTA },
      ],
    },
    {
      row: 8,
      col: 2,
      segments: [
        { text: 'Cinq transmissions fantômes ont été', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 9,
      col: 2,
      segments: [
        { text: 'captées avec de vrais défauts radio :', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 11,
      col: 2,
      segments: [
        { text: '1. La dernière veille  (ligne claire)', fg: COLOURS.CYAN },
      ],
    },
    {
      row: 13,
      col: 2,
      segments: [
        { text: '2. Poste désaccordé    (dérive +380Hz)', fg: COLOURS.YELLOW },
      ],
    },
    {
      row: 15,
      col: 2,
      segments: [
        { text: '3. L orage magnétique  (parasites)', fg: COLOURS.GREEN },
      ],
    },
    {
      row: 17,
      col: 2,
      segments: [
        { text: '4. La chambre d écho   (bruit + vote)', fg: COLOURS.RED },
      ],
    },
    {
      row: 20,
      col: 2,
      segments: [
        { text: ' GUIDE ', fg: COLOURS.BLACK, bg: COLOURS.MAGENTA },
        { text: ' conseils radio ', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
        { text: ' FIN ', fg: COLOURS.WHITE, bg: COLOURS.RED },
        { text: ' quitter', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
      ],
    },
    {
      row: 22,
      col: 2,
      segments: [
        { text: 'Ouverture complète des niveaux : J10', fg: COLOURS.YELLOW },
      ],
    },
  ],
};

export const FANTOME_GUIDE_PAGE: PageSource = {
  id: 'fantome/guide',
  status: '3615 FANTOME - GUIDE        AIDE RADIO',
  rows: [
    {
      row: 1,
      col: 1,
      segments: [
        { text: ' MANUEL DE CHASSEUR D ONDES FANTOMES    ', fg: COLOURS.WHITE, bg: COLOURS.RED },
      ],
    },
    {
      row: 4,
      col: 2,
      segments: [
        { text: 'Chaque spectre cache un mot de passe', fg: COLOURS.YELLOW },
      ],
    },
    {
      row: 5,
      col: 2,
      segments: [
        { text: 'dans une transmission audio altérée.', fg: COLOURS.YELLOW },
      ],
    },
    {
      row: 8,
      col: 2,
      segments: [
        { text: 'Si toute la page semble illisible :', fg: COLOURS.MAGENTA },
      ],
    },
    {
      row: 9,
      col: 3,
      segments: [
        { text: 'activez l Accord automatique du seuil', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 10,
      col: 3,
      segments: [
        { text: 'pour compenser le décalage en Hz.', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 13,
      col: 2,
      segments: [
        { text: 'Si des blocs hachurés trouent le mot :', fg: COLOURS.CYAN },
      ],
    },
    {
      row: 14,
      col: 3,
      segments: [
        { text: 'activez le Vote majoritaire et laissez', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 15,
      col: 3,
      segments: [
        { text: 'plusieurs réceptions réparer l écran.', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 20,
      col: 2,
      segments: [
        { text: ' SOMMAIRE ', fg: COLOURS.BLACK, bg: COLOURS.MAGENTA },
        { text: ' retour aux archives FANTOME', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
      ],
    },
  ],
};

export const FANTOME_PAGES: readonly PageSource[] = [
  FANTOME_ACCUEIL_PAGE,
  FANTOME_GUIDE_PAGE,
];
