import { COLOURS, type PageSource } from '../../src/videotex';

/**
 * Offline-only transmission page builders for `scripts/generate-transmissions.ts`.
 * NEVER import this file from `src/` so secret codes never enter `dist/` (Property H4).
 */

function stripDiacriticsToUpperAscii(code: string): string {
  return code
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function formatCodeBanner(label: string, code: string): string {
  const asciiCode = stripDiacriticsToUpperAscii(code);
  const core = ` -=* ${label} : ${asciiCode} *=- `;
  if (core.length >= 40) {
    return core.slice(0, 40);
  }
  const motif = '-=*=';
  let pad = '';
  while (core.length + pad.length < 39) {
    pad += motif[pad.length % motif.length];
  }
  return `${core}${pad} `;
}

export function buildTransmissionPage(
  transmissionPageId: string,
  code: string,
  codeRow: number,
): PageSource {
  switch (transmissionPageId) {
    case 'fantome/tx-l1':
      return {
        id: 'fantome/tx-l1',
        status: '3615 FANTOME          CANAL ARCHIVE 01',
        mosaics: [
          {
            row: 3,
            col: 2,
            fg: COLOURS.CYAN,
            bg: COLOURS.BLACK,
            bitmap: [
              '..######..',
              '.########.',
              '##..##..##',
              '##########',
              '##.####.##',
              '#...##...#',
            ],
          },
        ],
        rows: [
          {
            row: 1,
            col: 1,
            segments: [
              {
                text: ' DEPECHE I - SALLE DES MODEMS VELIZY    ',
                fg: COLOURS.BLACK,
                bg: COLOURS.CYAN,
              },
            ],
          },
          {
            row: 3,
            col: 9,
            segments: [
              { text: 'Ici le veilleur du répartiteur.', fg: COLOURS.CYAN },
            ],
          },
          {
            row: 4,
            col: 9,
            segments: [
              { text: 'Vous m entendez fort et clair.', fg: COLOURS.WHITE },
            ],
          },
          {
            row: 8,
            col: 2,
            segments: [
              { text: 'Voici la première clef d accès aux', fg: COLOURS.WHITE },
            ],
          },
          {
            row: 9,
            col: 2,
            segments: [
              { text: 'archives scellées du 30 juin 2012 :', fg: COLOURS.WHITE },
            ],
          },
          {
            row: codeRow,
            col: 1,
            segments: [
              {
                text: formatCodeBanner('CLEF', code),
                fg: COLOURS.BLACK,
                bg: COLOURS.CYAN,
              },
            ],
          },
          {
            row: 18,
            col: 2,
            segments: [
              { text: 'Appuyez sur SUITE puis saisissez ce', fg: COLOURS.YELLOW },
            ],
          },
          {
            row: 19,
            col: 2,
            segments: [
              { text: 'mot de passe pour ouvrir le relais 2.', fg: COLOURS.YELLOW },
            ],
          },
        ],
      };

    case 'fantome/tx-l2':
      return {
        id: 'fantome/tx-l2',
        status: '3615 FANTOME          CANAL ARCHIVE 02',
        mosaics: [
          {
            row: 3,
            col: 32,
            fg: COLOURS.GREEN,
            bg: COLOURS.BLACK,
            bitmap: [
              '..######..',
              '.########.',
              '##..##..##',
              '##########',
              '.##.##.##.',
              '#...##...#',
            ],
          },
        ],
        rows: [
          {
            row: 1,
            col: 1,
            segments: [
              {
                text: ' DEPECHE II - GALERIE DU BOULEVARD      ',
                fg: COLOURS.BLACK,
                bg: COLOURS.GREEN,
              },
            ],
          },
          {
            row: 3,
            col: 2,
            segments: [
              { text: 'Les éclairs griffent le cuivre,', fg: COLOURS.GREEN },
            ],
          },
          {
            row: 4,
            col: 2,
            segments: [
              { text: 'mais la parité isole chaque choc.', fg: COLOURS.WHITE },
            ],
          },
          {
            row: 7,
            col: 2,
            segments: [
              { text: 'Ignorez les carrés hachurés épars', fg: COLOURS.YELLOW },
            ],
          },
          {
            row: 8,
            col: 2,
            segments: [
              { text: 'et lisez la ligne demeurée intacte :', fg: COLOURS.YELLOW },
            ],
          },
          {
            row: codeRow,
            col: 1,
            segments: [
              {
                text: formatCodeBanner('CLEF', code),
                fg: COLOURS.BLACK,
                bg: COLOURS.GREEN,
              },
            ],
          },
          {
            row: 17,
            col: 2,
            segments: [
              { text: 'Un seul bit de contrôle a suffi pour', fg: COLOURS.CYAN },
            ],
          },
          {
            row: 18,
            col: 2,
            segments: [
              { text: 'démasquer les octets corrompus.', fg: COLOURS.CYAN },
            ],
          },
        ],
      };

    case 'fantome/tx-l3':
      return {
        id: 'fantome/tx-l3',
        status: '3615 FANTOME          CANAL ARCHIVE 03',
        mosaics: [
          {
            row: 3,
            col: 2,
            fg: COLOURS.YELLOW,
            bg: COLOURS.BLACK,
            bitmap: [
              '.########.',
              '##########',
              '##..##..##',
              '##########',
              '..######..',
              '.#..##..#.',
            ],
          },
        ],
        rows: [
          {
            row: 1,
            col: 1,
            segments: [
              {
                text: ' DEPECHE III - RELAIS HERTZIEN DERIVE   ',
                fg: COLOURS.BLACK,
                bg: COLOURS.YELLOW,
              },
            ],
          },
          {
            row: 3,
            col: 9,
            segments: [
              { text: 'Le quartz vieillissant a glissé', fg: COLOURS.YELLOW },
            ],
          },
          {
            row: 4,
            col: 9,
            segments: [
              { text: 'vers les aigus de +380 hertz !', fg: COLOURS.WHITE },
            ],
          },
          {
            row: 8,
            col: 2,
            segments: [
              { text: 'Grâce à l accord automatique du seuil,', fg: COLOURS.CYAN },
            ],
          },
          {
            row: 9,
            col: 2,
            segments: [
              { text: 'le spectre fantôme redevient lisible :', fg: COLOURS.CYAN },
            ],
          },
          {
            row: codeRow,
            col: 1,
            segments: [
              {
                text: formatCodeBanner('CLEF', code),
                fg: COLOURS.BLACK,
                bg: COLOURS.YELLOW,
              },
            ],
          },
          {
            row: 18,
            col: 2,
            segments: [
              { text: 'Le discriminateur suit désormais les', fg: COLOURS.GREEN },
            ],
          },
          {
            row: 19,
            col: 2,
            segments: [
              { text: 'deux tonalités malgré la dérive.', fg: COLOURS.GREEN },
            ],
          },
        ],
      };

    case 'fantome/tx-l4':
      return {
        id: 'fantome/tx-l4',
        status: '3615 FANTOME          CANAL ARCHIVE 04',
        mosaics: [
          {
            row: 3,
            col: 32,
            fg: COLOURS.RED,
            bg: COLOURS.BLACK,
            bitmap: [
              '.########.',
              '##########',
              '##..##..##',
              '##########',
              '##.####.##',
              '#........#',
            ],
          },
        ],
        rows: [
          {
            row: 1,
            col: 1,
            segments: [
              {
                text: ' DEPECHE IV - CHAMBRE D ECHO SOUTERRAINE',
                fg: COLOURS.WHITE,
                bg: COLOURS.RED,
              },
            ],
          },
          {
            row: 3,
            col: 2,
            segments: [
              { text: 'Sept murmures noyés dans le bruit', fg: COLOURS.RED },
            ],
          },
          {
            row: 4,
            col: 2,
            segments: [
              { text: 'se sont unis case après case.', fg: COLOURS.WHITE },
            ],
          },
          {
            row: 8,
            col: 2,
            segments: [
              { text: 'Là où une écoute seule échouait,', fg: COLOURS.YELLOW },
            ],
          },
          {
            row: 9,
            col: 2,
            segments: [
              { text: 'le vote majoritaire révèle le secret :', fg: COLOURS.YELLOW },
            ],
          },
          {
            row: codeRow,
            col: 1,
            segments: [
              {
                text: formatCodeBanner('CLEF', code),
                fg: COLOURS.BLACK,
                bg: COLOURS.CYAN,
              },
            ],
          },
          {
            row: 18,
            col: 2,
            segments: [
              { text: 'Probabilité d échec : p puissance 7.', fg: COLOURS.CYAN },
            ],
          },
          {
            row: 19,
            col: 2,
            segments: [
              { text: 'Entrez ce dernier code pour conclure.', fg: COLOURS.WHITE },
            ],
          },
        ],
      };

    case 'fantome/tx-l5':
    default:
      return {
        id: 'fantome/tx-l5',
        status: '3615 FANTOME          VOIE RETOUR 75BD',
        mosaics: [
          {
            row: 3,
            col: 2,
            fg: COLOURS.MAGENTA,
            bg: COLOURS.BLACK,
            bitmap: [
              '.########.',
              '##########',
              '##..##..##',
              '##########',
              '.##.##.##.',
              '#...##...#',
            ],
          },
        ],
        rows: [
          {
            row: 1,
            col: 1,
            segments: [
              {
                text: ' DEPECHE V - CANAL MONTANT 75 BAUDS     ',
                fg: COLOURS.BLACK,
                bg: COLOURS.MAGENTA,
              },
            ],
          },
          {
            row: 3,
            col: 9,
            segments: [
              { text: 'Vous avez percé le leurre aigu !', fg: COLOURS.MAGENTA },
            ],
          },
          {
            row: 4,
            col: 9,
            segments: [
              { text: 'La vraie voix file à 75 bauds.', fg: COLOURS.WHITE },
            ],
          },
          {
            row: 8,
            col: 2,
            segments: [
              { text: 'Ultime sceau du répartiteur fantôme :', fg: COLOURS.YELLOW },
            ],
          },
          {
            row: codeRow,
            col: 1,
            segments: [
              {
                text: formatCodeBanner('CLEF', code),
                fg: COLOURS.BLACK,
                bg: COLOURS.MAGENTA,
              },
            ],
          },
          {
            row: 18,
            col: 2,
            segments: [
              { text: 'Le duplex asymétrique livre son secret.', fg: COLOURS.CYAN },
            ],
          },
        ],
      };
  }
}

export const FANTOME_DECOY_L5_PAGE: PageSource = {
  id: 'fantome/decoy-l5',
  status: '3615 FANTOME          LIGNE MUETTE',
  rows: [
    {
      row: 1,
      col: 1,
      segments: [
        {
          text: ' FIN DES ARCHIVES - LIGNE DESACTIVEE    ',
          fg: COLOURS.WHITE,
          bg: COLOURS.BLUE,
        },
      ],
    },
    {
      row: 6,
      col: 4,
      segments: [
        { text: 'CIRCUIT HORS SERVICE DEPUIS JUIN 2012', fg: COLOURS.YELLOW },
      ],
    },
    {
      row: 10,
      col: 6,
      segments: [
        { text: 'Il n y a rien ici...', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 14,
      col: 2,
      segments: [
        { text: 'Pourquoi écouter seulement les aigus ?', fg: COLOURS.CYAN },
      ],
    },
    {
      row: 16,
      col: 2,
      segments: [
        { text: 'Une autre voix murmure dans le grave.', fg: COLOURS.GREEN },
      ],
    },
    {
      row: 21,
      col: 1,
      segments: [
        { text: ' FIN DE CONNEXION APPARENTE - P.T.T.    ', fg: COLOURS.WHITE, bg: COLOURS.RED },
      ],
    },
  ],
};
