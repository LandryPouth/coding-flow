# Mode parallèle — `ai-flow worktree`

Ce document décrit le support **optionnel** des worktrees Git ajouté à la CLI
`ai-flow`, pour développer plusieurs features en parallèle (un dossier par
branche) sans quitter le zéro-dépendance du projet.

Pour comprendre les worktrees et le layout *bare* en profondeur (concept,
pièges, conversion d'un repo existant), voir la fiche générale
`~/.claude/docs/git-worktree-bare.md`.

## Pourquoi c'est opt-in, et pas dans `init`

Le worktree agit sur le **dépôt Git**, pas sur la méthodologie coding-flow. Le
rendre obligatoire dénaturerait l'outil et imposerait un layout lourd à tout le
monde, alors que la plupart des epics sont **séquentiels**. Donc :

- `init` reste un dépôt standard — aucun collègue ni outil n'est surpris.
- Le worktree est une **capacité en plus**, activée à la demande, sur les
  features réellement indépendantes.

## Commandes

| Commande | Effet |
| --- | --- |
| `ai-flow worktree add <nom> [--from <ref>] [--deps install\|link\|skip] [--story <dir>] [--dry-run]` | Crée le worktree + la branche, câble `.env` et les dépendances |
| `ai-flow worktree list` | Liste les worktrees, leur branche et l'état des liens `.env` |
| `ai-flow worktree remove <nom> [--force] [--dry-run]` | Retire le worktree, **conserve la branche** |

### `add`

- Emplacement **groupé** : `../<repo>-worktrees/<nom>` (garde le dossier parent
  propre au lieu d'éparpiller des siblings).
- Crée la branche `<nom>` depuis `HEAD` (ou `--from <ref>`). Si la branche existe
  déjà, elle est réutilisée.
- Symlinke `.env` / `.env.local` s'ils existent à la racine (aucune copie).
- Gère `node_modules` selon la **stratégie de dépendances** (ci-dessous).
- `--dry-run` affiche le plan sans rien écrire.

### Lien worktree ↔ story (`--story`)

- `add --story epics/<epic>/story-<nn>-<mm>-<slug>` nomme la branche/worktree
  d'après le **dossier de la story** au lieu d'un nom arbitraire.
- La correspondance est **sans état** : `ai-flow status` relie une story à son
  worktree quand le nom de branche est égal au nom du dossier de la story. Aucun
  fichier de mapping à maintenir, rien à resynchroniser.
- `--story` valide que le dossier existe dans le dépôt et suggère le
  `harness preflight --story <dir>` correspondant, ce qui referme la boucle
  worktree → story → harnais.
- Conflit `<nom>` + `--story` avec des noms différents ⇒ erreur explicite (on
  choisit l'un ou l'autre).

`ai-flow status` affiche désormais, en plus des epics/stories, le worktree lié à
chaque story (`→ wt: ...`) et une section « Worktrees (hors story) » pour les
branches libres : un tableau de bord du travail parallèle en cours. En JSON, le
bloc `worktrees` expose `active` (dans un dépôt git ou non) et `loose`.

### `remove`

- `git worktree remove` **conserve la branche** : aucun commit n'est perdu. Le
  seul risque réel est le travail **non commité**.
- Refuse donc si le working tree est sale, **sauf `--force`**. Nos propres liens
  (`.env`, `node_modules`) sont exclus de ce contrôle et retirés avant la
  suppression, pour ne pas bloquer inutilement.
- Fait le `git worktree prune` derrière (le piège classique de l'article).
- Rappelle comment supprimer la branche (`git branch -D <nom>`) si voulu.

## Stratégie de dépendances

Symlinker `node_modules` est sûr pour un projet simple mais **casse un monorepo
pnpm/yarn** (le virtual store `.pnpm` est lié à la racine du workspace). La CLI
détecte le contexte et choisit :

| Contexte détecté | Défaut | Raison |
| --- | --- | --- |
| pnpm, yarn, ou workspace | recommande `install` (n'exécute pas) | symlink dangereux |
| npm simple avec `node_modules` présent | `link` (symlink) | rapide et sûr |
| pas de `node_modules` | recommande `install` | rien à lier |

Override manuel : `--deps install` (lance le package manager dans le worktree),
`--deps link` (force le symlink), `--deps skip` (ne touche pas aux deps).

`.env` / `.env.local` sont **toujours** symlinkés : petits, non versionnés, on
veut les mêmes secrets partout.

## Fichiers ajoutés

| Fichier | Rôle |
| --- | --- |
| `bin/lib/worktree.js` | Implémentation (zéro-dep, shell-out vers `git`) + `collectWorktrees` non-fatal + `--story` |
| `bin/lib/status.js` | Lit les worktrees et relie chaque story à sa branche |
| `bin/ai-flow.js` | Branchement du dispatcher + aide |
| `test/worktree.test.js` | 8 tests de contrat (vrai dépôt git en temp) |
| `test/status.test.js` | 5 tests du lien worktree ↔ story |

Le module vit sous `bin/` pour rester dans le champ `files` du `package.json`,
donc embarqué par `npx`. `test/` n'y est pas : les tests protègent le dev sans
alourdir l'install.

## Tests

Comportementaux : on monte un vrai dépôt git jetable, on lance la CLI, on vérifie
ce qui est observable (dossiers, symlinks, branches conservées, codes de sortie).

- `add` crée le dossier + une nouvelle branche checkoutée ;
- `add` symlinke `.env` présent à la racine ;
- `add --deps link` symlinke `node_modules` ;
- `add --dry-run` n'écrit rien ;
- `list` montre le worktree ajouté ;
- `remove` retire le worktree mais **conserve la branche** ;
- `remove` réussit malgré nos propres symlinks `.env` (régression) ;
- `remove` refuse un worktree sale sans `--force`.

```bash
npm test
```

## Ce qui est volontairement hors périmètre

- **La conversion en layout `.bare`** n'est pas automatisée. C'est le geste le
  plus invasif (il déplace le code de `repo/` vers `repo/main/` et casse
  chemins/docker/IDE), et il est O(1) à la demande. Il est documenté dans la
  fiche générale, à faire manuellement quand le besoin est réel.

## Prochaines étapes possibles

- `ai-flow worktree convert` (opt-in explicite, très gardé) pour le layout bare.
- Rendre la liste des fichiers partagés configurable via `.coding-flow/`.
- Support Windows testé (jonctions déjà gérées pour les dossiers).
