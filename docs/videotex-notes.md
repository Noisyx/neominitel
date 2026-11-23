# Notes de vérification Videotex (STUM1B)

Ce document consigne la vérification des entrées marquées `(verify)` dans `.kiro/specs/videotex/design.md` par rapport aux **Spécifications Techniques d'Utilisation du Minitel 1B (STUM1B, France Télécom / CNET)**.

## 1. Positionnement d'adresse `US` (`0x1F`)
- **Spécification STUM1B** (Chapitre 2 — Mode Vidéotex, adressage direct de sous-article `US 1/15`) :
  - Séquence de 3 octets : `0x1F`, suivi de `0x40 + r` ($0 \le r \le 24$, où $r = 0$ est la rangée de service/statut et $1 \le r \le 24$ la page) et `0x40 + c` ($1 \le c \le 40$).
  - Comme `FF (0x0C)` et `RS (0x1E)`, `US` réinitialise tous les attributs courants aux valeurs par défaut (texte blanc `7` sur fond noir `0`, taille normale, fixe, polarité normale, non souligné / mosaïque contiguë) et sélectionne le jeu alphanumérique **G0**.
- **Statut dans NeoMinitel** : conforme à `videotex/design.md`. De plus, notre encodeur robuste réémet explicitement tous les attributs après chaque `US`.

## 2. Séquences protocole `PRO1`, `PRO2`, `PRO3`
- **Spécification STUM1B** (Chapitre 6 — Protocole Télétel) :
  - `ESC 0x39` (`PRO1`) est suivi de **1 octet** d'instruction protocole.
  - `ESC 0x3A` (`PRO2`) est suivi de **2 octets** d'instruction protocole.
  - `ESC 0x3B` (`PRO3`) est suivi de **3 octets** d'instruction protocole.
- **Statut dans NeoMinitel** : conforme. Le décodeur consomme exactement 1, 2 ou 3 octets de paramètres sans polluer l'écran.

## 3. Palette monochrome (Minitel 1 / 1B noir et blanc)
- **Spécification STUM1B** (Chapitre 2 — Visualisation des couleurs sur écran monochrome) :
  - Les 8 couleurs sont converties en 8 niveaux de gris ordonnés par luminance croissante :
    1. Noir (`0`) — 0 %
    2. Bleu (`4`) — 40 %
    3. Rouge (`1`) — 50 %
    4. Magenta (`5`) — 60 %
    5. Vert (`2`) — 70 %
    6. Cyan (`6`) — 80 %
    7. Jaune (`3`) — 90 %
    8. Blanc (`7`) — 100 %
- **Statut dans NeoMinitel** : l'ordre `[0, 4, 1, 5, 2, 6, 3, 7]` dans `src/videotex/codes.ts` (`MONOCHROME_LUMINANCE_ORDER`) respecte strictement la hiérarchie de luminance STUM1B, avec des niveaux de gris échelonnés pour un contraste lisible sur Canvas.

## 4. Jeu semi-graphique `G1` (mosaïque 2×3) et plage `0x40-0x5F`
- **Spécification STUM1B** (Jeu G1 mosaïque) :
  - Le bit 6 (`b6`, pavé inférieur droit) est porté par le bit de poids 64 (`0x40`) afin d'éviter les colonnes `0x40-0x5F`, ce qui place les 64 motifs mosaïques dans `0x20-0x3F` (`b6 = 0`) et `0x60-0x7F` (`b6 = 1`, `0x7F` étant le pavé plein).
  - La formule `0x20 + b1 + 2·b2 + 4·b3 + 8·b4 + 16·b5 + 64·b6` produit exclusivement des octets dans `[0x20..0x3F] ∪ [0x60..0x7F]`. Si un flux externe envoie un octet `0x40-0x5F` alors que `G1` est actif, notre décodeur l'affiche comme le caractère `G0` correspondant conformément à `design.md`.

## 5. Accents français du jeu `G2` (`SS2 = 0x19`)
- **Spécification STUM1B** (Jeu supplémentaire G2 appelé par `SS2 1/9`) :
  - `0x41` : accent grave (`à`, `è`, `ù`)
  - `0x42` : accent aigu (`é`)
  - `0x43` : accent circonflexe (`â`, `ê`, `î`, `ô`, `û`)
  - `0x48` : tréma (`ë`, `ï`)
  - `0x4B` : cédille (`ç`)
- **Statut dans NeoMinitel** : conforme à 100 % avec `G2_DIACRITICS` dans `src/videotex/codes.ts`.

## 6. Touches de fonction Minitel (`SEP = 0x13`)
- **Spécification STUM1B** (Chapitre 3 — Clavier, codes émis en mode Vidéotex) :
  - `0x13 0x41` : Envoi
  - `0x13 0x42` : Retour
  - `0x13 0x43` : Répétition
  - `0x13 0x44` : Guide
  - `0x13 0x45` : Annulation
  - `0x13 0x46` : Sommaire
  - `0x13 0x47` : Correction
  - `0x13 0x48` : Suite
  - `0x13 0x49` : Connexion/Fin
- **Statut dans NeoMinitel** : conforme à 100 % avec `FUNCTION_KEYS` dans `src/videotex/codes.ts`.

## 7. Double hauteur (`ESC 0x4D`) `[STRETCH]`
- **Spécification STUM1B** : un caractère en double hauteur ou double grandeur repose sur la rangée courante $r$ et déborde vers le haut sur la rangée $r - 1$.
