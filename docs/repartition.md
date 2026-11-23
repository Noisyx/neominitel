# Répartition des tâches

Deux rôles. Mettez vos prénoms :

- **A — Développement** : ________ (le site, le Minitel à l'écran, le son, le micro, les services, la mise en ligne)
- **B — Maths, signal et Kiro** : ________ (le cerveau du modem, la théorie, 3615 MATHS, le réglage des niveaux, les hooks Kiro)

## Outils

- **B travaille dans Kiro.** Il exécute ses tâches depuis les fichiers `tasks.md`, et Kiro coche les cases tout seul. C'est son travail que le jury verra dans la partie « comment on a utilisé Kiro ».
- **A travaille dans un autre éditeur** (en attendant ses crédits Kiro). Son assistant IA lit `AGENTS.md`, qui le renvoie vers les mêmes règles (`.kiro/steering/`) et les mêmes specs. A coche lui-même les cases `[x]` dans les `tasks.md` quand il finit une tâche, pour que Kiro voie l'avancement.
- Si A obtient ses crédits en cours de route, il passe sur Kiro. Rien d'autre ne change.

## Hooks Kiro à créer (B, J1, environ 30 min)

Dans Kiro, panneau **Agent Hooks**, décrire chaque hook en une phrase :

1. Quand un fichier de `src/modem/` est enregistré, lancer les tests de `tests/properties/v23-modem.test.ts`.
2. Quand un fichier de `content/pages/` est enregistré, lancer le test de contenu (A6 : taille, caractères autorisés, pages assez différentes).
3. Quand `content/fantome/levels.json` change, relancer `scripts/generate-transmissions.ts --verify-only`.
4. Quand un `design.md` change, vérifier que chaque propriété (M1, V3, H2…) a un test du même nom, et le signaler sinon.
5. Avant un commit ou sur demande, vérifier qu'aucun code des fantômes n'apparaît en clair dans `public/` (H4).

Les hooks 2 et 3 surveillent les dossiers de A. Ils tourneront chez B à chaque `pull`, et chez A dès qu'il aura Kiro.

Les numéros renvoient aux fichiers `tasks.md` de chaque spec dans `.kiro/specs/`. Par exemple, « modem 5 » = tâche 5 de `v23-modem/tasks.md`.

---

## Le principe pour ne pas se marcher dessus

**Chacun a ses dossiers.** Tant que chacun reste dans les siens, git ne crée presque jamais de conflit.

| | A touche | B touche |
|---|---|---|
| Code | `src/videotex/`, `src/ui/`, `src/audio/`, `src/workers/`, `src/services/`, `src/fantome/`, `scripts/` | `src/modem/` |
| Contenu | `content/pages/` (sauf MATHS), `content/fantome/` | `content/pages/maths.ts` |
| Docs | `README.md`, `docs/demo-checklist.md` | `docs/math.md`, `docs/calibration.md` |

**Le contrat entre vous**, ce sont les interfaces TypeScript du fichier `v23-modem/design.md` (section « Interfaces ») : `modulate()`, `StreamingDemodulator`, `DemodEvent`. Le J1, vous les relisez ensemble et vous ne les changez plus sans vous prévenir.

**A n'attend pas B.** Tant que le vrai démodulateur n'est pas prêt, A utilise un faux démodulateur qui renvoie directement les bons octets. Quand B livre le vrai (vers J3), A le branche à la place.

**Routine git** : `pull` avant de commencer, `commit` + `push` à chaque tâche terminée.

---

## A — Développement

| Jours | Tâches | Résultat visible |
|---|---|---|
| **J1** (23 nov) | modem 1 : créer le projet (Vite, TypeScript, tests) et le pousser sur GitHub. Faux démodulateur. | B peut cloner et coder dès le soir |
| **J2** | videotex 1, 2, 3 : tables de codes, modèle d'écran, décodeur | Des octets donnent un écran |
| **J3** | videotex 4, 5, 7 : encodeur, touches, police et rendu. app 1 : le Minitel dessiné, l'écran de départ | Une page s'affiche dans le Minitel |
| **J4** | app 2, 3 : worker, lecture du son, page qui se dessine au rythme du son. Brancher le vrai modem de B | **Clic sur Connexion → SOMMAIRE se dessine** |
| **J5** | app 4, 5, 6 : routeur, services, clavier Minitel, test de bout en bout | On navigue dans les 3615 |
| **J6** | app 7, 8 : mode Écoute (micro) et mode Serveur (haut-parleur) | **Premier test téléphone → ordinateur** (avec B) |
| **J7** | videotex 6 + app 10 : vote majoritaire. app 9 : le HUD (graphiques) | Répétition répare une page abîmée |
| **J8** | app 11.2 et 11.3 : l'interface du banc d'essai et de la page Vote (avec B). app 13 : réglages du simulateur | 3615 MATHS fonctionne |
| **J9** | fantome 1, 2, 3 : histoire, pages, générateur et vérificateur des niveaux | Les fichiers son des niveaux existent |
| **J10** | fantome 4, 6 : le service 3615 FANTOME, la saisie des codes | **Les niveaux 1 à 4 se jouent** |
| **J11** | app 12, 14, 15 : mode Fichier, accessibilité, finitions, mise en ligne | Le site est en ligne |
| **J12** (4 déc) | Vidéo, README, soumission **avant 23h** (avec B) | C'est rendu |

Si le temps le permet (dans cet ordre) : app 17 (voie retour dans le site, quand B a fini modem 14), app 16 (3615 LIBRE), videotex 8 (double taille).

---

## B — Maths, signal et Kiro

| Jours | Tâches | Résultat visible |
|---|---|---|
| **J1** (23 nov) | Lire `v23-modem` en entier. Relire les interfaces avec A. Créer les 5 hooks Kiro. Commencer `docs/math.md` : ce que fait le modem, en mots simples | Le contrat est figé, Kiro est prêt |
| **J2** | modem 2, 3, 4 : constantes, mise en trames, modulateur, fichiers WAV | Un texte devient un son de modem écoutable |
| **J3** | modem 5, 6 : discriminateur (lire la fréquence), UART (relire les lettres) | **Son → texte qui marche** (test M1), livré à A |
| **J4** | modem 7 : démodulateur en continu, détection de porteuse et du son de connexion | A branche le vrai modem |
| **J5** | modem 8 : seuil adaptatif (l'« accord automatique ») | Un signal décalé de 380 Hz se décode |
| **J6** | modem 9 : simulateur de ligne (bruit, décalage, ronflement). Premier test téléphone → ordinateur (avec A) | On peut abîmer le signal volontairement |
| **J7** | modem 10 : estimation du SNR (M2M4), séquence PN9, mesure du taux d'erreur | Le taux d'erreur mesuré s'affiche |
| **J8** | modem 11 : les trois courbes théoriques (dont la formule de Marcum pour h = 2/3), simulation Monte Carlo. Interface du banc d'essai (avec A) | **Les points mesurés tombent sur la courbe** |
| **J9** | app 11.1 : les 6 pages explicatives de 3615 MATHS. Vérifier les formules du vote (spec videotex, « Math notes ») | 3615 MATHS a du contenu |
| **J10** | fantome 5 : régler la difficulté des niveaux avec deux vrais appareils. modem 12 : calibration | Les niveaux sont durs mais faisables |
| **J11** | modem 13 : performances. Relecture de tout le contenu MATHS. Répétition de la démo | Tout tient en temps réel |
| **J12** (4 déc) | Vidéo : la séquence 3615 MATHS et la séquence « comment on a utilisé Kiro » (specs, tests, hooks en action) (avec A) | C'est rendu |

Si le temps le permet (dans cet ordre) : modem 14 + fantome 7 (voie retour et niveau 5), modem 15 (deuxième démodulateur), videotex 9 (image en mosaïque).

---

## Ce que vous faites ensemble

| Quand | Quoi |
|---|---|
| J1 | Relire les interfaces du modem (30 min) |
| J6 | Premier test réel : un téléphone joue, un ordinateur écoute |
| J8 | Banc d'essai de 3615 MATHS (B donne les calculs, A fait l'affichage) |
| J10 | Tester les niveaux fantômes avec deux appareils |
| Avant J11 | videotex 1.3 : vérifier les codes marqués « (verify) » dans la norme STUM1B (celui qui a le temps) |
| J12 | Tourner la vidéo de 3 minutes et soumettre |

**Point quotidien de 10 minutes** : ce que j'ai fini, ce que je fais, ce qui me bloque.

## Points de contrôle (si l'un n'est pas atteint, on coupe un bonus)

| Date | Il faut que… |
|---|---|
| J4 (26 nov) | SOMMAIRE se dessine en mode Seul, avec le vrai modem |
| J6 (28 nov) | Une page passe d'un téléphone à un ordinateur par le son |
| J8 (30 nov) | 3615 MATHS montre des points mesurés sur la courbe |
| J10 (2 déc) | Les niveaux 1 à 4 de 3615 FANTOME se jouent |
| J11 (3 déc) | Le site est en ligne, plus aucune nouvelle fonction après ça |
