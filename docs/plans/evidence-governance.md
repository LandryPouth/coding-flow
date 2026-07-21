# La couche évidence & gouvernance

> Plan d'implémentation des 7 modifs qui font passer coding-flow de « méthodo IA »
> à **couche de preuve et de gouvernance** — le seul terrain non commoditisé par
> les plugins natifs / marketplaces, et celui qui débloque l'adoption entreprise
> (88 % des pilotes IA n'atteignent jamais la prod à cause de gouvernance / audit
> / compliance, pas de la qualité du code).

## Thèse

Ce que l'agent affirme (« ça marche », « pas de secret », « scope respecté ») ne
vaut rien en revue. Ce que **la machine prouve** vaut tout. Les 7 modifs
transforment chaque garde-fou *conseillé* en garde-fou *exécuté*, attaché à une
**identité humaine**, agrégé en un **registre exportable**, et vérifié **hors de
la main de l'agent** (CI clean-room). Le tout distribué comme **plugin natif**
pour ne pas subir le tapis roulant du re-ship à chaque release.

Principe directeur unique : *« nothing executed ≠ verified ; asserted ≠ proven ;
anonymous ≠ auditable »*.

## Contraintes non négociables (héritées du projet)

- **Zéro dépendance runtime.** Tout en `node:*` (`child_process`, `fs`, `crypto`).
  Aucune lib npm ajoutée. `git`/`gh` restent des dépendances *optionnelles*
  shell-out (dégradation propre si absentes).
- **Rien n'est bloquant par surprise.** Un garde-fou dur (le hook) n'est actif que
  s'il est explicitement câblé dans les settings du projet cible ; par défaut on
  *signale*, on ne casse pas un repo légitime.
- **Idempotence + `--dry-run` partout.** Aucune commande n'a d'effet de bord
  sortant caché (pattern `ship`).
- **Tests comportementaux** en `node:test` sur de vrais dépôts git jetables
  (`mktemp -d`), on vérifie l'observable (exit codes, fichiers, contenu), jamais
  le raisonnement. Suppression de fichiers via `trash`, jamais `rm`.
- **L'évidence est la vérité, pas le récit.** Capture verbatim, tronquée mais
  jamais reformulée.

## Ordre d'implémentation (dépendances)

```
1. identity  ─┬─> 2. guard (hook)         (enforcement dur)
              ├─> 3. ship attache l'évidence   (dépend de 1)
              ├─> 4. ledger (registre)          (dépend de 1)
              │        └─> 5. trace (bout en bout)  (dépend de 1 + 4)
              ├─> 6. CI clean-room gate          (quasi indépendant)
              └─> 7. plugin natif                (indépendant, distribution)
```

Chaque module est **validé (tests verts + smoke)** et **committé** avant de passer
au suivant. On coupe entre deux modules si le contexte est saturé — l'état est
repris via la checklist en fin de doc.

---

## Module 1 — Provenance : identité git sur chaque évidence

**Intent.** Aujourd'hui `verify`/`evidence` produisent un JSON anonyme. On ne peut
pas répondre « qui a produit cette preuve, sur quel commit, dans quelle PR ». Sans
ça, pas d'audit, pas d'offboarding, pas de conformité (EU AI Act art. 12
« record-keeping », traçabilité des systèmes IA).

**Design.** Nouveau module pur-lecture `bin/lib/identity.js` :

```js
// captureIdentity(cwd) -> non-fatal hors git
{
  capturedAt: "2026-07-21T...Z",
  git: {
    commit: "<sha>",          // git rev-parse HEAD
    shortCommit: "<sha7>",
    branch: "<abbrev-ref>",
    author: { name, email }, // git config user.name/email (ou log -1)
    dirty: true|false,        // status --porcelain non vide
    remote: "<origin url>",   // get-url origin (optionnel)
  },
  pr: { number, url } | null,  // via gh pr view --json (optionnel, best-effort)
  host: { user, platform },    // os.userInfo().username, process.platform
}
```

- Tout est **best-effort** : hors dépôt git → `git: null` + `reason`. `gh` absent
  → `pr: null`. Jamais fatal : la provenance enrichit, ne bloque pas.
- Injecté dans le JSON de `harnessVerify` et `harnessEvidence` sous une clé
  `provenance`. Rétro-compatible (ajout de clé, aucun retrait).

**Fichiers.** `bin/lib/identity.js` (nouveau) ; `bin/lib/harness.js` (import +
`provenance: captureIdentity(cwd)` dans les deux évidences) ;
`test/identity.test.js` (nouveau).

**Tests.** dépôt git temp avec `user.name/email` configurés → `provenance.git`
peuplé, `dirty` bascule quand on touche un fichier ; hors git → `git:null`
non-fatal ; `verify --json` contient désormais `provenance`.

**Plus-value pour la suite.** Socle de 3, 4, 5. Le ledger agrège la provenance ; la
PR l'affiche ; le trace la suit. À faire **en premier** : tout le reste en dépend.

---

## Module 2 — `ai-flow guard` : le hook PreToolUse déterministe

**Intent.** `harness check` scanne *après coup*. Le seul moment non contournable
pour empêcher l'écriture d'un `.env`, le commit d'un secret ou l'édition hors
scope, c'est **avant** que l'outil n'écrive. Claude Code expose un hook
**PreToolUse** qui reçoit l'appel d'outil sur stdin et peut le **refuser** (exit 2
/ décision `deny`). C'est le passage de « conseil » à « garde-fou en code » — le
levier unique le plus fort de tout le plan.

**Design.** Sous-commande `ai-flow guard` (lecteur de hook, pas d'UI humaine) :

1. Lit le JSON du hook sur **stdin** (`{ tool_name, tool_input: { file_path,
   content, new_string, ... } }`). Format tolérant : si stdin vide ou illisible →
   `allow` (fail-open pour ne jamais bloquer un usage non-hook).
2. Ne se déclenche que pour les outils d'écriture (`Write`, `Edit`, `MultiEdit`,
   `NotebookEdit`). Autres outils → `allow`.
3. Charge `.coding-flow/harness.json` (via `readHarnessConfig`) et applique
   **deux** contrôles déterministes :
   - **chemin bloqué** : `file_path` relatif matche un `blockedPaths` (réutilise
     `matchesPattern`, exclut `isAllowedEnvExample`) → **deny**.
   - **secret dans le contenu** : le contenu écrit (`content`/`new_string`) matche
     un `getSecretPatterns()` → **deny**.
4. Émet la **décision** au format hook attendu par Claude Code (JSON sur stdout
   avec `hookSpecificOutput.permissionDecision = "deny"` + `reason`, ou exit code
   2 + message stderr — on gère les deux voies, la plus portable étant l'exit
   code). `allow` = exit 0 silencieux.
5. `--explain` (humain) et `--json` pour debug/tests ; un flag d'entrée
   `--input <file>` pour tester sans passer par stdin réel.

**Câblage côté projet cible.** Template `templates/.claude/settings.json` (ou
fusion dans l'existant à l'`init`) avec un bloc `hooks.PreToolUse` matcher
`Write|Edit|MultiEdit` → `command: "npx @landry_pouth/coding-flow guard"` (ou le
binaire local détecté). L'`init` **propose** le câblage ; ne l'impose pas si un
`settings.json` existe déjà (merge non destructif, sinon on affiche l'instruction).

**Fichiers.** `bin/lib/guard.js` (nouveau) ; export `getSecretPatterns` depuis
`harness.js` (réutilisation) ; `bin/ai-flow.js` (dispatch `guard`) ;
`bin/lib/commands.js` (aide) ; template settings + wiring dans `templates.js`/`init` ;
`test/guard.test.js`.

**Tests.** deny sur `.env`/`**/*.pem` ; deny sur contenu avec `sk_live_...` ;
allow sur fichier normal ; allow si stdin vide (fail-open) ; allow si outil non
écrivain ; `.env.example` autorisé ; exit code correct (0 allow / 2 deny).

**Plus-value.** C'est *la preuve* qu'un secret ne **peut** pas fuiter, pas qu'on
espère qu'il ne fuitera pas. Argument de vente entreprise n°1 (« secret isolation
enforced at the tool boundary »). Réutilisable hors coding-flow (n'importe quel
projet Claude Code peut câbler le guard).

---

## Module 3 — `ship` attache l'évidence à la PR

**Intent.** Le reviewer humain doit voir « ça passe, prouvé » sans effort. On
injecte le résumé du dernier `verify` (+ provenance) dans le corps de la PR.

**Design.** Dans `ship.js`, avant création/màj de PR :

- lire le plus récent `.coding-flow/runs/*-verify.json` (best-effort) ;
- construire un bloc markdown délimité par des marqueurs idempotents
  `<!-- coding-flow:evidence:start -->` … `:end -->` :
  résultat global (✅/❌), source des commandes, liste `command → exit/durée`,
  provenance (commit court, auteur, dirty), horodatage ;
- **création** : passer ce bloc en `--body` (au lieu de `--fill` seul : on garde
  le titre dérivé mais on ajoute le corps ; option `--no-evidence` pour désactiver) ;
- **PR existante** : `gh pr view --json body`, remplacer la section entre marqueurs
  (ou l'ajouter), `gh pr edit --body`. Jamais on n'écrase le texte humain hors
  marqueurs.
- Sans `verify` disponible → note « aucune évidence : lance `ai-flow harness verify` ».
- `--dry-run` affiche le bloc sans pousser.

**Fichiers.** `bin/lib/ship.js` (lecture évidence + injection section) ;
`test/ship.test.js` (étendre : bloc présent dans le body ; idempotence du
remplacement ; `--no-evidence`).

**Plus-value.** Zéro friction : la preuve arrive là où la décision se prend (la
PR). Boucle intention → preuve fermée et visible. Rend le module 4 (ledger)
« gratuit » côté humain.

---

## Module 4 — `ai-flow audit` : le registre exportable (append-only)

**Intent.** Le document qu'on montre à la compliance : « voici, horodaté et signé
par identité, tout ce qui a été vérifié sur ce dépôt ». Agrège les runs épars en
un journal durable.

**Design.** Nouveau `bin/lib/audit.js` + commande `ai-flow audit` :

- **Source** : tous les `.coding-flow/runs/*-verify.json` et `*-evidence.json`.
- **Ledger append-only** : `.coding-flow/ledger.jsonl` — une ligne JSON par run,
  jamais réécrite. Chaque entrée : `{ id (hash contenu), type, generatedAt,
  ok, story, commandSource, provenance, summary }`. `audit` **ajoute** les runs
  pas encore présents (dédup par `id` = `sha256` du fichier). Append-only =
  garantie d'intégrité (on n'efface pas l'historique).
- **Export humain** : `ai-flow audit --export` écrit `docs/AUDIT.md` (tableau
  chronologique : date, type, résultat, story, commit, auteur). `--json` sort le
  ledger complet ; `--since <iso>` filtre.
- **Gate** : `ai-flow audit --check` sort non-zéro si le dernier run par story est
  en échec ou manquant (utilisable en CI pour « pas de merge sans évidence verte »).

**Fichiers.** `bin/lib/audit.js` (nouveau) ; `bin/ai-flow.js` (dispatch) ;
`commands.js` (aide) ; `test/audit.test.js`.

**Tests.** ledger créé et dédupliqué (2 passes → pas de doublon) ; append préserve
les anciennes lignes ; `--export` génère `docs/AUDIT.md` avec les colonnes ;
`--check` échoue si un run est rouge ; `--since` filtre.

**Plus-value.** Transforme des JSON épars en **artefact de conformité**. C'est la
brique « facturable » (couche gouvernance) sans rien enlever à l'open-core.

---

## Module 5 — `ai-flow trace` : la chaîne story ↔ commit ↔ PR ↔ évidence ↔ test

**Intent.** Prouver la chaîne complète : cette story a produit ces commits, dans
cette PR, dont l'évidence verte cite ces tests. Réponse d'un seul coup à « montre-
moi que cette exigence est réellement livrée et vérifiée ».

**Design.** Nouveau `bin/lib/trace.js` + `ai-flow trace [--story <dir>] [--json]` :

- **story → tests** : parse la table de traçabilité `critère -> file::test` de
  `tests.md` (déjà générée par blueprint-tests) + le bloc `## Commands`.
- **story → commits** : `git log` filtré sur le dossier de la story
  (`-- <storyDir>`) et/ou sur le nom de branche liée (réutilise la correspondance
  worktree↔story sans état de `status`).
- **story → PR** : `gh pr view <branch>` (best-effort).
- **story → évidence** : dernier run du ledger dont `story` matche.
- **Sortie** : un arbre lisible (texte) + JSON structuré ; signale les **maillons
  manquants** (pas d'évidence, pas de test pour un critère, commits sans PR).

**Fichiers.** `bin/lib/trace.js` (nouveau) ; réutilise `identity`, `audit`,
`parseTestsCommands`, la table de traçabilité ; `bin/ai-flow.js` + `commands.js` ;
`test/trace.test.js`.

**Tests.** dépôt temp avec une story (tests.md + traçabilité), un commit touchant
le dossier, un run d'évidence → `trace` relie les 4 ; maillon manquant signalé
(critère sans test, story sans évidence).

**Plus-value.** L'« audit d'une exigence » en une commande. Différenciateur fort
vs Spec Kit / BMAD (eux spécifient, ils ne **prouvent** pas la livraison).

---

## Module 6 — CI clean-room gate + plancher de diff-coverage

**Intent.** Le seul signal non-jouable : rejouer `verify` sur un checkout neuf,
hors de la main de l'agent (compute GitHub gratuit, budget Claude préservé). +
exiger que le **code changé** soit couvert (diff-coverage), pas la couverture
globale gonflable.

**Design.** Template de workflow scaffané dans le projet **cible** (pas la CI de
coding-flow lui-même) via `ai-flow ci init` (ou une étape d'`init --with-ci`) :

- `templates/.github/workflows/coding-flow-verify.yml` : checkout propre →
  `npx @landry_pouth/coding-flow harness verify` → `harness audit --check` →
  upload des `.coding-flow/runs/*` en artefact. Job non-bloquant configurable.
- **Diff-coverage** : optionnel, activé si un rapport de couverture existe ;
  compare aux lignes du diff (`git diff --name-only origin/base...HEAD`).
  V1 : plancher simple documenté ; l'outil fournit le hook, pas un runner de
  couverture maison (hors périmètre, cf. testability.md).
- `ai-flow ci init` copie le template, non destructif, `--dry-run`.

**Fichiers.** `templates/.github/workflows/coding-flow-verify.yml` (nouveau) ;
`bin/lib/ci.js` (nouveau, scaffolder) ; dispatch + aide ; `test/ci.test.js`
(le scaffold écrit le fichier, idempotent, `--dry-run` n'écrit rien).

**Plus-value.** Le gate lourd porté par la CI (gratuit) au lieu de re-tokens
Claude : trust ↑, budget ↓. « Preuve reproductible sur machine neutre » =
l'argument qui fait passer un pilote en prod.

---

## Module 7 — Distribution : plugin natif Claude Code + marketplace

**Intent.** Ne pas subir le tapis roulant « re-ship les skills à chaque release ».
Les plugins natifs + marketplaces (2026) sont le canal de distribution ; coding-flow
doit s'y installer en une commande et se mettre à jour tout seul.

**Design.**
- `.claude-plugin/plugin.json` : manifeste (name, version, description, author,
  commands/skills exposés, homepage). Pointant vers `templates/.claude/skills` et
  les commandes CLI.
- Manifeste de **marketplace** (`marketplace.json` ou dépôt dédié) listant le
  plugin, pour `/plugin marketplace add LandryPouth/codin-flow`.
- Doc d'install plugin dans le README ; la version npm reste (les deux canaux
  coexistent : npm pour le CLI/CI, plugin pour l'IDE).
- Vérifier la conformité au schéma plugin courant via `ctx7`/docs Claude Code
  avant de figer les clés.

**Fichiers.** `.claude-plugin/plugin.json` (nouveau) ; `marketplace.json` (nouveau) ;
README section « Installer comme plugin » ; éventuel `test/plugin.test.js` (le
manifeste est un JSON valide, versions synchronisées avec package.json).

**Plus-value.** Adoption sans friction + mises à jour continues sans re-ship
manuel. Canal de découverte (marketplace) = distribution quasi-gratuite.

---

## Après les 7 modules

- **README + docs internes** à jour (chaque module met à jour la table CLI, la
  section correspondante, et son entrée dans l'index `docs/`).
- **Suite de tests** : cible +30 tests (~86 total), tous verts sur node 18/20/22.
- **Version** : bump `package.json` (0.1.0 → 0.2.0, changements additifs mais
  surface CLI élargie) + note de version.
- **Publication npm** `@landry_pouth/coding-flow` (auth à finaliser côté user :
  `npm login --auth-type=legacy` ou token `_authToken`).

## Checklist de reprise (état vivant)

- [ ] M1 identity — module + provenance dans verify/evidence + tests verts + commit
- [ ] M2 guard — hook + settings template + wiring init + tests + commit
- [ ] M3 ship évidence — injection PR idempotente + tests + commit
- [ ] M4 audit ledger — append-only + export + --check + tests + commit
- [ ] M5 trace — chaîne story↔commit↔PR↔évidence↔test + tests + commit
- [ ] M6 CI clean-room — template workflow + scaffolder + tests + commit
- [ ] M7 plugin — manifeste + marketplace + README + commit
- [ ] Docs/README finaux + bump version + publication npm

> Règle de reprise : ne jamais démarrer un module sans que le précédent soit
> **vert + committé**. Si le contexte sature, s'arrêter sur un module committé et
> laisser la checklist indiquer le point de reprise.
