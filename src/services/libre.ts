import { LIBRE_ACCUEIL_PAGE, LIBRE_GUIDE_PAGE } from '../../content/pages/libre';
import { encodePage, type PageSource } from '../videotex';
import type { Service, ServiceInput, ServiceOutput } from './types';

export interface LibreState {
  readonly view: 'accueil' | 'guide';
}

function toOutput(page: PageSource): ServiceOutput {
  const res = encodePage(page);
  return {
    pageId: page.id,
    bytes: res.ok ? res.value.bytes : new Uint8Array([0x0c]),
  };
}

export const libreService: Service<LibreState> = {
  id: 'LIBRE',

  init(): [LibreState, ServiceOutput] {
    return [{ view: 'accueil' }, toOutput(LIBRE_ACCUEIL_PAGE)];
  },

  handle(state: LibreState, input: ServiceInput): [LibreState, ServiceOutput | null] {
    switch (input.key) {
      case 'Sommaire':
        return [{ view: 'accueil' }, toOutput(LIBRE_ACCUEIL_PAGE)];

      case 'Guide':
        return [{ view: 'guide' }, toOutput(LIBRE_GUIDE_PAGE)];

      case 'Suite':
        return state.view === 'accueil'
          ? [{ view: 'guide' }, toOutput(LIBRE_GUIDE_PAGE)]
          : [{ view: 'accueil' }, toOutput(LIBRE_ACCUEIL_PAGE)];

      case 'Retour':
        if (state.view === 'guide') {
          return [{ view: 'accueil' }, toOutput(LIBRE_ACCUEIL_PAGE)];
        }
        return [state, null];

      default:
        return [state, null];
    }
  },
};
