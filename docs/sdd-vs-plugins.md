# De l'ancien SDD au plugin + couche de gouvernance

> Pourquoi coding-flow a changé de nature, ce qui reste identique, et ce qu'il
> reste à faire pour que le paquet soit **totalement utilisable et en ligne**.
> Conception détaillée des ajouts : [`docs/plans/evidence-governance.md`](plans/evidence-governance.md).

## TL;DR

- **Avant** : coding-flow était un outil de **SDD** (Spec-Driven Development) —
  une méthodologie (epics → stories verticales → skills qui planifient, écrivent,
  implémentent, valident) livrée comme un **bundle de skills** installé par
  `npx`. Sa valeur = la structure et la discipline.
- **Maintenant** : la méthodologie SDD **reste le socle**, mais l'outil se
  positionne comme une **couche d'évidence & de gouvernance** (enforcement,
  provenance, preuve exécutée, registre d'audit, traçabilité, gate CI), et se
  **distribue aussi comme plugin natif** Claude Code.
- **Pourquoi** : la distribution de skills est devenue une commodité (plugins
  natifs + marketplaces), et le vrai frein en entreprise n'est pas la
  méthodologie mais la **gouvernance** (audit, conformité, preuve).
- Ce n'est pas une réécriture : c'est **additif**. Les skills SDD existent
  toujours ; on a construit la couche de preuve **par-dessus**.

## 1. L'ancien modèle : SDD (Spec-Driven Development)

Le SDD est la catégorie d'outils où l'on **décrit l'intention** (specs, plans,
stories) et où un agent **implémente** à partir de cette description. Exemples de
la même famille : GitHub **Spec Kit**, **BMAD**, **Kiro**, **OpenSpec**.

coding-flow, dans cette logique, apportait :

- un **format** : epic → story verticale → `story.md` / `tasks.md` / `tests.md` /
  `decisions.md` / `implementation-notes.md` ;
- des **skills** (planificateur, rédacteur de story, implémenteur, validateurs) ;
- des **règles** et un **harnais de sécurité** qui *scanne* (secrets, fichiers
  sensibles) et *estime* le risque d'une story ;
- une **distribution** par `npx github:LandryPouth/codin-flow`.

**Sa valeur réelle** : imposer une structure et une discipline à un agent, pour
éviter le code « au fil de l'eau ». C'est utile — mais c'est ce que fait *toute*
la catégorie SDD.

**Ses limites** (ce qui a déclenché le virage) :

1. **La preuve reposait sur l'affirmation de l'agent.** « C'est fait », « les
   tests passent » : rien ne l'*exécutait* ni ne le *signait*. Or c'est la même
   IA qui écrit le code **et** les tests — un « vert » ne prouve presque rien.
2. **Le harnais était consultatif.** Il scannait *après coup* et *signalait* ; il
   n'*empêchait* rien. Un secret pouvait encore atteindre le disque.
3. **La distribution était un tapis roulant.** Chaque release = re-livrer le
   bundle de skills. Peu différenciant, coûteux à maintenir.

## 2. Ce qui a changé dans l'écosystème (le « pourquoi »)

Trois basculements, tous en 2026 :

- **Les plugins natifs + marketplaces commoditisent les bundles de skills.**
  Claude Code installe désormais des plugins en une commande
  (`/plugin marketplace add …`, `/plugin install …`), et des marketplaces
  publient des packs de skills à la pelle. Être « un pack de skills de plus »
  n'est plus un avantage.
- **La catégorie SDD est saturée.** Rivaliser sur *l'étendue des skills* ou « être
  un autre Spec Kit », c'est une course perdue d'avance.
- **Le vrai blocage entreprise est la gouvernance, pas la qualité du code.**
  ~88 % des pilotes d'IA n'atteignent jamais la production — à cause de l'audit,
  de la conformité et du contrôle, pas parce que le code est mauvais. Le besoin
  non couvert, c'est **la preuve** : qui a fait quoi, est-ce *réellement* vérifié,
  peut-on le montrer à un auditeur.

Conclusion stratégique : ne pas concurrencer sur les skills (commoditisés), mais
**posséder la couche que personne ne tient** — l'évidence et la gouvernance — et
**utiliser le canal plugin** pour que la distribution cesse d'être un fardeau.

## 3. Le nouveau modèle : couche d'évidence & de gouvernance

Le principe directeur unique :
*« nothing executed ≠ verified ; asserted ≠ proven ; anonymous ≠ auditable »*.

Chaque garde-fou *conseillé* devient un garde-fou *exécuté*, attaché à une
**identité**, agrégé dans un **registre exportable**, et vérifié **hors de la main
de l'agent**. Concrètement (voir le plan pour le détail) :

- **`guard`** — enforcement **déterministe** : un hook PreToolUse refuse
  l'écriture d'un chemin bloqué ou d'un secret **avant** le disque. On passe du
  *conseil* au *garde-fou en code*.
- **Provenance** — chaque preuve embarque commit / branche / auteur / état dirty.
- **`verify`** — exécute *vraiment* les commandes de validation déclarées et
  capture le résultat verbatim ; « rien exécuté ≠ vérifié ».
- **`audit`** — registre **append-only** + export `docs/AUDIT.md` (artefact de
  conformité) + gate `--check` « pas de merge sans preuve verte ».
- **`ship`** — attache la preuve `verify` au corps de la PR.
- **`trace`** — chaîne story → commits → PR → évidence → tests, maillons manquants
  signalés. *« Prouve que l'exigence est livrée ET vérifiée. »*
- **`ci init`** — rejoue `verify` + `audit --check` sur un checkout neuf : le
  signal non-jouable, sur compute gratuit.

Et la **distribution redevient un atout** :

- **Plugin natif** (`.claude-plugin/`) : skills + hook `guard` installés sans
  `ai-flow init`, mis à jour via marketplace — fin du re-ship manuel.
- **npm** (`@landry_pouth/coding-flow`) : le CLI et la CI.
- Les deux canaux **coexistent** : npm pour CLI/CI, plugin pour l'IDE.

## 4. SDD (avant) vs couche de gouvernance (maintenant)

| Axe | Ancien SDD | Maintenant |
| --- | --- | --- |
| Ce qui est prouvé | l'intention est **spécifiée** | la livraison est **vérifiée** |
| Source de vérité | l'**affirmation** de l'agent | la **machine** (exécution + capture verbatim) |
| Sécurité | scan **après coup**, *consultatif* | refus **avant écriture**, *déterministe* (`guard`) |
| Identité | anonyme | provenance git signée sur chaque preuve |
| Historique | fichiers de run épars | registre **append-only** + export conformité |
| Traçabilité | implicite | explicite, bout en bout (`trace`) |
| Gate | l'agent se relit lui-même | CI clean-room, **hors de sa main** |
| Distribution | bundle `npx` (tapis roulant) | plugin natif + marketplace + npm |
| Différenciation | « un SDD de plus » | la couche que la catégorie ne tient pas |

Ce que le SDD **garde** : les epics/stories, les skills, le format de story, la
discipline de tests. C'est le **socle**, pas ce qui a disparu.

## 5. Ce qu'il reste à faire pour publier et rendre l'outil utilisable en ligne

État actuel : 97 tests verts, version **0.2.0**, PR **#7** ouverte vers `main`
(https://github.com/LandryPouth/codin-flow/pull/7). Reste, dans l'ordre :

### A. Fusionner et publier (prérequis à tout le reste)

1. **Merger la PR #7 dans `main`** une fois la CI verte.
2. **S'authentifier sur npm** (bloquant actuel : `ENEEDAUTH`). En interactif :
   ```bash
   npm login --auth-type=legacy      # compte @landry_pouth
   ```
3. **Publier** depuis `~/dev/tools/coding-flow` :
   ```bash
   npm test                          # aussi lancé par prepublishOnly
   npm publish                       # publie @landry_pouth/coding-flow@0.2.0
   ```

> ⚠️ **Dépendance critique — le `guard` ne fonctionne qu'une fois publié.**
> Le hook câblé (dans `.claude/settings.json` et dans `.claude-plugin/hooks/hooks.json`)
> invoque `npx --yes @landry_pouth/coding-flow guard`. Tant que le paquet n'est
> **pas** publié sur npm, `npx` ne peut pas le résoudre et le hook ne bloque rien.
> **La publication npm est donc un prérequis** pour que l'enforcement (l'argument
> phare) soit réellement actif chez l'utilisateur. À faire en premier.

### B. Valider le canal plugin de bout en bout

4. **Tester l'installation plugin réelle** dans une session Claude Code :
   ```text
   /plugin marketplace add LandryPouth/codin-flow
   /plugin install coding-flow
   ```
   Vérifier que les skills apparaissent et que le hook `guard` se déclenche.
5. **Confirmer que `guard` refuse bien en conditions réelles** : tenter d'écrire
   un `.env` ou un contenu avec un faux secret, et vérifier le refus (exit 2).

### C. Cohérence & finition

6. **Nom du dépôt vs paquet** : le repo est `codin-flow` (sans « g ») alors que le
   paquet est `@landry_pouth/coding-flow`. Décider si on renomme le repo pour la
   découvrabilité, ou si on assume l'écart (documenté).
7. **CHANGELOG** : ajouter une entrée 0.2.0 listant la couche évidence &
   gouvernance (utile pour les futurs utilisateurs et le marketplace).
8. **Smoke test d'install propre** : `npx @landry_pouth/coding-flow init` dans un
   projet jetable après publication, puis `ai-flow doctor`, `harness verify`,
   `audit --export`, `trace` — vérifier le parcours complet en conditions réelles.
9. (Optionnel) **README** : badges npm/CI, section « Installer comme plugin » déjà
   présente à revérifier une fois l'install plugin validée.

### Hors périmètre (volontairement différé)

- **Backend de stockage GitHub** (issues/sub-issues) : le seam existe, l'implé
  reste différée tant qu'un besoin réel n'apparaît pas.
- **Runner de diff-coverage maison** : `ci init` fournit le crochet documenté, pas
  un runner ; on branche un outil tiers si besoin.

## En une phrase

L'ancien coding-flow **décrivait** le travail (SDD) ; le nouveau **le prouve et le
gouverne**, et se distribue par le canal (plugin) qui a rendu les simples bundles
de skills obsolètes. Il ne manque, pour être pleinement en ligne, que la
**publication npm** (qui débloque aussi le `guard`) et la **validation du canal
plugin**.
