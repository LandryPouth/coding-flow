# Git worktree & bare clone

> Travailler sur plusieurs branches en parallèle dans des dossiers séparés qui partagent un seul historique Git

Cette fiche reprend et **enrichit** l'excellent article de Metal3d,
*« Git worktree like a boss »* (dev.to), pour ne pas dépendre de sa survie en
ligne. Elle ajoute ce que l'article ne couvre pas : convertir un dépôt existant,
partager `node_modules`/`.env` entre worktrees, le piège des monorepos pnpm, et
**quand ne PAS utiliser les worktrees**.

## Quand l'utiliser

Dès que tu dois avoir **plusieurs branches ouvertes en même temps**, chacune dans
son propre dossier de travail :

- un hotfix urgent pendant que tu es en plein milieu d'une grosse feature ;
- lancer une suite de tests longue dans un dossier pendant que tu codes dans un
  autre ;
- faire tourner **plusieurs agents IA en parallèle**, un par feature, sans qu'ils
  se marchent dessus.

Ne l'utilise **pas** pour du travail séquentiel/dépendant (voir la section finale).

## Le concept en une phrase

Un *worktree* = un dossier de travail supplémentaire rattaché au **même** dépôt
Git. Au lieu d'un seul checkout à la fois, tu as plusieurs branches checkoutées
simultanément dans des dossiers différents, qui partagent **un seul** `.git`
(historique, objets, hooks, config). Introduit dans Git 2.5.

### Worktree vs branche vs clone

| | Branche | Worktree | Clone multiple |
|---|---|---|---|
| Fichiers isolés sur le disque | ❌ (un seul working tree) | ✅ (un dossier par branche) | ✅ |
| Historique `.git` partagé | ✅ | ✅ (un seul) | ❌ (dupliqué) |
| Coût disque d'un 2ᵉ workspace | — | poids des fichiers seuls | tout le `.git` en double |
| `fetch` dans A visible dans B | — | ✅ instantané | ❌ |
| Hooks/config partagés | — | ✅ | ❌ (à reconfigurer) |
| Garde-fou anti double-checkout | — | ✅ Git refuse | ❌ |

Le worktree, c'est « un cerveau, plusieurs corps ». Le multi-clone, ce sont des
silos isolés.

## La mauvaise façon (courante)

```bash
# depuis un dépôt déjà cloné
git worktree add ../ma-feature
```

Ça marche, et c'est acceptable pour un besoin ponctuel. Mais ça éparpille des
dossiers frères et le dossier « principal » reste un checkout privilégié. Pour un
usage régulier, préfère le layout *bare* ci-dessous.

## La bonne façon : le layout « bare »

L'idée : le dossier racine ne contient **pas** de code, seulement l'historique
caché dans `.bare`, et chaque branche est un sous-dossier (worktree).

```bash
mkdir mon-projet && cd mon-projet

# 1. Cloner l'historique seul (pas de working tree) dans un dossier caché
git clone --bare git@github.com:user/repo.git .bare

# 2. Dire au dossier racine où se trouve l'historique
echo "gitdir: ./.bare" > .git

# 3. Corriger le refspec : sans ça, un bare clone ne "voit" que la branche par défaut
git config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"

# 4. Récupérer toutes les branches distantes
git fetch --all

# 5. Créer les worktrees
git worktree add main
git worktree add feature/paiement
```

Résultat :

```
mon-projet/
├── .bare/            # l'unique historique Git (objects, refs, hooks, config)
├── .git             # fichier texte : "gitdir: ./.bare"
├── main/            # worktree de la branche main
└── feature/
    └── paiement/    # worktree de la branche feature/paiement
```

Le fichier `.git` d'une ligne est la « colle » : il fait croire au terminal que
la racine est un dépôt, sans y mettre de working tree. Tu peux ainsi lancer les
commandes `git worktree` depuis la racine.

### Le piège du « bare clone aveugle »

Après un `git clone --bare`, Git suppose que tu veux un miroir/backup, pas un
espace de travail. Il **ne configure pas le suivi des branches distantes** : un
`git fetch` ne ramène que la branche par défaut. Symptôme :

```
$ git fetch
 * branch            HEAD       -> FETCH_HEAD      # et rien d'autre
```

Le correctif est l'étape 3 ci-dessus (le refspec `+refs/heads/*:...`). Après ça,
`git fetch --all` voit toutes les branches de l'équipe.

## Syntaxe complète de `worktree add`

```bash
git worktree add <dossier> [-b <nouvelle-branche>] [<ref-de-depart>]
```

Exemples :

```bash
# nouvelle branche feat/fix-db partant de feature/improve-db
git worktree add improve-db -b feat/fix-db feature/improve-db

# les slashs créent des sous-dossiers : features/A -> dossier features/A + branche features/A
git worktree add features/A
```

## Les pièges à connaître

- **`rm -rf` ne suffit pas** à supprimer un worktree : Git garde la référence.
  Un futur `git worktree add` échouera (« already exists »). Correctif :
  ```bash
  git worktree list      # repère les entrées "prunable"
  git worktree prune     # nettoie les références orphelines
  ```
  (Aucun risque : `prune` ne touche jamais aux branches distantes.)
- **Protéger un worktree** contre le prune : `git worktree lock` / `unlock`.
- **Double checkout interdit** : Git refuse de checkouter la même branche dans
  deux worktrees. C'est une protection, pas un bug.

---

## Enrichissements (hors article)

### Convertir un dépôt NORMAL existant en layout bare

L'article part d'un dossier vide. Mais on peut convertir un clone classique en
layout worktree **sans re-cloner** — c'est de la plomberie Git, **O(1),
indépendante de la taille du code** (10 Mo ou 10 Go : même durée) :

```bash
cd mon-repo-normal          # contient un .git/ classique
mv .git .bare               # l'historique devient le bare
git --git-dir=.bare config core.bare true
echo "gitdir: ./.bare" > .git
git --git-dir=.bare config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
# déplace éventuellement ton code courant dans un worktree main/
git worktree add main <branche-courante>
```

**Conséquence importante** : puisque la conversion est instantanée à la demande,
l'argument « fais-le tôt pour être future-proof » est faible. Tu peux basculer
n'importe quel repo en mode worktree le jour où tu en as besoin. Par défaut,
garde un repo standard : le layout bare a un coût quotidien (voir plus bas).

### Partager `node_modules` et `.env` entre worktrees

**L'article n'en parle pas, et c'est le vrai point de friction.** Chaque worktree
est un working tree neuf. Les fichiers **versionnés** (code, `CLAUDE.md`, configs
commitées) apparaissent tout seuls. Mais les fichiers **non versionnés**
(`node_modules`, `.env`, `.env.local`) sont **absents** de chaque nouveau
worktree.

Deux stratégies selon le fichier :

- **`.env` / `.env.local`** → symlink. Petits, non versionnés, on veut les mêmes
  secrets partout.
  ```bash
  ln -s ../../mon-repo/.env feature/paiement/.env
  ```
- **`node_modules`** → **dépend du gestionnaire de paquets** :
  - **projet simple (npm)** : un symlink de `node_modules` suffit et évite une
    réinstallation.
  - **monorepo pnpm / yarn workspaces** : **NE PAS symlinker**. pnpm range un
    virtual store `.pnpm` lié à la racine du workspace ; un symlink global le
    corrompt. Lance plutôt `pnpm install` dans le worktree — c'est rapide
    (hard-links depuis le store global, zéro re-téléchargement).

> ⚠️ Les fichiers partagés doivent être **gitignorés** (`.env`, `node_modules`
> le sont presque toujours). Sinon les symlinks apparaissent comme fichiers non
> suivis et polluent `git status`.

### Quand NE PAS utiliser les worktrees

Le worktree résout l'**isolation mécanique**, jamais la **parallélisabilité du
travail**. Il n'aide pas si :

- **Tes changements sont séquentiels / dépendants** (une « liste de changements
  successifs » : chaque étape dépend de la précédente). Les brancher en parallèle
  = rebases et conflits permanents. Déroule-les une étape à la fois.
- **Les features touchent les mêmes fichiers.** Trois branches sur le même
  `service.ts` = merge hell.
- **La revue est le goulot.** Avec des agents IA qui produisent vite, le plafond
  n'est plus le clavier mais **tes yeux**. Paralléliser du code critique
  (paiement, KYC) que tu ne peux pas relire à temps est dangereux. Le worktree
  protège l'état Git, pas la cohérence sémantique entre branches.

Bon cas d'usage : des features **réellement indépendantes** (zones de code
disjointes), sur un **socle stable**, avec une **capacité de revue** suffisante.

### Le coût quotidien du bare-par-défaut

Ne mets pas *tous* tes repos en bare « au cas où ». Tu paierais 100 % du temps
pour un besoin qui arrive rarement :

- ton code n'est plus dans `repo/` mais dans `repo/main/` → chemins en dur,
  volumes `docker-compose`, workspaces IDE, CI à ajuster ;
- `node_modules`/`.env` non partagés → rituel symlink permanent, même en solo ;
- friction d'onboarding : un collègue découvre un `.bare` et un `.git` bizarre.

## Cheat-sheet

```bash
# Setup pro (dossier vide)
git clone --bare <url> .bare
echo "gitdir: ./.bare" > .git
git config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
git fetch --all
git worktree add main

# Vie quotidienne
git worktree add ../hotfix -b hotfix/bug main   # nouveau worktree + branche
git worktree list                               # lister (repérer les prunable)
git worktree remove <dossier>                   # retirer (garde la branche !)
git worktree prune                              # nettoyer les refs orphelines
git worktree lock/unlock <dossier>              # protéger du prune
```

## Automatisation

L'outil [`coding-flow`](https://github.com/LandryPouth/codin-flow) fournit
`ai-flow worktree add|list|remove` : il crée le worktree, symlinke `.env`,
détecte pnpm/npm pour choisir install vs symlink de `node_modules`, et conserve
la branche au `remove`. Voir la doc projet `docs/plans/parallel-mode.md`.

## Script d'init (à mettre dans `~/.local/bin/wtree`, `chmod +x`)

```bash
#!/bin/bash
# Usage: wtree <git url>  (dans un dossier VIDE)
set -euo pipefail
REPO_URL="${1:?Usage: wtree <repo-url>}"
[ -z "$(ls -A | grep -v "$(basename "$0")")" ] || { echo "❌ Dossier non vide"; exit 1; }
git clone --bare "$REPO_URL" .bare
echo "gitdir: ./.bare" > .git
git config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
git fetch --all
echo "✅ Prêt. Étape suivante : git worktree add main"
```

---

*Source d'origine : Metal3d, « Git worktree like a boss », dev.to. Sections
« Enrichissements » ajoutées ici.*
