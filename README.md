# Coding Flow

Coding Flow est un workflow d'ingénierie AI-native pour les développeurs qui utilisent Claude Code, Codex, ou d'autres agents de code.

Son but est simple : rendre le développement assisté par IA plus prévisible, moins coûteux en tokens, et capable de livrer des features complètes en une seule passe quand le contexte est clair.

En pratique, Coding Flow installe un petit système de travail dans votre projet. Ce système donne aux agents :

- des skills réutilisables pour planifier, implémenter, tester et reviewer ;
- des règles projet partagées entre agents ;
- une structure légère d'epics et de stories verticales ;
- des modes d'exécution adaptés au risque : `QUICK`, `FAST`, `STANDARD`, `STRICT` ;
- une stratégie de contexte pour éviter qu'une story simple consomme une demi context window ;
- des garde-fous de validation, rollback, documentation et preuves de sécurité.

Coding Flow n'est pas un framework applicatif et ne remplace pas votre stack. Il ajoute une couche de méthode autour de votre repo pour que l'agent sache quoi lire, quoi produire, quand s'arrêter, quoi valider et comment laisser une trace utile.

## Vue D'Ensemble

Le projet repose sur quatre blocs simples :

1. **Le CLI `ai-flow`**
   Il installe, met à jour et vérifie les fichiers du workflow. Il peut aussi scanner un projet existant, lister les stories et exécuter le harness de sécurité.

2. **Les fichiers de contexte**
   `PROJECT_RULES.md`, `AGENT_RULES.md`, `docs/project-context.md`, `docs/architecture.md`, `docs/conventions.md` et `docs/roadmap.md` donnent à l'agent les règles et la carte durable du projet.

3. **Les skills**
   Les skills sont des workflows réutilisables. Par exemple `$plan-epic` découpe une capacité produit en stories, `$run-story` exécute une story, et `$run-story-secure` ajoute des validations sécurité.

4. **Le harness de sécurité**
   Le harness rend certains garde-fous vérifiables par le CLI : secrets, fichiers sensibles, niveau de risque d'une story, notes de rollback et preuves JSON dans `.coding-flow/runs/`.

## Comment Ça Marche

Le workflow normal ressemble à ceci :

```txt
1. ai-flow init
   -> installe les règles, docs, skills, exemples et la policy harness.

2. L'agent lit PROJECT_RULES.md et AGENT_RULES.md
   -> il comprend les limites, les modes et les stop conditions.

3. Vous planifiez un epic ou une story
   -> $plan-epic, $write-story ou $bootstrap-brownfield.

4. Vous exécutez une story
   -> $quick-story, $run-story ou $run-story-secure.

5. L'agent implémente, teste, valide et documente
   -> implementation-notes.md, decisions.md si nécessaire, harness evidence si applicable.

6. ai-flow doctor / harness check peuvent vérifier l'installation et les preuves
   -> utile localement, en CI ou avant release.
```

Le point important : l'utilisateur ne doit pas enchaîner dix commandes à la main. Les commandes `harness` existent pour le debug et la CI, mais les workflows `$run-story` et `$run-story-secure` demandent à l'agent de les appeler automatiquement quand `ai-flow` est disponible.

## Table Des Matières

- [Installation rapide](#installation-rapide)
- [Vue d'ensemble](#vue-densemble)
- [Comment ça marche](#comment-ça-marche)
- [Démarrage en 10 minutes](#démarrage-en-10-minutes)
- [Quel workflow choisir ?](#quel-workflow-choisir-)
- [Concepts essentiels](#concepts-essentiels)
- [Workflow quotidien](#workflow-quotidien)
- [Efficacité contexte et tokens](#efficacité-contexte-et-tokens)
- [Structure installée](#structure-installée)
- [Catalogue des skills](#catalogue-des-skills)
- [Guides pratiques](#guides-pratiques)
- [Fichiers de contexte](#fichiers-de-contexte)
- [Stop conditions](#stop-conditions)
- [Commandes CLI](#commandes-cli)
- [Désinstaller Coding Flow](#désinstaller-coding-flow)
- [Développement local du package](#développement-local-du-package)
- [Distribution GitHub via npx](#distribution-github-via-npx)

## Installation Rapide

Coding Flow est distribué depuis GitHub. Il n'est pas nécessaire de cloner le repository ni de publier le package sur npm pour l'utiliser.

Dans le projet que vous voulez équiper :

```bash
npx github:LandryPouth/codin-flow init
```

`init` ajoute aussi des scripts locaux `flow:*` dans le `package.json`.
Si le projet n'a pas encore de `package.json`, Coding Flow en crée un minimal à la racine avec `private: true`.
Le quotidien devient alors :

```bash
npm run flow:doctor
npm run flow:skills
npm run flow:status
npm run flow:check
```

`init` crée aussi un pense-bête local :

```txt
.coding-flow/COMMANDS.md
```

Pour afficher les commandes utiles depuis le projet :

```bash
npm run flow:commands
```

Si `doctor` signale des fichiers manquants ou un miroir `.agents` désynchronisé :

```bash
npm run flow:fix
```

Pour mettre à jour les fichiers Coding Flow installés dans un projet sans écraser les modifications locales :

```bash
npm run flow:upgrade -- --dry-run
npm run flow:upgrade
```

Pour préparer un projet existant :

```bash
npx github:LandryPouth/codin-flow bootstrap --scan
```

Pour le développement local du package, clonez le repo puis utilisez `npm link` ; voir [Développement local du package](#développement-local-du-package).

Si le package est lié localement avec `npm link`, les commandes courtes `ai-flow` deviennent disponibles :

```bash
ai-flow init
ai-flow doctor
ai-flow commands
ai-flow upgrade
ai-flow status
ai-flow list-skills
ai-flow worktree add <name>|--story <dir>   # optionnel : travail parallèle (voir Guides Pratiques)
```

Par défaut, les fichiers existants ne sont pas écrasés. Pour réinstaller volontairement les templates :

```bash
npx github:LandryPouth/codin-flow init --force
```

Pour voir ce qui serait installé sans écrire de fichiers :

```bash
npx github:LandryPouth/codin-flow init --dry-run
```

Pour une sortie lisible par CI ou scripts :

```bash
npm run flow:doctor -- --json
npm run flow:status -- --json
npm run flow:skills -- --json
```

## Démarrage En 10 Minutes

### Projet Existant

Demandez d'abord à l'agent d'analyser le projet sans modifier l'application :

```txt
Use $agent-planner to analyze this existing codebase and update docs/project-context.md, docs/architecture.md, docs/conventions.md, docs/roadmap.md, PROJECT_RULES.md, and AGENT_RULES.md. Do not modify application code.
```

Option plus économique en contexte pour les codebases existants :

```bash
ai-flow bootstrap --scan
```

```txt
Use $bootstrap-brownfield with docs/bootstrap-scan.md to fill project context, architecture, conventions, and roadmap. Do not modify application code.
```

Puis créez le premier epic :

```txt
Use $plan-epic to identify the safest first vertical slice and create an implementation-ready epic with stories.
```

Ensuite exécutez les stories une par une :

```txt
Use $run-story in STANDARD mode for story-01-01.
```

### Nouveau Projet

Clarifiez l'idée produit :

```txt
Use $grill-me to clarify the product idea, users, constraints, and first shippable value.
```

Créez le contexte initial :

```txt
Use $agent-planner to define the initial product context, target architecture, conventions, roadmap, and project rules. Do not implement application code yet.
```

Planifiez le premier epic :

```txt
Use $plan-epic to create epic-01 and its implementation-ready stories.
```

Lancez la première story :

```txt
Use $run-story in STANDARD mode for the first story.
```

## Quel Workflow Choisir ?

| Situation | Skill recommandé | Pourquoi |
| --- | --- | --- |
| Petite correction isolée, texte, style local | `$quick-story` | Le plus faible coût en contexte. Pas de cérémonie. |
| Story simple déjà claire | `$run-story FAST` | Garde un minimum de stop conditions et rollback notes. |
| Feature produit normale | `$run-story STANDARD` | Bon équilibre entre one-shot, validation et coût. |
| Auth, permissions, admin, paiement, migration | `$run-story STRICT` ou `$run-story-secure` | Validation plus forte et meilleurs garde-fous. |
| Le point d'édition est flou ou cross-module | `$agent-context-scout` puis `$run-story` | Cartographie le contexte sans polluer l'implémentation. |
| Besoin de planifier plusieurs stories | `$plan-epic` | Crée un epic vertical et des stories prêtes à implémenter. |
| Besoin de clarifier le besoin | `$grill-me` | Pose les questions bloquantes avant de coder. |

Règle pratique :

```txt
Small and obvious -> quick-story
Clear story -> FAST
Normal feature -> STANDARD
Risky or security-sensitive -> STRICT / run-story-secure
Unclear edit points -> agent-context-scout
```

## Concepts Essentiels

### Epic

Un epic regroupe une petite capacité produit livrable. Il doit rester assez court pour commencer à shipper rapidement.

Exemple :

```txt
epics/epic-01-admin-content/
  index.md
  story-01-01-audit-hardcoded-content/
  story-01-02-render-first-dynamic-section/
  story-01-03-admin-edit-first-content-type/
```

### Story Verticale

Une story doit livrer un résultat utilisateur ou système observable. Elle ne doit pas être découpée par couche technique.

Préférez :

```txt
Admin can create and publish the first content type.
```

Évitez :

```txt
Create DTOs.
Build backend.
Build frontend.
```

### Execution Packet

L'Execution Packet résume ce qui sera implémenté, ce qui est exclu, les validations à faire, les stop conditions et les notes de rollback.

Il évite que l'agent commence à coder avec une compréhension molle du scope.

### Context Map

La Context Map est l'artefact anti-gaspillage de tokens.

Elle indique :

- les fichiers ou dossiers probablement pertinents ;
- les recherches à lancer en premier ;
- les points d'édition probables ;
- les risques à valider ;
- les zones à éviter sauf nécessité ;
- le budget de contexte.

### Implementation Context

Chaque story générée contient un `Implementation Context` court. Il aide Codex à commencer au bon endroit, sans relire tout le projet.

## Workflow Quotidien

### 1. Planifier

```txt
Use $plan-epic to create the next smallest shippable epic and its implementation-ready stories.
```

### 2. Choisir le mode

```txt
Use $quick-story to fix the typo in the dashboard empty state.
```

```txt
Use $run-story in FAST mode for story-02-01.
```

```txt
Use $run-story in STANDARD mode for story-02-03-admin-create-post.
```

```txt
Use $run-story-secure for story-01-02-register because it touches auth and user data.
```

### 3. Implémenter En Une Passe

Le système cherche à garder le côté one-shot :

```txt
understand scope -> locate edit points -> implement -> test -> validate -> document
```

La différence avec un workflow lourd est que Coding Flow ne charge pas tout le projet par défaut. Il escalade le contexte seulement quand le risque le justifie.

### 4. Reviewer

Après une feature importante :

```txt
Use $review-codebase to review the latest implementation before merge.
```

Pour un risque spécifique :

```txt
Use $agent-validator-architecture to review the architecture impact.
```

```txt
Use $agent-validator-tests to review the test coverage.
```

```txt
Use $agent-validator-security to review the permission and data visibility model.
```

## Efficacité Contexte Et Tokens

Coding Flow utilise une échelle de contexte.

| Mode | À utiliser quand | Contexte attendu |
| --- | --- | --- |
| `QUICK` | Changement minuscule et évident | Requête, `story.md` si présent, 1-3 recherches, fichiers ciblés. |
| `FAST` | Story simple et faible risque | Story folder, fichiers ciblés, stop conditions inline. |
| `STANDARD` | Feature normale | Execution Packet compact, Context Map, validation normale. |
| `STRICT` | Changement risqué | Docs nécessaires, Context Map, tests, architecture, sécurité. |

`SCOUT` n'est pas un mode d'exécution. C'est une pré-étape optionnelle :

```txt
edit points unclear -> agent-context-scout -> FAST/STANDARD/STRICT
```

Utilisez `$agent-context-scout` quand le point d'édition est flou, cross-module, ou quand l'agent risquerait de lire trop large.

Budgets par défaut :

- `QUICK` : arrêter après 3 recherches ou 5 fichiers si le point d'édition reste flou.
- `FAST` : arrêter après 5 recherches ou 8 fichiers si le point d'édition reste flou.
- `STANDARD` : créer ou réutiliser une Context Map avant l'implémentation.
- `STRICT` : lire les docs nécessaires, mais chercher les fichiers d'implémentation de façon ciblée.

Important :

- Le contexte est réduit pour économiser les tokens, pas pour découper la feature.
- Une fois les points d'édition clairs, l'agent doit implémenter, tester, valider et documenter dans la même passe.
- `$agent-context-scout` ne code pas. Il prépare seulement une carte compacte.

## Structure Installée

```txt
.claude/
  skills/
    agent-context-scout/
    agent-orchestrator/
    agent-planner/
    agent-worker-fullstack/
    agent-worker-tests/

    agent-validator-architecture/
    agent-validator-security/
    agent-validator-tests/

    blueprint-epic-index/
    blueprint-story/
    blueprint-tasks/
    blueprint-tests/
    blueprint-decisions/
    blueprint-implementation-notes/

    bootstrap-brownfield/
    plan-epic/
    quick-story/
    run-story/
    run-story-secure/

    grill-me/
    implement-slice/
    tdd/
    e2e-check/
    architecture-check/
    tests-check/
    security-check/
    review-codebase/
    write-story/

.agents/
  README.md
  skills/
    same skills mirrored for Codex and other agents

.coding-flow/
  manifest.json
  harness.json
  COMMANDS.md
  runs/

docs/
  project-context.md
  architecture.md
  conventions.md
  roadmap.md

epics/

examples/
  epic-01-example-admin-content/

AGENTS.md
AGENT_RULES.md
PROJECT_RULES.md
CLAUDE.md
```

Claude Code découvre les skills dans `.claude/skills/`.

Coding Flow installe aussi les mêmes skills dans `.agents/skills/` pour Codex et les agents qui ne lisent pas automatiquement le dossier Claude.

Le miroir est volontairement physique plutôt qu'un symlink pour rester compatible avec Windows, npm, archives zip, CI et agents qui ne suivent pas toujours les liens symboliques. `ai-flow doctor` vérifie que le miroir reste conforme, et `ai-flow doctor --fix` peut le resynchroniser.

`.coding-flow/manifest.json` permet à `ai-flow upgrade` de mettre à jour les fichiers installés sans écraser les modifications locales.

`.coding-flow/harness.json` contient la policy de sécurité légère installée par défaut : chemins bloqués, patterns de fichiers sensibles, checks attendus et mots-clés qui font monter une story en risque moyen ou élevé.

`.coding-flow/COMMANDS.md` est le pense-bête local des commandes quotidiennes. Il évite de retourner sur GitHub pour retrouver la bonne syntaxe.

`.coding-flow/runs/` reçoit les preuves JSON produites par `ai-flow harness evidence`. Ces fichiers servent surtout aux reviews, à la CI et aux audits légers.

`CLAUDE.md` importe les règles projet :

```md
@PROJECT_RULES.md
@AGENT_RULES.md
```

## Catalogue Des Skills

### Skills Macro

| Skill | Usage |
| --- | --- |
| `$quick-story` | Exécuter un changement minuscule avec le minimum de contexte. |
| `$plan-epic` | Créer un epic vertical et des stories prêtes à implémenter. |
| `$run-story` | Exécuter une story en `FAST`, `STANDARD` ou `STRICT`. |
| `$run-story-secure` | Exécuter une story sensible avec validation sécurité. |

### Planning Et Story Writing

| Skill | Usage |
| --- | --- |
| `$grill-me` | Clarifier un besoin flou avec des questions ciblées. |
| `$agent-planner` | Transformer une intention produit en plan, epic ou stories. |
| `$bootstrap-brownfield` | Transformer `docs/bootstrap-scan.md` en docs projet utiles. |
| `$write-story` | Créer ou raffiner une story verticale. |
| `$blueprint-epic-index` | Générer `index.md` pour un epic. |
| `$blueprint-story` | Générer `story.md`. |
| `$blueprint-tasks` | Générer `tasks.md`. |
| `$blueprint-tests` | Générer `tests.md`. |
| `$blueprint-decisions` | Générer `decisions.md`. |
| `$blueprint-implementation-notes` | Générer ou mettre à jour `implementation-notes.md`. |

### Implémentation Et Validation

| Skill | Usage |
| --- | --- |
| `$agent-context-scout` | Produire une Context Map courte avant une implémentation large ou floue. |
| `$implement-slice` | Implémenter une story verticale de bout en bout. |
| `$agent-worker-fullstack` | Worker d'implémentation fullstack. |
| `$agent-worker-tests` | Worker dédié aux tests. |
| `$tdd` | Utiliser un cycle TDD ciblé. |
| `$tests-check` | Vérifier rapidement la couverture de tests. |
| `$e2e-check` | Vérifier la nécessité ou l'état des tests E2E. |
| `$architecture-check` | Vérifier rapidement l'impact architecture. |
| `$security-check` | Vérifier rapidement les risques sécurité. |
| `$review-codebase` | Revue finale avant merge. |

### Validateurs Profonds

| Skill | Usage |
| --- | --- |
| `$agent-validator-architecture` | Revue architecture approfondie. |
| `$agent-validator-tests` | Revue tests approfondie. |
| `$agent-validator-security` | Revue sécurité approfondie. |

## Guides Pratiques

### Corriger Une Petite Erreur De Texte

```txt
Use $quick-story to update the dashboard empty state copy.
```

### Ajouter Une Feature CRUD Normale

```txt
Use $plan-epic to create a small epic for admin-managed posts.
```

```txt
Use $run-story in STANDARD mode for story-01-01-admin-create-post.
```

### Modifier Une Zone Auth

```txt
Use $run-story-secure for story-01-02-register because it touches auth, validation, and user data.
```

### Quand Le Codebase Est Trop Grand

```txt
Use $agent-context-scout for story-02-03 to identify relevant files, search anchors, risks, and validation focus. Do not modify files.
```

Puis :

```txt
Use $run-story in STANDARD mode for story-02-03 using the Context Map.
```

### Préparer Un Projet Brownfield

```bash
ai-flow bootstrap --scan
```

```txt
Use $bootstrap-brownfield with docs/bootstrap-scan.md to fill project context, architecture, conventions, and roadmap. Do not modify application code.
```

Alternative agent-only :

```txt
Use $agent-planner to analyze this codebase, identify the stack, architecture, hardcoded data, coupling points, conventions, risks, and recommended first epic. Update only workflow docs. Do not change application code.
```

### Voir L'État Des Stories

```bash
ai-flow status
```

```bash
ai-flow status --json
```

Le statut est lu depuis `implementation-notes.md` quand une section `## Status` existe. Sinon, le CLI l'infère depuis les notes.

Quand un worktree travaille sur une story (voir `--story` ci-dessous), `status`
affiche la correspondance et liste les worktrees actifs — un tableau de bord du
travail parallèle en cours :

```text
epic-03-kyc
- story-03-01-kyc-upload                     in-progress   → wt: ../repo-worktrees/story-03-01-kyc-upload

Worktrees (hors story):
- feat/spike-cache                           ../repo-worktrees/feat-spike-cache
```

### Travail Parallèle Sur Plusieurs Features (Worktrees)

Support **optionnel** pour développer plusieurs features réellement indépendantes
en parallèle, chacune dans son propre dossier de travail (worktree Git), sans
quitter le zéro-dépendance :

```bash
ai-flow worktree add feat/payments         # crée le worktree + la branche, câble .env / deps
ai-flow worktree add --story epics/epic-03-kyc/story-03-01-kyc-upload  # branche nommée d'après la story
ai-flow worktree list                      # liste les worktrees et l'état des liens
ai-flow worktree remove feat/payments      # retire le worktree, conserve la branche
```

`add` place le worktree dans `../<repo>-worktrees/<nom>`, symlinke `.env`/`.env.local`,
et gère `node_modules` selon le package manager détecté (symlink pour npm simple,
`install` recommandé pour un monorepo pnpm/yarn). Options : `--from <ref>`,
`--deps install|link|skip`, `--story <dir>`, `--dry-run`.

Avec `--story <dir>`, la branche/worktree prend le nom du dossier de la story.
La correspondance worktree↔story est alors **sans état** : `ai-flow status` la
retrouve en comparant le nom de branche au dossier de la story — aucun fichier de
mapping à maintenir. `add --story` suggère aussi le `harness preflight` de la story.

Le worktree n'est utile que pour du travail **parallélisable** (zones de code
disjointes, socle stable). Pour une liste de changements séquentiels/dépendants,
déroulez-les une étape à la fois. Détails et arbitrage : `docs/plans/parallel-mode.md`.

> **Pourquoi les worktrees sont des _siblings_ (`../<repo>-worktrees/`) et pas
> dans le repo ?** Un `worktrees/` gitignoré *à l'intérieur* du repo resterait
> parcouru par tous les outils qui ne lisent pas `.gitignore` : `tsc`, eslint,
> jest, les watchers, `docker build .`, et les globs de workspace (`packages/*`).
> Pire, `git clean -fdx` le supprimerait avec tout le travail non commité. Le
> sibling est hors de portée de tout ça. La catégorisation `feat/`/`fix/` reste
> possible via le nom de branche (`add feat/x` → `../repo-worktrees/feat/x`).

### Ouvrir Une PR Par Feature (`ship`)

Depuis un worktree (ou n'importe quelle branche de feature), `ship` pousse la
branche et ouvre **une** PR vers la base — idempotent, une feature = une PR :

```bash
ai-flow ship                       # push + PR vers la branche par défaut du remote
ai-flow ship --base develop --draft
ai-flow ship --dry-run             # montre le plan sans rien pousser
```

`ship` agit sur la **branche courante**, jamais sur le layout local (le push ne
transmet que des commits, jamais la forme du dossier — le repo distant reste un
repo normal quoi qu'il arrive). Il utilise `gh` s'il est disponible pour
créer/mettre à jour la PR ; sinon il pousse et affiche l'URL de comparaison à
ouvrir à la main. Garde-fous : refuse depuis la base, sans `origin`, ou s'il n'y
a aucun commit à shipper.

## Fichiers De Contexte

### `docs/project-context.md`

Carte durable de l'état actuel du projet.

À inclure :

- résumé produit ;
- état actuel ;
- architecture cible ;
- domaines métier ;
- modèle de données ;
- rôles utilisateurs ;
- workflows importants ;
- contraintes techniques ;
- risques connus ;
- roadmap actuelle ;
- résumé des décisions.

À éviter :

- logs d'implémentation ;
- notes temporaires ;
- détails d'une seule story ;
- audit brut du codebase.

### `docs/architecture.md`

Décrit les frontières, modules, data flow, conventions d'architecture et dépendances importantes.

### `docs/conventions.md`

Décrit les conventions de code, tests, UI, API, nommage, fichiers et validation.

### `docs/roadmap.md`

Garde les prochaines étapes produit et les gros jalons.

### Story `decisions.md`

Stocke les décisions détaillées d'une story :

- tradeoffs ;
- alternatives rejetées ;
- conséquences ;
- choix d'architecture ;
- dette acceptée.

### Story `implementation-notes.md`

Stocke ce qui s'est réellement passé :

- fichiers modifiés ;
- tests lancés ;
- validations ;
- notes de rollback ;
- problèmes rencontrés ;
- follow-ups ;
- risques restants.

Règle :

```txt
project-context.md = état durable du projet
decisions.md = décisions détaillées de story
implementation-notes.md = historique réel d'implémentation
```

## Stop Conditions

Arrêtez l'implémentation au lieu de deviner quand :

- le scope de la story est ambigu ;
- les critères d'acceptation ne sont pas testables ;
- le modèle auth, rôle ou permission est flou ;
- une migration breaking est nécessaire ;
- un service externe, secret ou contrat API est inconnu ;
- les commandes de validation ne peuvent pas tourner ;
- l'architecture existante contredit la demande ;
- la sécurité dépend d'un contrôle seulement côté client ;
- le point d'édition reste flou après le budget de contexte.

Quand une stop condition se déclenche, l'agent doit expliquer :

- ce qui bloque ;
- pourquoi continuer serait risqué ;
- quelle décision ou information manque ;
- quel skill ou workflow utiliser ensuite.

## Bonnes Pratiques Pour Débutants

- Commencez par `$agent-planner` avant de lancer une grosse feature.
- Utilisez `$quick-story` pour les petits changements évidents.
- Utilisez `STANDARD` par défaut pour une vraie feature.
- Passez en `STRICT` dès que la story touche auth, permissions, admin, paiement, données sensibles ou migration.
- Ne demandez pas à l'agent de tout lire. Demandez-lui de cibler les fichiers.
- Gardez les stories verticales et testables.
- Lisez `implementation-notes.md` après chaque story.

## Bonnes Pratiques Pour Experts

- Gardez les epics entre 2 et 5 stories.
- Utilisez `$agent-context-scout` pour les zones cross-module ou les codebases larges.
- Faites porter les détails de contexte par `Implementation Context`, pas par un énorme prompt utilisateur.
- Ajoutez des stop conditions spécifiques aux stories risquées.
- Escaladez vers les validateurs profonds uniquement quand le risque le justifie.
- Évitez les stories techniques pures si elles ne livrent pas un comportement observable.
- Préférez une Context Map compacte à une exploration brute du repository.

## Commandes CLI

| Commande | Usage |
| --- | --- |
| `ai-flow init` | Installer les templates, le manifest, la config projet (`.coding-flow/config.json`) et la policy harness. |
| `ai-flow init --no-branch-per-epic` | Désactiver la policy « une epic = une branche, jamais main ». |
| `ai-flow upgrade` | Mettre à jour les fichiers installés sans écraser les modifications locales. |
| `ai-flow doctor` | Vérifier les fichiers, skills, frontmatter, manifest et miroir `.agents`. |
| `ai-flow doctor --fix` | Restaurer les fichiers manquants et resynchroniser `.agents/skills`. |
| `ai-flow doctor --strict` | Ajouter des checks plus stricts sur manifest et docs. |
| `ai-flow status` | Lister les epics/stories, leur statut inféré et le worktree lié. |
| `ai-flow worktree add <name>` | Créer un worktree + branche pour du travail parallèle (câble `.env`/deps). |
| `ai-flow worktree add --story <dir>` | Idem, en nommant la branche d'après la story (liée dans `status`). |
| `ai-flow worktree list` | Lister les worktrees et l'état des liens `.env`. |
| `ai-flow worktree remove <name>` | Retirer un worktree, conserver la branche. |
| `ai-flow ship` | Pousser la branche courante et ouvrir/mettre à jour une PR vers la base (via `gh`). |
| `ai-flow bootstrap --scan` | Scanner un codebase existant et écrire `docs/bootstrap-scan.md`. |
| `ai-flow harness init` | Créer une policy `.coding-flow/harness.json` explicite. |
| `ai-flow harness preflight --story <path>` | Estimer le risque d'une story et lister les checks requis. |
| `ai-flow harness check --story <path>` | Vérifier secrets, fichiers sensibles et preuves minimales de story. |
| `ai-flow harness verify --story <path>` | Exécuter les commandes de validation déclarées, capturer verbatim le résultat, échouer si ça casse. |
| `ai-flow harness evidence --story <path>` | Écrire une preuve légère dans `.coding-flow/runs/`. |
| `ai-flow guard` | Hook PreToolUse : refuse (exit 2) l'écriture d'un chemin bloqué ou d'un secret, **avant** le disque. Câblé dans `.claude/settings.json` par `init` (`--no-guard` pour ignorer). |
| `ai-flow audit` | Agréger les preuves en un registre append-only (`.coding-flow/ledger.jsonl`). |
| `ai-flow audit --export` | Écrire `docs/AUDIT.md` (artefact de conformité) depuis le registre. |
| `ai-flow audit --check` | Gate CI : échoue si la dernière `verify` par story est rouge ou absente. |
| `ai-flow trace [--story <path>]` | Chaîne story → commits → PR → évidence → tests, avec les maillons manquants. |
| `ai-flow ci init` | Scaffolder un workflow GitHub Actions clean-room (`verify` + `audit --check`) dans le projet. |
| `ai-flow plugin sync\|check` | Synchroniser/vérifier les skills du plugin natif vs les templates. |
| `ai-flow commands` | Afficher les commandes les plus utiles pour le projet courant. |
| `ai-flow uninstall` | Retirer Coding Flow du projet en conservant `epics/`. |
| `ai-flow list-skills` | Afficher les skills disponibles. |

Après `init`, le projet a des scripts plus faciles à retenir.
Si aucun `package.json` n'existait, Coding Flow en crée un minimal à la racine :

| Script local | Usage |
| --- | --- |
| `npm run flow:doctor` | Vérifier l'installation. |
| `npm run flow:check` | Lancer `doctor --strict` avec les checks harness rapides. |
| `npm run flow:skills` | Afficher les skills disponibles. |
| `npm run flow:status` | Lister les epics/stories. |
| `npm run flow:harness` | Lancer le check harness rapide. |
| `npm run flow:commands` | Afficher le pense-bête des commandes. |
| `npm run flow:uninstall` | Retirer Coding Flow du projet. |

Commandes utiles en CI :

```bash
npm run flow:doctor -- --json
npm run flow:harness -- --json
npm run flow:status -- --json
npm run flow:skills -- --json
```

## Désinstaller Coding Flow

Pour retirer Coding Flow d'un projet sans supprimer les epics et stories déjà créés :

```bash
npx github:LandryPouth/codin-flow uninstall
```

La commande supprime :

- les fichiers installés par Coding Flow (`AGENT_RULES.md`, `PROJECT_RULES.md`, `CLAUDE.md`, `docs/`, `.claude/skills/`, `.agents/skills/`, etc.) ;
- `.coding-flow/manifest.json`, `.coding-flow/harness.json`, `.coding-flow/COMMANDS.md` et les preuves harness dans `.coding-flow/runs/` ;
- les scripts `flow:*` ajoutés au `package.json` quand ils correspondent aux commandes générées par Coding Flow.
- le `package.json` minimal créé par Coding Flow, uniquement s'il n'a pas été enrichi par le projet.

La commande conserve toujours :

- `epics/` ;
- toutes les stories, tâches, décisions et notes générées dans les epics ;
- les scripts `flow:*` qui ont été modifiés manuellement.

Pour prévisualiser avant suppression :

```bash
npx github:LandryPouth/codin-flow uninstall --dry-run
```

Si certains fichiers Coding Flow ont été modifiés localement, ils sont conservés par défaut. Pour forcer leur suppression :

```bash
npx github:LandryPouth/codin-flow uninstall --force
```

## Harness De Sécurité

Le harness est une couche de preuves légère. Il ne remplace pas les skills de validation, mais il rend certains garde-fous vérifiables par le CLI.

Il répond à trois questions :

- **Est-ce que la story est risquée ?** `preflight` lit les fichiers de story et recommande `FAST`, `STANDARD` ou `STRICT`.
- **Est-ce que le repo contient des signaux dangereux ?** `check` cherche des secrets évidents, fichiers sensibles et preuves manquantes.
- **Est-ce que les tests passent vraiment ?** `verify` exécute les commandes de validation déclarées (config `validation.commands`, bloc `## Commands` de `tests.md`, ou scripts `package.json`), capture verbatim leurs codes de sortie dans `.coding-flow/runs/*-verify.json`, et échoue si l'une casse ou si aucune n'a tourné. La preuve est exécutée par la machine, pas affirmée par l'agent.
- **Qu'est-ce qui prouve que la story a été traitée correctement ?** `evidence` écrit un résumé JSON avec risque, fichiers changés, checks requis, résultat du harness et rollback notes.

Ce que le harness vérifie aujourd'hui :

- détection de secrets évidents ;
- détection de fichiers sensibles comme `.env`, clés privées ou credentials ;
- préflight de story pour choisir le bon niveau de rigueur ;
- vérification des notes de rollback et des preuves de validation sur les stories risquées ;
- journal JSON dans `.coding-flow/runs/` pour garder une trace exploitable en CI ou en review.

Ce que le harness ne fait pas :

- il ne sandboxe pas l'agent ;
- il n'intercepte pas toutes les commandes shell ;
- il ne remplace pas les tests, lint, typecheck ou reviews ;
- il ne garantit pas qu'une application est sécurisée.

Son rôle est plus modeste et plus utile : détecter les erreurs évidentes, rendre les workflows sensibles plus explicites, et laisser une preuve exploitable sans alourdir le quotidien.

Le workflow quotidien reste simple. `ai-flow init` crée la policy harness par défaut si elle n'existe pas, puis les skills `$run-story` et `$run-story-secure` appellent le harness automatiquement quand `ai-flow` est disponible. Les commandes `ai-flow harness ...` servent surtout au debug, à la CI ou aux vérifications ponctuelles.

Réinitialisation optionnelle dans un projet cible déjà installé :

```bash
ai-flow harness init
```

Exemples manuels :

```bash
ai-flow harness preflight --story epics/epic-01/story-01-01
ai-flow harness check --story epics/epic-01/story-01-01
ai-flow harness verify --story epics/epic-01/story-01-01
ai-flow harness evidence --story epics/epic-01/story-01-01
```

La testabilité niveau production (exécution non-maquillable, preuve négative,
discipline anti AI-slop) est détaillée dans `docs/plans/testability.md`. Le seam
de stockage, la config projet et la policy de branche : `docs/plans/storage-backends.md`.

## Couche Évidence & Gouvernance

Au-delà du scan, coding-flow transforme chaque garde-fou *conseillé* en garde-fou
*exécuté*, attaché à une **identité**, agrégé en un **registre exportable**, et
vérifié **hors de la main de l'agent**. C'est la réponse au vrai blocage de
l'adoption entreprise : la gouvernance, l'audit et la conformité — pas la qualité
du code. Détails et conception : `docs/plans/evidence-governance.md`.

- **`guard` — enforcement déterministe.** Un hook PreToolUse refuse l'écriture
  d'un `.env`, d'une clé, ou d'un contenu contenant un secret **avant** que ça
  n'atteigne le disque (exit 2). Un secret ne *peut* pas fuiter, on n'espère plus
  qu'il ne fuie pas. Câblé dans `.claude/settings.json` par `init`, il voyage
  aussi avec le plugin natif.
- **Provenance.** Chaque preuve `verify`/`evidence` embarque `provenance` : commit,
  branche, auteur git, état *dirty* — « asserted ≠ proven ; anonymous ≠ auditable ».
- **`audit` — registre append-only.** Agrège `.coding-flow/runs/*` en
  `.coding-flow/ledger.jsonl` (jamais réécrit). `--export` produit `docs/AUDIT.md`
  (l'artefact de conformité) ; `--check` est le gate « pas de merge sans dernière
  `verify` verte ».
- **`ship` attache la preuve.** Le résumé du dernier `verify` (résultat +
  provenance + table par commande) est injecté dans le corps de la PR, entre
  marqueurs idempotents — le reviewer voit « ça passe, prouvé » sans effort.
- **`trace` — bout en bout.** story → commits → PR → évidence → tests, en signalant
  chaque maillon manquant. « Prouve que cette exigence est livrée *et* vérifiée. »
- **`ci init` — gate clean-room.** Un workflow GitHub Actions rejoue `verify` +
  `audit --check` sur un checkout neuf : le signal non-jouable, sur compute gratuit.

```bash
ai-flow audit --export          # docs/AUDIT.md depuis le registre
ai-flow audit --check           # gate CI : dernière verify verte par story
ai-flow trace --story epics/epic-01/story-01-01
ai-flow ci init                 # workflow clean-room dans le projet
```

## Installer Comme Plugin Natif Claude Code

En plus du canal npm/`npx` (CLI + CI), coding-flow s'installe comme **plugin natif**
Claude Code — les skills et le hook `guard` arrivent sans `ai-flow init`, et se
mettent à jour via le marketplace (fin du re-ship manuel à chaque release) :

```text
/plugin marketplace add LandryPouth/codin-flow
/plugin install coding-flow
```

Les deux canaux coexistent : npm pour le CLI et la CI, le plugin pour l'intégration
IDE. Les skills du plugin (`skills/`) sont matérialisés depuis les templates par
`ai-flow plugin sync` et gardés sans dérive par `ai-flow plugin check` (vérifié en
test/CI).

## Développement Local Du Package

### Architecture Du CLI (`bin/`)

`bin/ai-flow.js` est un dispatcher mince : il parse les arguments et délègue à des
modules cohésifs dans `bin/lib/`. Aucune dépendance runtime.

| Module | Responsabilité |
| --- | --- |
| `lib/context.js` | Constantes partagées (racine, templates, cwd, scripts npm) |
| `lib/util.js` | Helpers génériques (I/O, hash, JSON, chemins, glob, marche de fichiers) |
| `lib/config.js` | Config projet `.coding-flow/config.json` (storage, branchPerEpic, validation) |
| `lib/templates.js` | Installation, manifeste, scripts, cheat-sheet, `upgrade` |
| `lib/harness.js` | Sécurité, scan secrets/fichiers sensibles, preflight/check/`verify`/evidence |
| `lib/identity.js` | Provenance git (commit, branche, auteur, dirty, PR) injectée dans chaque preuve |
| `lib/guard.js` | Hook PreToolUse déterministe (refus chemins bloqués / secrets avant écriture) |
| `lib/settings.js` | Fusion idempotente du hook `guard` dans `.claude/settings.json` |
| `lib/audit.js` | Registre append-only, export `docs/AUDIT.md`, gate `--check` |
| `lib/trace.js` | Chaîne story → commits → PR → évidence → tests |
| `lib/ci.js` | Scaffolder du workflow CI clean-room (`verify` + `audit`) |
| `lib/plugin.js` | Canal plugin natif : sync/check des skills vs templates |
| `lib/storage/` | Seam de stockage : `local` (défaut) et `github` (différé) |
| `lib/policy.js` | Policy « une epic = une branche, jamais main » |
| `lib/doctor.js` | Diagnostic + `--fix` |
| `lib/skills.js` | `list-skills` |
| `lib/status.js` | État des epics/stories (via le seam) + worktrees + policy |
| `lib/bootstrap.js` | Scan brownfield |
| `lib/uninstall.js` | Désinstallation préservant `epics/` |
| `lib/worktree.js` | Worktrees Git optionnels (travail parallèle) |
| `lib/ship.js` | `ship` : push de la branche courante + une PR, avec la preuve `verify` attachée |
| `lib/commands.js` | `help` et `commands` |

Le graphe de dépendances est acyclique : `context → util → config → harness →
templates → {doctor, uninstall, skills, commands}` ; `status` s'appuie sur
`config`/`storage`/`policy`/`worktree`.

### Documentation interne (`docs/`)

| Doc | Sujet |
| --- | --- |
| [`docs/sdd-vs-plugins.md`](docs/sdd-vs-plugins.md) | De l'ancien SDD au plugin + couche de gouvernance : ce qui a changé, pourquoi, et ce qui reste pour publier |
| [`docs/git-worktree-bare.md`](docs/git-worktree-bare.md) | Git worktree & bare : concept, partage `node_modules`/`.env`, quand ne pas l'utiliser |
| [`docs/plans/parallel-mode.md`](docs/plans/parallel-mode.md) | Mode parallèle (`worktree`), lien story, `ship` |
| [`docs/plans/storage-backends.md`](docs/plans/storage-backends.md) | Seam de stockage, config projet, policy de branche |
| [`docs/plans/evidence-governance.md`](docs/plans/evidence-governance.md) | Couche évidence & gouvernance : guard, provenance, audit, trace, CI, plugin |
| [`docs/plans/testability.md`](docs/plans/testability.md) | Testabilité niveau production : `verify`, preuve négative, anti-slop |
| [`docs/plans/testing-and-ci.md`](docs/plans/testing-and-ci.md) | Suite de tests et CI du package |

Depuis ce repository :

```bash
node bin/ai-flow.js init --dry-run
node bin/ai-flow.js list-skills
```

`doctor` vérifie une installation dans un projet cible. Pour tester `doctor`, utilisez plutôt un dossier temporaire.

Tester l'installation dans un dossier temporaire :

```bash
mkdir /tmp/coding-flow-test
cd /tmp/coding-flow-test
node /path/to/codin-flow/bin/ai-flow.js init --force
node /path/to/codin-flow/bin/ai-flow.js doctor
node /path/to/codin-flow/bin/ai-flow.js doctor --json
node /path/to/codin-flow/bin/ai-flow.js commands
node /path/to/codin-flow/bin/ai-flow.js harness check --quick
node /path/to/codin-flow/bin/ai-flow.js status
node /path/to/codin-flow/bin/ai-flow.js bootstrap --scan
```

Tester comme commande globale :

```bash
npm link
ai-flow init --dry-run
ai-flow doctor
ai-flow doctor --fix
ai-flow commands
ai-flow upgrade --dry-run
ai-flow harness check --quick
ai-flow status
ai-flow bootstrap --scan
ai-flow list-skills
```

## Distribution GitHub Via `npx`

La distribution officielle passe par GitHub via `npx`. L'utilisateur final n'a pas besoin de cloner ce repository :

```bash
npx github:LandryPouth/codin-flow init
npx github:LandryPouth/codin-flow doctor
```

Chaque appel `npx github:LandryPouth/codin-flow ...` récupère le package depuis GitHub et exécute le binaire déclaré dans `package.json`.

Après `init`, le projet peut utiliser les scripts locaux `npm run flow:*`.
Si le projet n'avait pas de `package.json`, Coding Flow en crée un minimal pour garder les commandes simples.
L'utilisateur n'a donc plus besoin de mémoriser la commande GitHub complète pour les actions courantes.

Pour travailler sur le package lui-même, clonez le repo et liez la commande localement :

```bash
gh repo clone LandryPouth/codin-flow
cd codin-flow
npm install
npm link
```

Pour mettre à jour cette installation locale de développement :

```bash
git pull
npm install
npm link
```

`npm pack --dry-run` reste utile pour vérifier ce qui serait embarqué dans une archive.

## Publication npm (optionnelle)

La distribution GitHub ci-dessus suffit à utiliser l'outil. Pour publier une
version épinglée et installable via `npx @landry_pouth/coding-flow`, le package est
prêt : nom scopé `@landry_pouth/coding-flow`, `publishConfig.access = public`, et un
garde-fou `prepublishOnly` qui lance la suite de tests avant toute publication.

```bash
npm login                 # une fois, sur le compte @landry_pouth
npm test                  # doit être vert (aussi exécuté par prepublishOnly)
npm publish               # publie @landry_pouth/coding-flow@<version>
```

> Le nom court `coding-flow` est déjà pris par un tiers sur npm ; le scope
> `@landry_pouth/*` garantit un nom libre et sans collision future.

Après publication, l'install devient `npx @landry_pouth/coding-flow init` (les
commandes `github:LandryPouth/codin-flow` restent valides en parallèle).

## Roadmap

- `ai-flow add-epic`
- `ai-flow add-story`
- meilleure fusion avec des docs existantes
- checks doctor plus stricts pour les références croisées entre skills
- support optionnel d'un format status plus strict dans les story files
