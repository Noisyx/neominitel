export type FantomeLevelId = 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

export type FantomeFeature =
  | 'none'
  | 'parity'
  | 'adaptive'
  | 'vote'
  | 'backward';

export type LevelDamage =
  | { readonly kind: 'clean' }
  | { readonly kind: 'noise'; readonly ebN0Db: number }
  | {
      readonly kind: 'offset';
      readonly offsetHz: number;
      readonly ebN0Db: number;
    }
  | {
      readonly kind: 'whisper';
      readonly ebN0Db: number;
      readonly repeats: number;
      readonly gapMs: number;
    }
  | {
      readonly kind: 'backward';
      readonly decoyPage: string;
      readonly ebN0Db: number;
    };

export interface LevelSource {
  readonly id: FantomeLevelId;
  readonly title: string;
  readonly storyPage: string;
  readonly transmissionPage: string;
  readonly codeRow: number;
  readonly code: string;
  readonly hint: string;
  readonly damage: LevelDamage;
  readonly feature: FantomeFeature;
  readonly seed: number;
}

export interface ManifestLevel {
  readonly id: FantomeLevelId;
  readonly title: string;
  readonly hint: string;
  readonly storyPage: string;
  readonly wav: string;
  readonly feature: FantomeFeature;
  readonly codeHash: string;
  readonly seedUsed: number;
}

export interface FantomeManifest {
  readonly version: 1;
  readonly salt: string;
  readonly levels: readonly ManifestLevel[];
}
