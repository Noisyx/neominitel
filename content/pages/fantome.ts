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
        {
          text: ' 3615 FANTOME - ARCHIVES HANTEES P.T.T. ',
          fg: COLOURS.BLACK,
          bg: COLOURS.MAGENTA,
        },
      ],
    },
    {
      row: 3,
      col: 9,
      segments: [
        { text: '30 juin 2012, minuit : le réseau', fg: COLOURS.MAGENTA },
      ],
    },
    {
      row: 4,
      col: 9,
      segments: [
        { text: 'Télétel s éteint, sauf un ultime', fg: COLOURS.MAGENTA },
      ],
    },
    {
      row: 5,
      col: 9,
      segments: [
        { text: 'serveur oublié sous Vélizy.', fg: COLOURS.MAGENTA },
      ],
    },
    {
      row: 8,
      col: 2,
      segments: [
        { text: 'Cinq transmissions d outre-tombe vous', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 9,
      col: 2,
      segments: [
        { text: 'attendent sur la ligne téléphonique :', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 11,
      col: 2,
      segments: [
        { text: '1. Premier contact       [Voie claire]', fg: COLOURS.CYAN },
      ],
    },
    {
      row: 13,
      col: 2,
      segments: [
        { text: '2. Parasites             [Parité 7E1]', fg: COLOURS.GREEN },
      ],
    },
    {
      row: 15,
      col: 2,
      segments: [
        { text: '3. La radio mal accordée [Accord auto]', fg: COLOURS.YELLOW },
      ],
    },
    {
      row: 17,
      col: 2,
      segments: [
        { text: '4. Le murmure            [Vote x 7]', fg: COLOURS.RED },
      ],
    },
    {
      row: 19,
      col: 2,
      segments: [
        { text: '5. La voix du retour     [Canal 75 bd]', fg: COLOURS.MAGENTA },
      ],
    },
    {
      row: 21,
      col: 2,
      segments: [
        { text: 'Niveau (1-4) : ..', fg: COLOURS.YELLOW },
      ],
    },
    {
      row: 23,
      col: 2,
      segments: [
        { text: ' SUITE ', fg: COLOURS.BLACK, bg: COLOURS.MAGENTA },
        { text: ' continuer  ', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
        { text: ' GUIDE ', fg: COLOURS.BLACK, bg: COLOURS.MAGENTA },
        { text: ' manuel', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
      ],
    },
  ],
};

export const FANTOME_STORY_L1_PAGE: PageSource = {
  id: 'fantome/story-l1',
  status: '3615 FANTOME - NIVEAU 1       CONTACT',
  mosaics: [
    {
      row: 4,
      col: 30,
      fg: COLOURS.CYAN,
      bg: COLOURS.BLACK,
      bitmap: [
        '...######...',
        '.##########.',
        '############',
        '###..##..###',
        '############',
        '####.##.####',
        '############',
        '##..####..##',
        '#....##....#',
      ],
    },
  ],
  rows: [
    {
      row: 1,
      col: 1,
      segments: [
        {
          text: ' NIVEAU 1 : PREMIER CONTACT             ',
          fg: COLOURS.BLACK,
          bg: COLOURS.CYAN,
        },
      ],
    },
    {
      row: 3,
      col: 2,
      segments: [
        { text: '00h04, 1er juillet 2012.', fg: COLOURS.YELLOW },
      ],
    },
    {
      row: 5,
      col: 2,
      segments: [
        { text: 'Dans la salle des baies V.23,', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 6,
      col: 2,
      segments: [
        { text: 'tous les voyants sont éteints.', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 8,
      col: 2,
      segments: [
        { text: 'Pourtant, un combiné posé sur', fg: COLOURS.CYAN },
      ],
    },
    {
      row: 9,
      col: 2,
      segments: [
        { text: 'le pupitre se met à chanter :', fg: COLOURS.CYAN },
      ],
    },
    {
      row: 10,
      col: 2,
      segments: [
        { text: 'la porteuse intacte d un gardien.', fg: COLOURS.CYAN },
      ],
    },
    {
      row: 13,
      col: 2,
      segments: [
        {
          text: ' Anomalie radio : aucune perturbation ',
          fg: COLOURS.BLACK,
          bg: COLOURS.GREEN,
        },
      ],
    },
    {
      row: 15,
      col: 2,
      segments: [
        { text: 'Ecoutez la modulation FSK dessiner la', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 16,
      col: 2,
      segments: [
        { text: 'première dépêche et relevez son code.', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 20,
      col: 2,
      segments: [
        { text: ' ENVOI ', fg: COLOURS.BLACK, bg: COLOURS.CYAN },
        { text: ' capter l onde ', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
        { text: ' GUIDE ', fg: COLOURS.BLACK, bg: COLOURS.CYAN },
        { text: ' indice', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
      ],
    },
    {
      row: 23,
      col: 2,
      segments: [
        { text: 'Archive P.T.T. #01 - Voie descendante', fg: COLOURS.MAGENTA },
      ],
    },
  ],
};

export const FANTOME_STORY_L2_PAGE: PageSource = {
  id: 'fantome/story-l2',
  status: '3615 FANTOME - NIVEAU 2     PARASITES',
  mosaics: [
    {
      row: 4,
      col: 2,
      fg: COLOURS.GREEN,
      bg: COLOURS.BLACK,
      bitmap: [
        '....####....',
        '..########..',
        '.##########.',
        '##..####..##',
        '############',
        '..###..###..',
        '.###....###.',
        '##..####..##',
        '....#..#....',
      ],
    },
  ],
  rows: [
    {
      row: 1,
      col: 1,
      segments: [
        {
          text: ' NIVEAU 2 : PARASITES SUR LE CUIVRE     ',
          fg: COLOURS.BLACK,
          bg: COLOURS.GREEN,
        },
      ],
    },
    {
      row: 4,
      col: 10,
      segments: [
        { text: 'L humidité ronge les gaines de', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 5,
      col: 10,
      segments: [
        { text: 'plomb sous le boulevard Brune.', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 7,
      col: 10,
      segments: [
        { text: 'Des décharges crépitent sur la', fg: COLOURS.GREEN },
      ],
    },
    {
      row: 8,
      col: 10,
      segments: [
        { text: 'ligne et retournent des bits.', fg: COLOURS.GREEN },
      ],
    },
    {
      row: 12,
      col: 2,
      segments: [
        {
          text: ' Anomalie : bruit thermique modéré    ',
          fg: COLOURS.BLACK,
          bg: COLOURS.YELLOW,
        },
      ],
    },
    {
      row: 14,
      col: 2,
      segments: [
        { text: 'Le bit de parité paire 7E1 repère les', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 15,
      col: 2,
      segments: [
        { text: 'octets blessés par un bloc hachuré,', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 16,
      col: 2,
      segments: [
        { text: 'isolant le dommage loin du mot secret.', fg: COLOURS.CYAN },
      ],
    },
    {
      row: 20,
      col: 2,
      segments: [
        { text: ' ENVOI ', fg: COLOURS.BLACK, bg: COLOURS.GREEN },
        { text: ' capter L2   ', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
        { text: ' GUIDE ', fg: COLOURS.BLACK, bg: COLOURS.GREEN },
        { text: ' indice', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
      ],
    },
    {
      row: 23,
      col: 2,
      segments: [
        { text: 'Archive P.T.T. #02 - Contrôle parité', fg: COLOURS.YELLOW },
      ],
    },
  ],
};

export const FANTOME_STORY_L3_PAGE: PageSource = {
  id: 'fantome/story-l3',
  status: '3615 FANTOME - NIVEAU 3     DESACCORD',
  mosaics: [
    {
      row: 11,
      col: 29,
      fg: COLOURS.YELLOW,
      bg: COLOURS.BLACK,
      bitmap: [
        '..########..',
        '.##########.',
        '###..##..###',
        '############',
        '###.####.###',
        '##...##...##',
        '.##########.',
        '#..#.##.#..#',
        '#....##....#',
      ],
    },
  ],
  rows: [
    {
      row: 1,
      col: 1,
      segments: [
        {
          text: ' NIVEAU 3 : LA RADIO MAL ACCORDEE       ',
          fg: COLOURS.BLACK,
          bg: COLOURS.YELLOW,
        },
      ],
    },
    {
      row: 3,
      col: 2,
      segments: [
        { text: 'Plus aucun câble ne relie ce relais :', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 4,
      col: 2,
      segments: [
        { text: 'un émetteur BLU clandestin relaie le', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 5,
      col: 2,
      segments: [
        { text: 'modem à travers la brume nocturne.', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 7,
      col: 2,
      segments: [
        {
          text: ' Anomalie : dérive +380 Hz du quartz  ',
          fg: COLOURS.WHITE,
          bg: COLOURS.RED,
        },
      ],
    },
    {
      row: 10,
      col: 2,
      segments: [
        { text: 'Avec un seuil fixe, les deux', fg: COLOURS.YELLOW },
      ],
    },
    {
      row: 11,
      col: 2,
      segments: [
        { text: 'tons passent au-dessus du', fg: COLOURS.YELLOW },
      ],
    },
    {
      row: 12,
      col: 2,
      segments: [
        { text: 'seuil : tout sort brouillé !', fg: COLOURS.YELLOW },
      ],
    },
    {
      row: 15,
      col: 2,
      segments: [
        { text: 'Observez le spectrogramme HUD', fg: COLOURS.CYAN },
      ],
    },
    {
      row: 16,
      col: 2,
      segments: [
        { text: 'et recalez le récepteur.', fg: COLOURS.CYAN },
      ],
    },
    {
      row: 20,
      col: 2,
      segments: [
        { text: ' ENVOI ', fg: COLOURS.BLACK, bg: COLOURS.YELLOW },
        { text: ' capter L3   ', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
        { text: ' GUIDE ', fg: COLOURS.BLACK, bg: COLOURS.YELLOW },
        { text: ' indice', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
      ],
    },
    {
      row: 23,
      col: 2,
      segments: [
        { text: 'Archive P.T.T. #03 - Dérive porteuse', fg: COLOURS.RED },
      ],
    },
  ],
};

export const FANTOME_STORY_L4_PAGE: PageSource = {
  id: 'fantome/story-l4',
  status: '3615 FANTOME - NIVEAU 4       MURMURE',
  mosaics: [
    {
      row: 4,
      col: 29,
      fg: COLOURS.RED,
      bg: COLOURS.BLACK,
      bitmap: [
        '.##########.',
        '############',
        '##...##...##',
        '##...##...##',
        '############',
        '..########..',
        '..##.##.##..',
        '.###.##.###.',
        '#..........#',
      ],
    },
  ],
  rows: [
    {
      row: 1,
      col: 1,
      segments: [
        {
          text: ' NIVEAU 4 : LE MURMURE DANS LE BRUIT    ',
          fg: COLOURS.WHITE,
          bg: COLOURS.RED,
        },
      ],
    },
    {
      row: 4,
      col: 2,
      segments: [
        { text: 'Au fond de la galerie noyée,', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 5,
      col: 2,
      segments: [
        { text: 'un répondeur à bande sans fin', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 6,
      col: 2,
      segments: [
        { text: 'répète sept fois son appel.', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 9,
      col: 2,
      segments: [
        { text: 'Le souffle couvre presque la', fg: COLOURS.RED },
      ],
    },
    {
      row: 10,
      col: 2,
      segments: [
        { text: 'voix : une écoute isolée est', fg: COLOURS.RED },
      ],
    },
    {
      row: 11,
      col: 2,
      segments: [
        { text: 'déchirée de part en part.', fg: COLOURS.RED },
      ],
    },
    {
      row: 14,
      col: 2,
      segments: [
        {
          text: ' Anomalie : Eb/N0 critique, 7 boucles ',
          fg: COLOURS.BLACK,
          bg: COLOURS.CYAN,
        },
      ],
    },
    {
      row: 16,
      col: 2,
      segments: [
        { text: 'Laissez les sept passages fusionner', fg: COLOURS.YELLOW },
      ],
    },
    {
      row: 17,
      col: 2,
      segments: [
        { text: 'case par case pour sauver le message.', fg: COLOURS.YELLOW },
      ],
    },
    {
      row: 20,
      col: 2,
      segments: [
        { text: ' ENVOI ', fg: COLOURS.WHITE, bg: COLOURS.RED },
        { text: ' capter L4   ', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
        { text: ' GUIDE ', fg: COLOURS.WHITE, bg: COLOURS.RED },
        { text: ' indice', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
      ],
    },
    {
      row: 23,
      col: 2,
      segments: [
        { text: 'Archive P.T.T. #04 - Sept répétitions', fg: COLOURS.CYAN },
      ],
    },
  ],
};

export const FANTOME_STORY_L5_PAGE: PageSource = {
  id: 'fantome/story-l5',
  status: '3615 FANTOME - NIVEAU 5   VOIX RETOUR',
  mosaics: [
    {
      row: 4,
      col: 2,
      fg: COLOURS.MAGENTA,
      bg: COLOURS.BLACK,
      bitmap: [
        '.####..####.',
        '############',
        '###..##..###',
        '############',
        '.##########.',
        '..########..',
        '.###.##.###.',
        '##...##...##',
        '#....##....#',
      ],
    },
  ],
  rows: [
    {
      row: 1,
      col: 1,
      segments: [
        {
          text: ' NIVEAU 5 : LA VOIX DU CANAL RETOUR     ',
          fg: COLOURS.BLACK,
          bg: COLOURS.MAGENTA,
        },
      ],
    },
    {
      row: 4,
      col: 10,
      segments: [
        { text: 'La page principale affirme', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 5,
      col: 10,
      segments: [
        { text: 'qu il n y a plus rien ici...', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 7,
      col: 10,
      segments: [
        { text: 'Mais sous ce leurre, un second', fg: COLOURS.MAGENTA },
      ],
    },
    {
      row: 8,
      col: 10,
      segments: [
        { text: 'chant grave murmure à 75 bauds.', fg: COLOURS.MAGENTA },
      ],
    },
    {
      row: 12,
      col: 2,
      segments: [
        {
          text: ' Anomalie : message caché voie retour ',
          fg: COLOURS.BLACK,
          bg: COLOURS.YELLOW,
        },
      ],
    },
    {
      row: 15,
      col: 2,
      segments: [
        { text: 'Tendez l oreille vers les basses', fg: COLOURS.CYAN },
      ],
    },
    {
      row: 16,
      col: 2,
      segments: [
        { text: 'fréquences du clavier montant.', fg: COLOURS.CYAN },
      ],
    },
    {
      row: 20,
      col: 2,
      segments: [
        { text: ' ENVOI ', fg: COLOURS.BLACK, bg: COLOURS.MAGENTA },
        { text: ' écouter L5  ', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
        { text: ' GUIDE ', fg: COLOURS.BLACK, bg: COLOURS.MAGENTA },
        { text: ' indice', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
      ],
    },
    {
      row: 23,
      col: 2,
      segments: [
        { text: 'Archive P.T.T. #05 - Duplex asymétrique', fg: COLOURS.GREEN },
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
        {
          text: ' MANUEL DE CHASSEUR D ONDES FANTOMES    ',
          fg: COLOURS.WHITE,
          bg: COLOURS.BLUE,
        },
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
        { text: ' SOMMAIRE ', fg: COLOURS.BLACK, bg: COLOURS.CYAN },
        { text: ' retour aux archives FANTOME', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
      ],
    },
  ],
};

export const FANTOME_FINAL_PAGE: PageSource = {
  id: 'fantome/final',
  status: '3615 FANTOME - EPILOGUE     AUBE CLAIRE',
  mosaics: [
    {
      row: 3,
      col: 17,
      fg: COLOURS.CYAN,
      bg: COLOURS.BLACK,
      bitmap: [
        '..########..',
        '.##########.',
        '###..##..###',
        '############',
        '####.##.####',
        '.##########.',
      ],
    },
  ],
  rows: [
    {
      row: 1,
      col: 1,
      segments: [
        {
          text: ' EPILOGUE : LE DERNIER VEILLEUR V.23    ',
          fg: COLOURS.BLACK,
          bg: COLOURS.GREEN,
        },
      ],
    },
    {
      row: 6,
      col: 2,
      segments: [
        { text: 'Tous les relais fantômes sont apaisés.', fg: COLOURS.GREEN },
      ],
    },
    {
      row: 8,
      col: 2,
      segments: [
        { text: 'Ce serveur n était pas un sortilège :', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 9,
      col: 2,
      segments: [
        { text: 'un ancien ingénieur P.T.T. avait laissé', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 10,
      col: 2,
      segments: [
        { text: 'une baie en veille pour qu on n oublie', fg: COLOURS.WHITE },
      ],
    },
    {
      row: 11,
      col: 2,
      segments: [
        { text: 'jamais comment le son devient écriture.', fg: COLOURS.CYAN },
      ],
    },
    {
      row: 14,
      col: 1,
      segments: [
        {
          text: ' Pour comprendre chaque arme utilisée : ',
          fg: COLOURS.BLACK,
          bg: COLOURS.YELLOW,
        },
      ],
    },
    {
      row: 16,
      col: 3,
      segments: [
        { text: 'Ouvrez ', fg: COLOURS.WHITE },
        { text: ' 3615 MATHS ', fg: COLOURS.BLACK, bg: COLOURS.CYAN },
        { text: ' et explorez FSK,', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
      ],
    },
    {
      row: 17,
      col: 3,
      segments: [
        { text: 'parité 7E1, seuil adaptatif et vote !', fg: COLOURS.YELLOW },
      ],
    },
    {
      row: 21,
      col: 2,
      segments: [
        { text: ' SOMMAIRE ', fg: COLOURS.BLACK, bg: COLOURS.GREEN },
        { text: ' revoir les archives FANTOME', fg: COLOURS.WHITE, bg: COLOURS.BLACK },
      ],
    },
  ],
};

export const FANTOME_PAGES: readonly PageSource[] = [
  FANTOME_ACCUEIL_PAGE,
  FANTOME_STORY_L1_PAGE,
  FANTOME_STORY_L2_PAGE,
  FANTOME_STORY_L3_PAGE,
  FANTOME_STORY_L4_PAGE,
  FANTOME_STORY_L5_PAGE,
  FANTOME_GUIDE_PAGE,
  FANTOME_FINAL_PAGE,
];
