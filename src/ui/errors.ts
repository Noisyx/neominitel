import {
  SAMPLE_RATE_MAX_HZ,
  SAMPLE_RATE_MIN_HZ,
  type ModemError,
  type WavErrorReason,
} from '../modem';
import type { PageError } from '../videotex';

export type WorkerOrModemError =
  | ModemError
  | { readonly kind: 'internal'; readonly message: string };

/**
 * Translates every stable `WavErrorReason` from `readWav` into plain French (Requirement 10.4).
 */
export function formatWavErrorReasonFr(reason: string): string {
  switch (reason as WavErrorReason) {
    case 'too-short':
      return 'Fichier WAV trop court (moins de 12 octets : en-tête RIFF/WAVE absent).';
    case 'not-riff':
      return 'Ce fichier n’est pas un conteneur audio RIFF/WAV valide.';
    case 'not-wave':
      return 'Ce conteneur RIFF n’est pas un fichier audio WAVE.';
    case 'missing-fmt':
      return 'En-tête de format audio (« fmt ») manquant dans le fichier WAV.';
    case 'bad-fmt':
      return 'Paramètres audio du bloc « fmt » incohérents ou corrompus.';
    case 'unsupported-encoding':
      return 'Encodage WAV non pris en charge (utilisez du PCM 8/16/24 bits ou du flottant IEEE 32 bits non compressé).';
    case 'missing-data':
      return 'Aucun bloc d’échantillons audio (« data ») trouvé dans le fichier WAV.';
    case 'data-truncated':
      return 'Les données audio du fichier WAV sont tronquées ou incomplètes.';
    case 'too-large':
      return 'Le fichier WAV est trop volumineux pour être chargé en mémoire.';
    default:
      return `Fichier WAV illisible (${reason}).`;
  }
}

/**
 * Translates every `ModemError` (and worker internal error) into plain French (`design.md` "Error handling").
 */
export function formatModemErrorFr(error: WorkerOrModemError): string {
  switch (error.kind) {
    case 'wav':
      return formatWavErrorReasonFr(error.reason);
    case 'bad-sample-rate':
      return `Fréquence d’échantillonnage non prise en charge (${error.sampleRate} Hz ; plage acceptée : ${SAMPLE_RATE_MIN_HZ} à ${SAMPLE_RATE_MAX_HZ} Hz).`;
    case 'byte-out-of-range':
      return `Octet Vidéotex hors plage 7 bits à l’indice ${error.index} (valeur ${error.value}).`;
    case 'bad-option':
      return `Paramètre modem invalide (« ${error.option} » : ${error.reason}).`;
    case 'internal':
      return `Erreur interne du démodulateur (${error.message}).`;
    default: {
      const exhaustiveCheck: never = error;
      return `Erreur modem inattendue (${String(exhaustiveCheck)}).`;
    }
  }
}

/**
 * Translates every `PageError` from the Videotex encoder into plain French (`design.md` "Error handling").
 */
export function formatPageErrorFr(error: PageError): string {
  switch (error.kind) {
    case 'row-too-long':
      return `La ligne ${error.row} dépasse 40 colonnes (${error.length} caractères).`;
    case 'too-many-rows':
      return 'La page dépasse la limite de 24 lignes Vidéotex affichables.';
    case 'bad-bitmap':
      return `Motif mosaïque invalide (${error.reason}).`;
    default: {
      const exhaustiveCheck: never = error;
      return `Erreur d’encodage Vidéotex (${String(exhaustiveCheck)}).`;
    }
  }
}
