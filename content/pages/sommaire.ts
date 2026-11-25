import { COLOURS, type PageSource } from '../../src/videotex';

export const SOMMAIRE_INPUT_FIELD = {
  row: 22,
  col: 16,
  maxLength: 12,
} as const;

export const SOMMAIRE_ACCUEIL_PAGE: PageSource = {
  id: 'sommaire/accueil',
  status: '3615 SOMMAIRE             1200/75 V.23',
  mosaics: [
    {
      row: 2,
      col: 2,
      fg: COLOURS.YELLOW,
      bg: COLOURS.BLUE,
      bitmap: [
        '######..######....##....######',
        '....##..##.......###....##....',
        '..####..######....##....######',
        '....##..##..##....##........##',
        '....##..##..##....##....##..##',
        '######..######..######..######',
      ],
    },
  ],
  rows: [
    {
      row: 2,
      col: 18,
      segments: [
        { text: ' ANNUAIRE NEOMINITEL   ', fg: COLOURS.BLACK, bg: COLOURS.YELLOW },
      ],
    },
    {
      row: 3,
      col: 18,
      segments: [
        { text: ' Le Vidéotex par le son', fg: COLOURS.WHITE, bg: COLOURS.BLUE },
      ],
    },
    {
      row: 5,
      col: 1,
      segments: [
        { text: '========================================', fg: COLOURS.BLUE },
      ],
    },
    {
      row: 7,
      col: 2,
      segments: [
        { text: 'Services Télétel ouverts sur la ligne :', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 9,
      col: 2,
      segments: [
        { text: ' MATHS   ', fg: COLOURS.BLACK, bg: COLOURS.CYAN },
        { text: ' Modem FSK, bruit et courbes', fg: COLOURS.CYAN, bg: COLOURS.BLACK },
      ],
    },
    {
      row: 10,
      col: 11,
      segments: [
        { text: 'Banc de mesure BER en direct', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 12,
      col: 2,
      segments: [
        { text: ' FANTOME ', fg: COLOURS.BLACK, bg: COLOURS.MAGENTA },
        { text: ' Cinq appels hantés sur V.23', fg: COLOURS.MAGENTA, bg: COLOURS.BLACK },
      ],
    },
    {
      row: 13,
      col: 11,
      segments: [
        { text: 'Décodez les spectres du réseau', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 15,
      col: 2,
      segments: [
        { text: ' LIBRE   ', fg: COLOURS.BLACK, bg: COLOURS.GREEN },
        { text: ' Studio de création mosaïque', fg: COLOURS.GREEN, bg: COLOURS.BLACK },
      ],
    },
    {
      row: 16,
      col: 11,
      segments: [
        { text: 'Composez et diffusez en audio', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 19,
      col: 2,
      segments: [
        { text: ' GUIDE ', fg: COLOURS.BLACK, bg: COLOURS.WHITE },
        { text: ' mode d emploi ', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
        { text: ' SUITE ', fg: COLOURS.BLACK, bg: COLOURS.WHITE },
        { text: ' histoire', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
      ],
    },
    {
      row: 21,
      col: 1,
      segments: [
        { text: '----------------------------------------', fg: COLOURS.BLUE },
      ],
    },
    {
      row: 22,
      col: 2,
      segments: [
        { text: 'Code service : ', fg: COLOURS.YELLOW },
        { text: '............', fg: COLOURS.CYAN },
        { text: ' + ', fg: COLOURS.WHITE },
        { text: ' ENVOI ', fg: COLOURS.BLACK, bg: COLOURS.GREEN },
      ],
    },
  ],
};

export const SOMMAIRE_SUITE_PAGE: PageSource = {
  id: 'sommaire/histoire',
  status: '3615 SOMMAIRE - HISTOIRE       PAGE 2/2',
  rows: [
    {
      row: 1,
      col: 1,
      segments: [
        { text: ' LA RESURRECTION DU RESEAU TELETEL      ', fg: COLOURS.BLACK, bg: COLOURS.CYAN },
      ],
    },
    {
      row: 3,
      col: 2,
      segments: [
        { text: 'Le 30 juin 2012, neuf millions de', fg: COLOURS.YELLOW },
      ],
    },
    {
      row: 4,
      col: 2,
      segments: [
        { text: 'terminaux Minitel se sont tus après', fg: COLOURS.YELLOW },
      ],
    },
    {
      row: 5,
      col: 2,
      segments: [
        { text: 'trente années de vie numérique.', fg: COLOURS.YELLOW },
      ],
    },
    {
      row: 7,
      col: 2,
      segments: [
        { text: 'NeoMinitel recrée la couche physique', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 8,
      col: 2,
      segments: [
        { text: 'exacte de la norme ITU-T V.23 :', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 10,
      col: 3,
      segments: [
        { text: '* Voie descendante : 1200 bauds FSK', fg: COLOURS.GREEN },
      ],
    },
    {
      row: 11,
      col: 3,
      segments: [
        { text: '* Fréquences : 1300 Hz et 2100 Hz', fg: COLOURS.GREEN },
      ],
    },
    {
      row: 12,
      col: 3,
      segments: [
        { text: '* Trame série : 7 bits, parité paire', fg: COLOURS.GREEN },
      ],
    },
    {
      row: 13,
      col: 3,
      segments: [
        { text: '* Débit écran : 120 caractères/sec', fg: COLOURS.GREEN },
      ],
    },
    {
      row: 15,
      col: 2,
      segments: [
        { text: 'Un téléphone posé près du micro suffit', fg: COLOURS.CYAN },
      ],
    },
    {
      row: 16,
      col: 2,
      segments: [
        { text: 'pour transmettre une page dans l air,', fg: COLOURS.CYAN },
      ],
    },
    {
      row: 17,
      col: 2,
      segments: [
        { text: 'sans serveur ni connexion réseau.', fg: COLOURS.CYAN },
      ],
    },
    {
      row: 20,
      col: 2,
      segments: [
        { text: ' RETOUR ', fg: COLOURS.BLACK, bg: COLOURS.YELLOW },
        { text: ' ou ', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
        { text: ' SOMMAIRE ', fg: COLOURS.BLACK, bg: COLOURS.YELLOW },
        { text: ' vers l accueil', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
      ],
    },
    {
      row: 22,
      col: 2,
      segments: [
        { text: 'Code service : ', fg: COLOURS.YELLOW },
        { text: '............', fg: COLOURS.CYAN },
        { text: ' + ', fg: COLOURS.WHITE },
        { text: ' ENVOI ', fg: COLOURS.BLACK, bg: COLOURS.GREEN },
      ],
    },
  ],
};

export const SOMMAIRE_GUIDE_PAGE: PageSource = {
  id: 'sommaire/guide',
  status: '3615 SOMMAIRE - GUIDE          AIDE V.23',
  rows: [
    {
      row: 1,
      col: 1,
      segments: [
        { text: ' GUIDE DES TOUCHES DU TERMINAL MINITEL  ', fg: COLOURS.WHITE, bg: COLOURS.BLUE },
      ],
    },
    {
      row: 3,
      col: 2,
      segments: [
        { text: 'ENVOI      (Entrée)   Valider le code', fg: COLOURS.YELLOW },
      ],
    },
    {
      row: 5,
      col: 2,
      segments: [
        { text: 'SUITE      (PageBas)  Page suivante', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 7,
      col: 2,
      segments: [
        { text: 'RETOUR     (PageHaut) Page précédente', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 9,
      col: 2,
      segments: [
        { text: 'SOMMAIRE   (Début)    Accueil service', fg: COLOURS.CYAN },
      ],
    },
    {
      row: 11,
      col: 2,
      segments: [
        { text: 'REPETITION (Alt+R)    Renvoyer la page', fg: COLOURS.GREEN },
      ],
    },
    {
      row: 13,
      col: 2,
      segments: [
        { text: 'CORRECTION (Ret.Arr)  Effacer 1 signe', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 15,
      col: 2,
      segments: [
        { text: 'ANNULATION (Echap)    Vider la saisie', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 17,
      col: 2,
      segments: [
        { text: 'GUIDE      (Alt+G)    Ouvrir cette aide', fg: COLOURS.MAGENTA },
      ],
    },
    {
      row: 19,
      col: 2,
      segments: [
        { text: 'CONNEX/FIN (Fin)      Couper la ligne', fg: COLOURS.RED },
      ],
    },
    {
      row: 22,
      col: 2,
      segments: [
        { text: 'Appuyez sur ', fg: COLOURS.WHITE },
        { text: ' SOMMAIRE ', fg: COLOURS.BLACK, bg: COLOURS.CYAN },
        { text: ' pour revenir.', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
      ],
    },
  ],
};

export const SOMMAIRE_ERREUR_PAGE: PageSource = {
  id: 'sommaire/erreur',
  status: '3615 SOMMAIRE - CODE INCONNU     ERREUR',
  rows: [
    {
      row: 1,
      col: 1,
      segments: [
        { text: ' CODE SERVICE INCONNU SUR CE RESEAU     ', fg: COLOURS.WHITE, bg: COLOURS.RED },
      ],
    },
    {
      row: 4,
      col: 2,
      segments: [
        { text: 'Le centre serveur Télétel ne reconnaît', fg: COLOURS.YELLOW },
      ],
    },
    {
      row: 5,
      col: 2,
      segments: [
        { text: 'pas le code que vous avez transmis.', fg: COLOURS.YELLOW },
      ],
    },
    {
      row: 8,
      col: 2,
      segments: [
        { text: 'Codes valides actuellement ouverts :', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 10,
      col: 2,
      segments: [
        { text: ' -> MATHS    (laboratoire du signal)  ', fg: COLOURS.CYAN, bg: COLOURS.BLUE },
      ],
    },
    {
      row: 12,
      col: 2,
      segments: [
        { text: ' -> FANTOME  (énigmes acoustiques)    ', fg: COLOURS.YELLOW, bg: COLOURS.RED },
      ],
    },
    {
      row: 14,
      col: 2,
      segments: [
        { text: ' -> LIBRE    (atelier mosaïque)       ', fg: COLOURS.BLACK, bg: COLOURS.GREEN },
      ],
    },
    {
      row: 16,
      col: 2,
      segments: [
        { text: ' -> SOMMAIRE (annuaire principal)     ', fg: COLOURS.BLACK, bg: COLOURS.WHITE },
      ],
    },
    {
      row: 19,
      col: 2,
      segments: [
        { text: 'Vérifiez l orthographe ou appuyez sur', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 20,
      col: 2,
      segments: [
        { text: ' SOMMAIRE ', fg: COLOURS.BLACK, bg: COLOURS.YELLOW },
        { text: ' pour revoir l annuaire.', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
      ],
    },
    {
      row: 22,
      col: 2,
      segments: [
        { text: 'Code service : ', fg: COLOURS.YELLOW },
        { text: '............', fg: COLOURS.CYAN },
        { text: ' + ', fg: COLOURS.WHITE },
        { text: ' ENVOI ', fg: COLOURS.BLACK, bg: COLOURS.GREEN },
      ],
    },
  ],
};

export const SOMMAIRE_PAGES: readonly PageSource[] = [
  SOMMAIRE_ACCUEIL_PAGE,
  SOMMAIRE_SUITE_PAGE,
  SOMMAIRE_GUIDE_PAGE,
  SOMMAIRE_ERREUR_PAGE,
];
