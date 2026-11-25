import { FANTOME_ACCUEIL_PAGE, FANTOME_GUIDE_PAGE } from '../../content/pages/fantome';
import { encodePage, type PageSource } from '../videotex';
import type { Service, ServiceInput, ServiceOutput } from './types';

export interface FantomeState {
  readonly view: 'accueil' | 'guide';
}

function toOutput(page: PageSource): ServiceOutput {
  const res = encodePage(page);
  return {
    pageId: page.id,
    bytes: res.ok ? res.value.bytes : new Uint8Array([0x0c]),
  };
}

export const fantomeService: Service<FantomeState> = {
  id: 'FANTOME',

  init(): [FantomeState, ServiceOutput] {
    return [{ view: 'accueil' }, toOutput(FANTOME_ACCUEIL_PAGE)];
  },

  handle(state: FantomeState, input: ServiceInput): [FantomeState, ServiceOutput | null] {
    switch (input.key) {
      case 'Sommaire':
        return [{ view: 'accueil' }, toOutput(FANTOME_ACCUEIL_PAGE)];

      case 'Guide':
        return [{ view: 'guide' }, toOutput(FANTOME_GUIDE_PAGE)];

      case 'Suite':
        return state.view === 'accueil'
          ? [{ view: 'guide' }, toOutput(FANTOME_GUIDE_PAGE)]
          : [{ view: 'accueil' }, toOutput(FANTOME_ACCUEIL_PAGE)];

      case 'Retour':
        if (state.view === 'guide') {
          return [{ view: 'accueil' }, toOutput(FANTOME_ACCUEIL_PAGE)];
        }
        return [state, null];

      default:
        return [state, null];
    }
  },
};
