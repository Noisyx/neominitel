# Checklist de déploiement, compatibilité et répétition démo — NeoMinitel

Ce document couvre la vérification manuelle du jalon **J11** (`neominitel-app` tâche 15, `design.md` section *Testing*) sur deux appareils réels, sur chaque navigateur cible, ainsi que le minutage exact de la vidéo jury de 3 minutes (**Kiroween 2026 — catégorie Resurrection**).

---

## 1. Déploiement statique HTTPS et budget de taille

NeoMinitel est un site 100 % statique (`dist/`), sans serveur ni API externe. L'accès au microphone (`getUserMedia` + `AudioWorklet`) exige une origine sécurisée **HTTPS** (ou `localhost` en développement).

- [ ] `npm run build` compile sans erreur TypeScript ni avertissement Vite.
- [ ] `npx tsx scripts/check-bundle-size.ts` confirme que le poids total JavaScript compressé (`gzip`) hors fichiers `.wav` est strictement **< 1 Mo** (~90 Ko constatés).
- [ ] `npm test` passe à 100 % (incluant la non-divulgation `H4` des codes de `3615 FANTOME` dans `public/` et `dist/`).
- [ ] Hébergement HTTPS déployé (Netlify / Vercel / Cloudflare Pages / GitHub Pages, répertoire de sortie : `dist`) :
  - [ ] L'URL HTTPS charge l'écran d'accueil en moins de 2 s sur réseau mobile.
  - [ ] Les archives `transmissions/L1.wav` à `L4.wav` et `data/ber-curve3.json` répondent en `200 OK` avec le bon type MIME.
  - [ ] Aucun appel réseau externe n'apparaît dans l'onglet *Network* lors de la saisie clavier, de la capture micro ou de la navigation 3615.

---

## 2. Réglages acoustiques avant essai à deux appareils

Pour transmettre les pages Vidéotex par l'air entre le haut-parleur d'un téléphone (**mode `Serveur`**) et le microphone d'un ordinateur (**mode `Écoute`**) :

- [ ] **Volume du téléphone émetteur** : régler entre **70 % et 85 %** (assez fort pour dominer le bruit ambiant sans faire saturer le petit haut-parleur du téléphone).
- [ ] **Distance haut-parleur → microphone** : placer le bas du téléphone à **10 – 25 cm** du micro de l'ordinateur portable.
- [ ] **Désactiver les filtres vocaux système** :
  - **macOS** : dans la barre des menus (icône micro orange pendant la capture), vérifier que le mode micro est sur **Standard** et **non** sur *Isolement de la voix* (*Voice Isolation*, qui coupe les porteuses continues à 1300 / 2100 Hz).
  - **iOS** : Centre de contrôle → Mode micro → **Standard**.
  - **Windows** : Paramètres → Système → Son → Entrée → *Améliorations audio* → **Désactivé**.
- [ ] Vérifier l'absence du bandeau d'avertissement de traitement audio forcé (`rawOk === true` dans le mode `Écoute`).

---

## 3. Matrice à deux appareils (Acoustique temps réel)

### Couple A : iPhone (Safari, mode `Serveur`) → MacBook (Chrome / Safari, mode `Écoute`)
- [ ] Sur l'iPhone : passer en **`Serveur`**, toucher **Connexion (Diffuser)** → la séquence d'appel (2100 Hz puis porteuse 1300 Hz) et `3615 SOMMAIRE` sortent clairement du haut-parleur.
- [ ] Sur le MacBook : passer en **`Écoute`**, autoriser le microphone → le voyant porteuse passe au vert, le spectrogramme affiche les deux raies FSK (1300 / 2100 Hz) et la page se dessine à **120 car/s**.
- [ ] Parler à voix haute ou taper dans les mains pendant la réception : des cases d'erreur apparaissent sur l'écran Vidéotex et le compteur d'erreurs de parité s'incrémente.
- [ ] Sur l'iPhone, toucher **Répétition** : le vote majoritaire sur le MacBook répare les cases endommagées (`Vote : 2 réceptions`).

### Couple B : Android (Chrome, mode `Serveur`) → PC Windows / MacBook (Chrome / Firefox, mode `Écoute`)
- [ ] Sur Android : mode **`Serveur`**, **Connexion (Diffuser)** puis sélection rapide **3615 FANTOME** ou **3615 SOMMAIRE**.
- [ ] Sur l'ordinateur : réception complète sans décrochage d'horloge bit ; diagramme de l'œil ouvert dans le HUD.
- [ ] Tester le bandeau d'aide après 10 s de silence : couper le son du téléphone pendant 10 s en mode `Écoute` → le conseil *« Aucune porteuse V.23 entendue depuis 10 s… »* apparaît puis disparaît dès la reprise d'émission.

---

## 4. Matrice des navigateurs (`tech.md`)

Tester sur chaque navigateur cible :
- [ ] **Chrome (Desktop)** : modes `Seul`, `Écoute`, `Serveur`, `Fichier`, son déverrouillé dès le premier clic.
- [ ] **Firefox (Desktop)** : `AudioWorklet` micro fonctionnel, rendu Canvas net (`image-rendering: crisp-edges`), raccourcis clavier (`Entrée`, `Ret.Arr`, `Échap`, `Pg.Bas`, `Pg.Haut`, `Début`, `Fin`, `Alt+G`, `Alt+R`).
- [ ] **Safari (macOS)** : reprise propre de l'`AudioContext` en basculant `Seul` → `Écoute` → `Seul`, lecture fluide des WAV `16 kHz` de `3615 FANTOME`.
- [ ] **Safari (iOS)** : déverrouillage audio au toucher sur **Connexion**, barre de saisie tactile (`InputOverlay`) et pavé de touches Minitel utilisables au pouce sans zoom intempestif.
- [ ] **Chrome (Android)** : diffusion haut-parleur en mode `Serveur` et saisie tactile fluides.

---

## 5. Modes, commandes et accessibilité (Tâches 12 & 14)

- [ ] **Bouton `Son : Activé / Muet`** : couper le son pendant qu'une page se dessine → le silence est immédiat mais la page continue de s'afficher à 120 car/s ; réactiver le son → le chant du modem reprend sans décalage.
- [ ] **Changements de mode sans rechargement** : basculer `Seul` → `Serveur` → `Écoute` → `Fichier` → `Seul` pendant une transmission → aucune émission ni capture micro précédente ne continue en arrière-plan.
- [ ] **Mode `Fichier` (Tâche 12)** :
  - [ ] Glisser-déposer `public/transmissions/L1.wav` → décodage rapide instantané avec barre de progression à `100 %` et page affichée.
  - [ ] Cliquer sur **Écouter en temps réel** → le fichier est joué au haut-parleur et décodé à 120 car/s.
  - [ ] Glisser-déposer `public/transmissions/L3.wav` sans puis avec **Accord automatique**, suivi de **Décoder rapidement** → la page décalée de `+380 Hz` devient parfaitement lisible.
  - [ ] Glisser-déposer un fichier invalide (ex. `.txt` renommé en `.wav`) → le message d'erreur typé s'affiche clairement en français (*« Ce fichier n'est pas un conteneur audio RIFF/WAV valide. »*).
- [ ] **Accessibilité (Tâche 14)** :
  - [ ] Navigation **100 % au clavier** (`Tab` / `Shift+Tab`) : lien d'évitement en tête de page, anneau de focus ambre visible sur chaque bouton/curseur, aucune capture des touches `F1`..`F12`.
  - [ ] Activer `prefers-reduced-motion: reduce` dans les préférences système → le clignotement Vidéotex et l'effet de balayage cathodique disparaissent immédiatement.
  - [ ] Palette **Couleur** ↔ **N&B Minitel 1** (8 niveaux de luminance).

---

## 6. Minutage de la vidéo de démonstration (3 min 00 s max)

- [ ] **0:00 – 0:20** : Écran noir d'accueil (*« 30 juin 2012 : la France débranche le Minitel. »*). Clic sur **Connexion** : tonalité de réponse à 2100 Hz, silence, porteuse 1300 Hz.
- [ ] **0:20 – 0:50** : `3615 SOMMAIRE` s'écrit ligne par ligne à 120 car/s. Le HUD mathématique montre les deux fréquences (1300 / 2100 Hz), la trace du discriminateur et les fenêtres d'échantillonnage des bits.
- [ ] **0:50 – 1:30** : Démonstration à deux appareils : le téléphone diffuse la page en mode **`Serveur`**, l'ordinateur l'écoute par son micro en mode **`Écoute`**. Perturbation à la voix → erreurs de parité visibles → touche **Répétition** → le vote majoritaire reconstruit la page propre.
- [ ] **1:30 – 2:10** : `3615 MATHS` → page **Banc d'essai** : faire varier le curseur `Eb/N0` en direct ; les points BER mesurés (avec intervalles de Wilson à 95 %) viennent se poser sur la courbe théorique / Monte-Carlo.
- [ ] **2:10 – 2:40** : `3615 FANTOME` → niveau 3 (*L'émetteur déréglé*, `+380 Hz`) : la transmission se décode en charabia en seuil fixe ; activer **Accord automatique** dans le HUD → le message du fantôme et son code apparaissent clairement.
- [ ] **2:40 – 3:00** : Coulisses **Kiro** : architecture pilotée par les 4 specs (`.kiro/specs/`), tests de propriétés `fast-check` (`M1..M12`, `V1..V11`, `A1..A7`, `H1..H6`), et hooks de vérification automatique.
