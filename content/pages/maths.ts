// 3615 MATHS: the six explanation pages written by the mathematician (Role B), requirement 6.1 of
// neominitel-app and task 11.1. Every figure comes from the v23-modem spec, docs/math.md or
// docs/calibration.md. Mosaic diagrams are 2x3 G1 sub-blocks ('#' = foreground).
import { COLOURS, type PageSource } from '../../src/videotex';

/** Bitmap of a two-level line signal: each bit is `w` sub-blocks wide, 1 = top line, 0 = bottom. */
function levelsBitmap(bits: readonly number[], w: number, height: number): string[] {
  const rows: string[][] = Array.from({ length: height }, () => []);
  bits.forEach((b, i) => {
    const prev = i > 0 ? bits[i - 1] : b;
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < height; y++) {
        const edge = x === 0 && prev !== b;
        const on = edge || (b === 1 ? y === 0 : y === height - 1);
        rows[y].push(on ? '#' : '.');
      }
    }
  });
  return rows.map((r) => r.join(''));
}

/** Bitmap of a falling curve y = f(x) on a w x h grid, with axes on the left and bottom. */
function curveBitmap(w: number, h: number, f: (x: number) => number): string[] {
  const g: string[][] = Array.from({ length: h }, () => Array.from({ length: w }, () => '.'));
  for (let y = 0; y < h; y++) g[y][0] = '#';
  for (let x = 0; x < w; x++) g[h - 1][x] = '#';
  let prevY = -1;
  for (let x = 1; x < w; x++) {
    const y = Math.max(0, Math.min(h - 2, Math.round(f(x / (w - 1)) * (h - 2))));
    const from = prevY < 0 ? y : Math.min(prevY, y);
    const to = prevY < 0 ? y : Math.max(prevY, y);
    for (let yy = from; yy <= to; yy++) g[yy][x] = '#';
    prevY = y;
  }
  return g.map((r) => r.join(''));
}

/** Two horizontal tone lines (rows yMark and ySpace) and a dashed threshold line between them. */
function tonesBitmap(w: number, h: number, yMark: number, ySpace: number, yThr: number): string[] {
  const g: string[][] = Array.from({ length: h }, () => Array.from({ length: w }, () => '.'));
  for (let x = 0; x < w; x++) {
    g[yMark][x] = '#';
    g[ySpace][x] = '#';
    if (x % 4 < 2) g[yThr][x] = '#';
  }
  return g.map((r) => r.join(''));
}

// Bits 1 1 0 1 0 0 1 drawn as frequency: 1 = top line here means the high tone, i.e. bit 0.
const HIGH_TONE_OF_1101001 = [1, 1, 0, 1, 0, 0, 1].map((b) => 1 - b);

// 'A' = 0x41: start 0, data bits LSB first 1000001, even parity 0, stop 1.
const LETTER_A_LINE_BITS = [0, 1, 0, 0, 0, 0, 0, 1, 0, 1];

export const MATHS_COURS_FSK_PAGE: PageSource = {
  id: 'maths/cours-fsk',
  status: '3615 MATHS - COURS 1/6         FSK V.23',
  rows: [
    {
      row: 1,
      col: 1,
      segments: [{ text: ' 1. DEUX TONS, UNE PHASE CONTINUE       ', fg: COLOURS.BLACK, bg: COLOURS.CYAN }],
    },
    { row: 3, col: 2, segments: [{ text: 'Chaque bit dure 1/1200 s et devient', fg: COLOURS.WHITE }] },
    { row: 4, col: 2, segments: [{ text: 'une tonalité pure :', fg: COLOURS.WHITE }] },
    {
      row: 6,
      col: 3,
      segments: [
        { text: ' 1 ', fg: COLOURS.BLACK, bg: COLOURS.GREEN },
        { text: ' mark  = 1300 Hz (grave)', fg: COLOURS.GREEN, bg: COLOURS.BLACK },
      ],
    },
    {
      row: 7,
      col: 3,
      segments: [
        { text: ' 0 ', fg: COLOURS.WHITE, bg: COLOURS.BLUE },
        { text: ' space = 2100 Hz (aigu)', fg: COLOURS.CYAN, bg: COLOURS.BLACK },
      ],
    },
    { row: 12, col: 2, segments: [{ text: 'Le ton change sans saut de phase :', fg: COLOURS.WHITE }] },
    { row: 13, col: 2, segments: [{ text: 'pas de clic, un sifflement continu.', fg: COLOURS.WHITE }] },
    { row: 15, col: 2, segments: [{ text: 'Indice de modulation :', fg: COLOURS.YELLOW }] },
    { row: 16, col: 4, segments: [{ text: 'h = 800 Hz x 1/1200 s = 2/3', fg: COLOURS.YELLOW }] },
    { row: 18, col: 2, segments: [{ text: 'Sur un bit, les deux tons ne sont pas', fg: COLOURS.WHITE }] },
    { row: 19, col: 2, segments: [{ text: 'orthogonaux : corrélation 0,41.', fg: COLOURS.WHITE }] },
    { row: 20, col: 2, segments: [{ text: 'Cela coûte du rapport signal/bruit.', fg: COLOURS.WHITE }] },
    {
      row: 22,
      col: 2,
      segments: [
        { text: ' SUITE ', fg: COLOURS.BLACK, bg: COLOURS.CYAN },
        { text: ' trame et parité', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
      ],
    },
  ],
  mosaics: [
    {
      row: 9,
      col: 3,
      fg: COLOURS.GREEN,
      bg: COLOURS.BLACK,
      // Frequency over time for the bits 1 1 0 1 0 0 1: top line = 2100 Hz (bit 0).
      bitmap: levelsBitmap(HIGH_TONE_OF_1101001, 10, 6),
    },
  ],
};

export const MATHS_COURS_TRAME_PAGE: PageSource = {
  id: 'maths/cours-trame',
  status: '3615 MATHS - COURS 2/6        TRAME 7E1',
  rows: [
    {
      row: 1,
      col: 1,
      segments: [{ text: ' 2. UN CARACTERE = 10 BITS DE LIGNE     ', fg: COLOURS.BLACK, bg: COLOURS.YELLOW }],
    },
    { row: 3, col: 2, segments: [{ text: 'start  7 données  parité  stop', fg: COLOURS.YELLOW }] },
    { row: 4, col: 2, segments: [{ text: '  0    poids      paire    1', fg: COLOURS.WHITE }] },
    { row: 5, col: 2, segments: [{ text: '       faible en tête', fg: COLOURS.WHITE }] },
    { row: 7, col: 2, segments: [{ text: 'Exemple : la lettre A = 1000001', fg: COLOURS.CYAN }] },
    { row: 12, col: 2, segments: [{ text: 'ligne : 0  1000001  0  1', fg: COLOURS.CYAN }] },
    { row: 14, col: 2, segments: [{ text: '1200 bits/s / 10 = 120 caractères/s :', fg: COLOURS.WHITE }] },
    { row: 15, col: 2, segments: [{ text: 'une page de 1000 octets en 8,3 s.', fg: COLOURS.WHITE }] },
    { row: 17, col: 2, segments: [{ text: 'La parité paire détecte toute erreur', fg: COLOURS.GREEN }] },
    { row: 18, col: 2, segments: [{ text: 'sur 1 bit, mais aucune sur 2 bits.', fg: COLOURS.GREEN }] },
    { row: 19, col: 2, segments: [{ text: 'Chaque trame se recale sur son start :', fg: COLOURS.WHITE }] },
    { row: 20, col: 2, segments: [{ text: 'horloge tolérée à plus ou moins 2 %.', fg: COLOURS.WHITE }] },
    {
      row: 22,
      col: 2,
      segments: [
        { text: ' SUITE ', fg: COLOURS.BLACK, bg: COLOURS.YELLOW },
        { text: ' le discriminateur', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
      ],
    },
  ],
  mosaics: [
    {
      row: 9,
      col: 3,
      fg: COLOURS.YELLOW,
      bg: COLOURS.BLACK,
      bitmap: levelsBitmap(LETTER_A_LINE_BITS, 7, 6),
    },
  ],
};

export const MATHS_COURS_DISCRI_PAGE: PageSource = {
  id: 'maths/cours-discri',
  status: '3615 MATHS - COURS 3/6   DISCRIMINATEUR',
  rows: [
    {
      row: 1,
      col: 1,
      segments: [{ text: ' 3. LIRE LA FREQUENCE DANS LE BRUIT     ', fg: COLOURS.WHITE, bg: COLOURS.BLUE }],
    },
    { row: 3, col: 2, segments: [{ text: 'Etape 1 : décaler toute la bande pour', fg: COLOURS.WHITE }] },
    { row: 4, col: 2, segments: [{ text: 'que 1800 Hz devienne 0 Hz.', fg: COLOURS.WHITE }] },
    { row: 5, col: 4, segments: [{ text: 'mark -> -500 Hz, space -> +300 Hz', fg: COLOURS.CYAN }] },
    { row: 7, col: 2, segments: [{ text: 'Etape 2 : filtre passe-bas, -6 dB à', fg: COLOURS.WHITE }] },
    { row: 8, col: 2, segments: [{ text: '1100 Hz. Voie retour et 50 Hz : -52 dB.', fg: COLOURS.WHITE }] },
    { row: 13, col: 2, segments: [{ text: 'Etape 3 : la fréquence est la vitesse', fg: COLOURS.WHITE }] },
    { row: 14, col: 2, segments: [{ text: 'de rotation de la phase du signal :', fg: COLOURS.WHITE }] },
    { row: 15, col: 4, segments: [{ text: 'f = 1800 + angle(z(n) z*(n-1))', fg: COLOURS.YELLOW }] },
    { row: 16, col: 13, segments: [{ text: 'x fs / (2 pi)', fg: COLOURS.YELLOW }] },
    { row: 18, col: 2, segments: [{ text: 'Etape 4 : moyenne de f sur la moitié', fg: COLOURS.WHITE }] },
    { row: 19, col: 2, segments: [{ text: 'centrale du bit, comparée au seuil.', fg: COLOURS.WHITE }] },
    { row: 20, col: 2, segments: [{ text: 'Erreur mesurée sur un ton pur : 1 Hz.', fg: COLOURS.GREEN }] },
    {
      row: 22,
      col: 2,
      segments: [
        { text: ' SUITE ', fg: COLOURS.WHITE, bg: COLOURS.BLUE },
        { text: ' le seuil adaptatif', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
      ],
    },
  ],
  mosaics: [
    {
      row: 10,
      col: 3,
      fg: COLOURS.CYAN,
      bg: COLOURS.BLACK,
      // Spectrum after the shift: filter passband (box) around 0 Hz, the two tones as bars.
      bitmap: [
        '......################################......',
        '......#..........#...........#.......#......',
        '......#..........#...........#.......#......',
        '......#..........#...........#.......#......',
        '......#..........#...........#.......#......',
        '############################################',
      ],
    },
  ],
};

export const MATHS_COURS_SEUIL_PAGE: PageSource = {
  id: 'maths/cours-seuil',
  status: '3615 MATHS - COURS 4/6  SEUIL ADAPTATIF',
  rows: [
    {
      row: 1,
      col: 1,
      segments: [{ text: ' 4. ACCORD AUTOMATIQUE DU RECEPTEUR     ', fg: COLOURS.BLACK, bg: COLOURS.GREEN }],
    },
    { row: 3, col: 2, segments: [{ text: 'Seuil fixe : 1700 Hz, le milieu des', fg: COLOURS.WHITE }] },
    { row: 4, col: 2, segments: [{ text: 'deux tons. Une radio désaccordée de', fg: COLOURS.WHITE }] },
    { row: 5, col: 2, segments: [{ text: '+380 Hz pousse le mark vers le seuil.', fg: COLOURS.WHITE }] },
    { row: 11, col: 2, segments: [{ text: 'Le seuil adaptatif apprend les tons :', fg: COLOURS.GREEN }] },
    { row: 12, col: 3, segments: [{ text: '- mark = moyenne sur 20 ms de repos', fg: COLOURS.WHITE }] },
    { row: 13, col: 3, segments: [{ text: '- puis, sur 5 bits identiques :', fg: COLOURS.WHITE }] },
    { row: 14, col: 5, segments: [{ text: 'm <- 0,95 m + 0,05 f', fg: COLOURS.YELLOW }] },
    { row: 15, col: 3, segments: [{ text: '- seuil = (m mark + m space) / 2', fg: COLOURS.WHITE }] },
    { row: 17, col: 2, segments: [{ text: 'Mesuré de -400 à +400 Hz, 20 dB :', fg: COLOURS.CYAN }] },
    { row: 18, col: 2, segments: [{ text: 'aucun octet faux, décalage estimé', fg: COLOURS.CYAN }] },
    { row: 19, col: 2, segments: [{ text: 'à 11 Hz près au pire.', fg: COLOURS.CYAN }] },
    {
      row: 22,
      col: 2,
      segments: [
        { text: ' SUITE ', fg: COLOURS.BLACK, bg: COLOURS.GREEN },
        { text: ' BER et Eb/N0', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
      ],
    },
  ],
  mosaics: [
    {
      row: 7,
      col: 3,
      fg: COLOURS.GREEN,
      bg: COLOURS.BLACK,
      // Space line (top), adaptive threshold (dashed), offset mark line (bottom).
      bitmap: tonesBitmap(60, 9, 0, 8, 4),
    },
  ],
};

export const MATHS_COURS_BER_PAGE: PageSource = {
  id: 'maths/cours-ber',
  status: '3615 MATHS - COURS 5/6     BER ET EB/N0',
  rows: [
    {
      row: 1,
      col: 1,
      segments: [{ text: ' 5. COMPTER LES ERREURS FACE AU BRUIT   ', fg: COLOURS.WHITE, bg: COLOURS.RED }],
    },
    { row: 3, col: 2, segments: [{ text: 'Eb/N0 : énergie d un bit de ligne sur', fg: COLOURS.WHITE }] },
    { row: 4, col: 2, segments: [{ text: 'la densité du bruit blanc.', fg: COLOURS.WHITE }] },
    { row: 6, col: 21, segments: [{ text: 'BER', fg: COLOURS.YELLOW }] },
    { row: 7, col: 21, segments: [{ text: 'erreurs / bits', fg: COLOURS.WHITE }] },
    { row: 8, col: 21, segments: [{ text: 'baisse quand', fg: COLOURS.WHITE }] },
    { row: 9, col: 21, segments: [{ text: 'Eb/N0 monte', fg: COLOURS.WHITE }] },
    { row: 12, col: 2, segments: [{ text: '1 : FSK orthogonal, 1/2 exp(-Eb/2N0)', fg: COLOURS.GREEN }] },
    { row: 13, col: 2, segments: [{ text: '2 : tons corrélés à 0,41 (Marcum Q1)', fg: COLOURS.CYAN }] },
    { row: 14, col: 2, segments: [{ text: '3 : notre récepteur, simulé', fg: COLOURS.YELLOW }] },
    { row: 16, col: 2, segments: [{ text: 'Mesure : suite PN9 (x9+x5+1, 511 bits)', fg: COLOURS.WHITE }] },
    { row: 17, col: 2, segments: [{ text: 'et intervalle de Wilson à 95 %.', fg: COLOURS.WHITE }] },
    { row: 19, col: 2, segments: [{ text: 'Un bit faux sur mille vers 15 dB.', fg: COLOURS.MAGENTA }] },
    { row: 20, col: 2, segments: [{ text: 'Garanti sur 20 essais : 16,5 dB.', fg: COLOURS.MAGENTA }] },
    {
      row: 22,
      col: 2,
      segments: [
        { text: ' SUITE ', fg: COLOURS.WHITE, bg: COLOURS.RED },
        { text: ' le vote', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
      ],
    },
  ],
  mosaics: [
    {
      row: 6,
      col: 3,
      fg: COLOURS.YELLOW,
      bg: COLOURS.BLACK,
      // log BER against Eb/N0: a falling, steepening curve.
      bitmap: curveBitmap(32, 15, (x) => x * x * 1.1),
    },
  ],
};

export const MATHS_COURS_VOTE_PAGE: PageSource = {
  id: 'maths/cours-vote',
  status: '3615 MATHS - COURS 6/6    VOTE MAJORITE',
  rows: [
    {
      row: 1,
      col: 1,
      segments: [{ text: ' 6. REPARER UNE PAGE PAR LE VOTE        ', fg: COLOURS.WHITE, bg: COLOURS.MAGENTA }],
    },
    { row: 3, col: 2, segments: [{ text: 'REPETITION renvoie la page. Pour', fg: COLOURS.WHITE }] },
    { row: 4, col: 2, segments: [{ text: 'chaque case, le terminal vote entre', fg: COLOURS.WHITE }] },
    { row: 5, col: 2, segments: [{ text: 'toutes les réceptions.', fg: COLOURS.WHITE }] },
    { row: 10, col: 2, segments: [{ text: 'Case vue fausse (parité) : ignorée.', fg: COLOURS.GREEN }] },
    { row: 11, col: 2, segments: [{ text: 'Echec si les N copies sont fausses :', fg: COLOURS.GREEN }] },
    { row: 12, col: 5, segments: [{ text: 'p x p x ... x p  (N fois)', fg: COLOURS.YELLOW }] },
    { row: 14, col: 2, segments: [{ text: 'Erreur cachée (2 bits faux) : on prend', fg: COLOURS.CYAN }] },
    { row: 15, col: 2, segments: [{ text: 'la majorité. Probabilité d une erreur', fg: COLOURS.CYAN }] },
    { row: 16, col: 2, segments: [{ text: 'cachée : environ 28 x BER au carré.', fg: COLOURS.CYAN }] },
    { row: 18, col: 2, segments: [{ text: 'p = 10 % et N = 5 : 1 sur 100000.', fg: COLOURS.WHITE }] },
    { row: 19, col: 2, segments: [{ text: 'Mesuré à 14 dB : 5 réceptions font', fg: COLOURS.WHITE }] },
    { row: 20, col: 2, segments: [{ text: 'passer 3 % de cases fausses à 0,01 %.', fg: COLOURS.WHITE }] },
    {
      row: 22,
      col: 2,
      segments: [
        { text: ' SOMMAIRE ', fg: COLOURS.WHITE, bg: COLOURS.MAGENTA },
        { text: ' menu MATHS', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
      ],
    },
  ],
  mosaics: [
    {
      row: 7,
      col: 3,
      fg: COLOURS.MAGENTA,
      bg: COLOURS.BLACK,
      // Three damaged copies of a letter, then the voted, clean letter.
      bitmap: [
        '######....######....##..##....######..######',
        '##..##....##..##....##..##....##..##..##..##',
        '######....##..##....######....######..######',
        '##........##..##....##..##....##..##..##..##',
        '##..##....######....##..##....##..##..##..##',
        '##..##....##..##....##..##....##..##..##..##',
      ],
    },
  ],
};

/** The six explanation pages, in reading order (requirement 6.1). */
export const MATHS_COURS_PAGES: readonly PageSource[] = [
  MATHS_COURS_FSK_PAGE,
  MATHS_COURS_TRAME_PAGE,
  MATHS_COURS_DISCRI_PAGE,
  MATHS_COURS_SEUIL_PAGE,
  MATHS_COURS_BER_PAGE,
  MATHS_COURS_VOTE_PAGE,
];
