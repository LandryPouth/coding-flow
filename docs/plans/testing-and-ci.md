# Tests, CI et Hook Pre-Push

Ce document décrit le harnais de fiabilité ajouté à la CLI `ai-flow` : tests
automatisés, intégration continue et hook Git local. Il sert de référence pour
comprendre ce qui protège désormais le repo des utilisateurs contre une
régression des commandes qui écrivent sur le disque.

## Contexte

La CLI (`bin/ai-flow.js`, ~2400 lignes) modifie les fichiers du projet cible :
`init`, `upgrade`, `uninstall` et `doctor --fix` créent, mettent à jour ou
suppriment des fichiers. Avant ces ajouts, il n'existait **aucun test** ni
**aucune CI**. Un bug dans `upgrade` ou `uninstall` pouvait donc abîmer le repo
d'un utilisateur sans filet.

La contrainte de conception est restée la même que le reste du projet :
**zéro dépendance**. Tout repose sur des outils intégrés à Node (>= 18) et Git.

## Ce Qui A Été Ajouté

| Fichier | Rôle |
| --- | --- |
| `test/cli.test.js` | 10 tests de contrat de la CLI, via le runner `node:test`. |
| `package.json` (script `test`) | `npm test` lance `node --test`. |
| `.github/workflows/test.yml` | CI : lance `npm test` sur push `main` et PR, Node 18/20/22. |
| `.githooks/pre-push` | Hook Git : lance `npm test` avant chaque push, bloque si échec. |

Le dossier `test/` n'est pas dans le champ `files` du `package.json`, donc il
**n'est pas embarqué** dans le package distribué via `npx`. Les tests protègent
le développement sans alourdir l'installation côté utilisateur.

## Tests

Les tests sont behavioraux : ils lancent la vraie CLI dans un dossier temporaire
et vérifient le comportement observable (fichiers écrits, code de sortie), pas
les détails internes. C'est ce qui protège réellement le contrat des commandes.

Couverture actuelle :

- `init` installe la structure attendue et crée un `package.json` privé ;
- `init --dry-run` n'écrit aucun fichier ;
- `doctor` réussit sur une installation saine et échoue si un fichier requis
  manque ;
- `doctor --fix` restaure un fichier manquant ;
- `upgrade` est idempotent et **préserve les modifications locales** ;
- `init --force` réinstalle par-dessus les modifications locales ;
- `uninstall` retire les fichiers gérés mais **conserve `epics/`** ;
- `list-skills` liste les skills disponibles.

Lancer la suite :

```bash
npm test
```

## CI GitHub Actions

Le workflow `.github/workflows/test.yml` lance `npm test` :

- sur chaque `push` vers `main` ;
- sur chaque pull request ;
- en matrice Node `18.x`, `20.x`, `22.x`.

Aucune étape d'installation de dépendances n'est nécessaire (CLI zéro-dep).

Cette CI est importante parce que la distribution se fait via
`npx github:LandryPouth/codin-flow` : les utilisateurs tirent directement
`main`. Un push cassé casserait l'outil pour tout le monde. La CI est le filet
qui empêche cela.

> **Statut de mise en ligne** : la CI ne s'active qu'une fois le workflow
> **poussé sur GitHub**. Tant que les fichiers ne sont pas commités et poussés,
> elle n'existe pas côté serveur.

## Hook Pre-Push

`.githooks/pre-push` lance `npm test` avant chaque push et **annule le push** si
un test échoue. C'est le filet local, complémentaire de la CI.

Le hook est versionné (dossier `.githooks/`) pour être partageable avec
l'équipe, mais Git n'active pas ce dossier automatiquement. Chaque clone doit
l'activer **une fois** :

```bash
git config core.hooksPath .githooks
```

Pour pousser en urgence en sautant les tests :

```bash
git push --no-verify
```

## Activation Pour Un Nouveau Clone

Après avoir cloné le repo, un contributeur active le hook local avec :

```bash
git config core.hooksPath .githooks
```

La CI, elle, ne demande aucune activation : elle tourne dès que le workflow est
présent sur GitHub.

## Vérifications Effectuées

| Vérification | Résultat |
| --- | --- |
| Suite de tests complète | 10/10 pass |
| Hook quand les tests passent | exit 0, push autorisé |
| Hook quand un test échoue | exit 1, push bloqué |
| YAML de la CI | valide, matrice Node 18/20/22 |

## Prochaines Étapes Possibles

- Ajouter un badge de statut CI dans le `README.md`.
- Étendre la couverture aux commandes `bootstrap` et `harness`.
- Introduire des tags/releases pour permettre d'épingler une version stable
  (`npx github:LandryPouth/codin-flow#vX.Y.Z`) plutôt que de tirer `main`.
