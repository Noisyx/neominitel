import { COLOURS, type PageSource } from '../../src/videotex';

export const LIBRE_ACCUEIL_PAGE: PageSource = {
  id: 'libre/accueil',
  status: '3615 LIBRE             ATELIER MOSAIQUE',
  mosaics: [
    {
      row: 3,
      col: 35,
      fg: COLOURS.GREEN,
      bg: COLOURS.BLUE,
      bitmap: [
        '########',
        '##....##',
        '##.##.##',
        '##.##.##',
        '##....##',
        '########',
      ],
    },
  ],
  rows: [
    {
      row: 1,
      col: 1,
      segments: [
        { text: ' 3615 LIBRE - STUDIO VIDEOTEX ACOUSTIQUE', fg: COLOURS.BLACK, bg: COLOURS.GREEN },
      ],
    },
    {
      row: 3,
      col: 2,
      segments: [
        { text: 'Dessinez votre page 40 x 24', fg: COLOURS.GREEN },
      ],
    },
    {
      row: 4,
      col: 2,
      segments: [
        { text: 'en texte et pavés mosaïques.', fg: COLOURS.GREEN },
      ],
    },
    {
      row: 8,
      col: 2,
      segments: [
        { text: 'L atelier s ouvre sous le Minitel :', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 10,
      col: 2,
      segments: [
        { text: '- Grille graphique 80 x 72 sous-blocs', fg: COLOURS.YELLOW },
      ],
    },
    {
      row: 12,
      col: 2,
      segments: [
        { text: '- Diffusion directe par haut-parleur', fg: COLOURS.CYAN },
      ],
    },
    {
      row: 14,
      col: 2,
      segments: [
        { text: '- Exportation en fichier audio WAV', fg: COLOURS.MAGENTA },
      ],
    },
    {
      row: 16,
      col: 2,
      segments: [
        { text: '- Lien de partage sans aucun serveur', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 20,
      col: 2,
      segments: [
        { text: ' GUIDE ', fg: COLOURS.BLACK, bg: COLOURS.GREEN },
        { text: ' détails format ', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
        { text: ' FIN ', fg: COLOURS.WHITE, bg: COLOURS.RED },
        { text: ' quitter', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
      ],
    },
  ],
};

export const LIBRE_GUIDE_PAGE: PageSource = {
  id: 'libre/guide',
  status: '3615 LIBRE - GUIDE       NORME G1 STUM',
  rows: [
    {
      row: 1,
      col: 1,
      segments: [
        { text: ' FORMAT DES PAGES DANS 3615 LIBRE       ', fg: COLOURS.BLACK, bg: COLOURS.YELLOW },
      ],
    },
    {
      row: 4,
      col: 2,
      segments: [
        { text: 'Chaque cellule semi-graphique G1 du', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 5,
      col: 2,
      segments: [
        { text: 'Minitel découpe 2 par 3 sous-blocs', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 6,
      col: 2,
      segments: [
        { text: 'soit 64 motifs codés sur 7 bits.', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 9,
      col: 2,
      segments: [
        { text: 'Une page complète tient en quelques', fg: COLOURS.GREEN },
      ],
    },
    {
      row: 10,
      col: 2,
      segments: [
        { text: 'centaines d octets grâce au code REP', fg: COLOURS.GREEN },
      ],
    },
    {
      row: 11,
      col: 2,
      segments: [
        { text: 'et traverse la pièce en 4 à 7 secondes', fg: COLOURS.GREEN },
      ],
    },
    {
      row: 12,
      col: 2,
      segments: [
        { text: 'à 1200 bauds sur le haut-parleur.', fg: COLOURS.GREEN },
      ],
    },
    {
      row: 20,
      col: 2,
      segments: [
        { text: ' SOMMAIRE ', fg: COLOURS.BLACK, bg: COLOURS.GREEN },
        { text: ' retour accueil 3615 LIBRE', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
      ],
    },
  ],
};

export const LIBRE_PAGES: readonly PageSource[] = [
  LIBRE_ACCUEIL_PAGE,
  LIBRE_GUIDE_PAGE,
];
