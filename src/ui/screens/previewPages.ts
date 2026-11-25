import {
  COLOURS,
  createBlankScreen,
  decodeBytes,
  encodePage,
  type PageSource,
  type Screen,
} from '../../videotex';
import { CHANNELS } from '../../modem';

/**
 * Subtle Videotex standby frame shown behind the start overlay before connection.
 */
export const STANDBY_PAGE_SOURCE: PageSource = {
  id: 'system/veille',
  status: 'NEOMINITEL V.23               VEILLE',
  rows: [
    {
      row: 2,
      col: 1,
      segments: [{ text: '========================================', fg: COLOURS.BLUE }],
    },
    {
      row: 23,
      col: 1,
      segments: [{ text: '========================================', fg: COLOURS.BLUE }],
    },
  ],
};

/**
 * Static preview of 3615 SOMMAIRE rendered through `encodePage` -> `decodeBytes` -> `ScreenCanvas`
 * for J3 verification before the J4 Web Worker + Web Audio streaming pipeline connects.
 */
export const SOMMAIRE_PREVIEW_PAGE_SOURCE: PageSource = {
  id: 'sommaire/accueil',
  status: `3615 SOMMAIRE             ${CHANNELS.forward.baud}/${CHANNELS.backward.baud} V.23`,
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
        { text: ' ANNUAIRE DES SERVICES ', fg: COLOURS.BLACK, bg: COLOURS.YELLOW },
      ],
    },
    {
      row: 3,
      col: 18,
      segments: [
        { text: ' Le Vidéotex par le son', fg: COLOURS.CYAN, bg: COLOURS.BLUE },
      ],
    },
    {
      row: 6,
      col: 2,
      segments: [
        { text: 'Choisissez un code service Télétel :', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 9,
      col: 2,
      segments: [
        { text: ' MATHS   ', fg: COLOURS.BLACK, bg: COLOURS.CYAN },
        { text: ' Labo FSK et courbes BER', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
      ],
    },
    {
      row: 12,
      col: 2,
      segments: [
        { text: ' FANTOME ', fg: COLOURS.BLACK, bg: COLOURS.MAGENTA },
        { text: ' Cinq transmissions hantées', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
      ],
    },
    {
      row: 15,
      col: 2,
      segments: [
        { text: ' LIBRE   ', fg: COLOURS.BLACK, bg: COLOURS.GREEN },
        { text: ' Editeur de page mosaïque', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
      ],
    },
    {
      row: 19,
      col: 1,
      segments: [
        { text: '----------------------------------------', fg: COLOURS.BLUE },
      ],
    },
    {
      row: 21,
      col: 2,
      segments: [
        { text: 'Code service : ', fg: COLOURS.YELLOW },
        { text: '........', fg: COLOURS.CYAN },
        { text: ' puis ', fg: COLOURS.WHITE },
        { text: ' ENVOI ', fg: COLOURS.BLACK, bg: COLOURS.GREEN },
      ],
    },
    {
      row: 23,
      col: 2,
      segments: [
        {
          text: `Modem V.23 : ${CHANNELS.forward.markHz} Hz (1) / ${CHANNELS.forward.spaceHz} Hz (0)`,
          fg: COLOURS.GREEN,
        },
      ],
    },
  ],
};

export function decodePageSourceToScreen(source: PageSource): Screen {
  const encoded = encodePage(source);
  if (!encoded.ok) {
    return createBlankScreen();
  }
  return decodeBytes(encoded.value.bytes);
}
