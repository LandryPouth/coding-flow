# Seam de stockage, config projet et policy de branche

Ce document décrit trois ajouts liés à `ai-flow` :

1. un **seam de stockage** (les epics/stories passent par un backend pluggable) ;
2. une **config projet** `.coding-flow/config.json` qui retient les décisions ;
3. une **policy** « une epic = une branche, jamais sur main ».

## Pourquoi un seam, et pourquoi pas (encore) le backend GitHub

L'idée déclencheuse : stocker les epics/stories comme **issues / sub-issues
GitHub** au lieu de dossiers locaux, pour les équipes qui vivent dans GitHub. Le
choix se fait à l'install, **un seul backend actif à la fois** (local **ou**
github), jamais les deux — pas de synchro bidirectionnelle, pas de source de
vérité ambiguë.

Mais construire le backend GitHub **maintenant** serait un investissement
prématuré :

- il rend `gh` + réseau **obligatoires** à chaque `status`/`harness`/lecture de
  story (aujourd'hui offline et instantané) ;
- il fait perdre les propriétés qui font la valeur de l'outil : la story **dans
  le diff** de la PR, le `grep`, le versionnement de la spec avec le commit qui
  l'implémente ;
- les sub-issues passent par `gh api graphql` (pas de commande first-class),
  donc du code fragile à maintenir pour toujours ;
- le projet n'a pas encore d'utilisateurs : on paierait le coût sur une
  hypothèse de besoin, pas un besoin observé.

**Décision : on pose le seam maintenant (coût quasi nul), on diffère le backend
GitHub** jusqu'à ce qu'un vrai utilisateur le réclame. Le jour venu, il se
branche dans `bin/lib/storage/github.js` sans réécrire le reste de l'outil.

## Architecture

| Fichier | Rôle |
| --- | --- |
| `bin/lib/config.js` | Lit/écrit `.coding-flow/config.json` (defaults, validation, migration) |
| `bin/lib/storage/index.js` | `getStorage(cwd)` : choisit le backend selon la config |
| `bin/lib/storage/local.js` | Backend local (dossiers `epics/`), défaut — seule chose qui connaît le layout des stories |
| `bin/lib/storage/github.js` | Backend GitHub : **seam en place, `fail()` clair, implémentation différée** |
| `bin/lib/policy.js` | Évalue la policy `branchPerEpic` (pure lecture git, jamais bloquante) |

L'interface d'un backend est minimale et volontairement extensible :

```js
storage.listEpics() // -> [{ name, path, stories: [{ name, title, status, path }] }]
```

`status.js` consomme le backend pour le contenu des stories ; le **lien
worktree** et la **policy** restent la couche git, orthogonale au stockage.

## Config projet — `.coding-flow/config.json`

```json
{
  "version": 1,
  "storage": "local",
  "branchPerEpic": true
}
```

- Écrite par `init` (honore `--storage` et `--no-branch-per-epic`).
- `upgrade` la **crée si absente** (migration des projets installés avant le
  seam) sans jamais écraser un choix existant.
- JSON, pas YAML : le projet reste zéro-dépendance.
- Une config corrompue ou une valeur `storage` inconnue retombe proprement sur
  les défauts.

`init --storage github` est **refusé** aujourd'hui (message clair, aucune config
écrite) : on n'autorise pas un choix qui casserait `status`. Si on force
`storage: "github"` à la main, `status` échoue proprement — le seam est prouvé,
rien ne plante.

## Policy « une epic = une branche, jamais main »

`branchPerEpic` (défaut `true`) est une **décision retenue**, pas un mur codé en
dur : `status` la fait remonter (avertissement quand on est sur la branche de
base), elle ne bloque pas un repo qui committe légitimement sur main. Même esprit
que le garde-fou de `ship`. Désactivable via `init --no-branch-per-epic`.

En JSON, `status` expose :

```json
"policy": { "branchPerEpic": true, "branch": "main", "onBase": true }
```

## Tests

`test/config-storage.test.js` (8 tests, vraie CLI en dossiers temp) :

- `init` écrit la config (storage local, branchPerEpic true) ;
- `--no-branch-per-epic` désactive la policy ;
- `--storage github` est refusé et **n'écrit aucune config** ;
- `--storage <inconnu>` est refusé ;
- `status --json` expose `storage` et `policy` ;
- `storage: "github"` fait échouer `status` proprement (seam prouvé) ;
- sur la branche de base, `status` signale la policy (`onBase: true` + texte) ;
- `upgrade` crée la config pour un projet installé avant le seam.

## Ce qui est volontairement hors périmètre

- **Le backend GitHub lui-même** : mapping epic↔issue / story↔sub-issue via
  `gh api graphql`, à faire quand un vrai besoin existe.
- **Toute synchro local↔github** : exclue par conception (un seul backend actif).
