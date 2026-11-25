import {
  SOMMAIRE_ACCUEIL_PAGE,
  SOMMAIRE_ERREUR_PAGE,
  SOMMAIRE_GUIDE_PAGE,
  SOMMAIRE_INPUT_FIELD,
  SOMMAIRE_SUITE_PAGE,
} from '../../content/pages/sommaire';
import { encodePage, type PageSource } from '../videotex';
import type { InputFieldSpec, Service, ServiceInput, ServiceOutput } from './types';

export type SommairePageKey = 'accueil' | 'histoire' | 'guide' | 'erreur';

export interface SommaireState {
  readonly page: SommairePageKey;
  readonly previousPage: 'accueil' | 'histoire';
}

function makeOutput(page: PageSource, input?: InputFieldSpec): ServiceOutput {
  const res = encodePage(page);
  const bytes = res.ok ? res.value.bytes : new Uint8Array([0x0c]);
  return {
    pageId: page.id,
    bytes,
    ...(input ? { input: { ...input } } : {}),
  };
}

function outputForKey(key: SommairePageKey): ServiceOutput {
  switch (key) {
    case 'accueil':
      return makeOutput(SOMMAIRE_ACCUEIL_PAGE, SOMMAIRE_INPUT_FIELD);
    case 'histoire':
      return makeOutput(SOMMAIRE_SUITE_PAGE, SOMMAIRE_INPUT_FIELD);
    case 'guide':
      return makeOutput(SOMMAIRE_GUIDE_PAGE);
    case 'erreur':
      return makeOutput(SOMMAIRE_ERREUR_PAGE, SOMMAIRE_INPUT_FIELD);
  }
}

export const sommaireService: Service<SommaireState> = {
  id: 'SOMMAIRE',

  init(): [SommaireState, ServiceOutput] {
    const initial: SommaireState = { page: 'accueil', previousPage: 'accueil' };
    return [initial, outputForKey('accueil')];
  },

  handle(
    state: SommaireState,
    input: ServiceInput,
  ): [SommaireState, ServiceOutput | null] {
    switch (input.key) {
      case 'Sommaire': {
        const next: SommaireState = { page: 'accueil', previousPage: 'accueil' };
        return [next, outputForKey('accueil')];
      }

      case 'Guide': {
        const prev =
          state.page === 'accueil' || state.page === 'histoire'
            ? state.page
            : state.previousPage;
        const next: SommaireState = { page: 'guide', previousPage: prev };
        return [next, outputForKey('guide')];
      }

      case 'Suite': {
        const target: SommairePageKey =
          state.page === 'accueil' ? 'histoire' : 'accueil';
        const next: SommaireState = {
          page: target,
          previousPage: target,
        };
        return [next, outputForKey(target)];
      }

      case 'Retour': {
        if (state.page === 'guide') {
          const next: SommaireState = {
            page: state.previousPage,
            previousPage: state.previousPage,
          };
          return [next, outputForKey(state.previousPage)];
        }
        if (state.page === 'histoire' || state.page === 'erreur') {
          const next: SommaireState = { page: 'accueil', previousPage: 'accueil' };
          return [next, outputForKey('accueil')];
        }
        return [state, null];
      }

      case 'Envoi': {
        // Known service codes are routed by `router.ts`; reaching here means unknown/empty code
        const next: SommaireState = {
          page: 'erreur',
          previousPage: state.previousPage,
        };
        return [next, outputForKey('erreur')];
      }

      default:
        return [state, null];
    }
  },
};
