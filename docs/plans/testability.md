# Testabilité niveau production (anti AI-slop)

Objectif : que « ça marche » ne soit plus une **affirmation de l'agent** mais une
**évidence reproductible, prouvée négativement, et exécutée hors de sa main**. Ce
document décrit les trois leviers ajoutés et pourquoi.

## Le problème spécifique aux workflows IA

Dans un projet classique, la CI verte est fiable parce que les tests sont une
spécification **indépendante** de l'intention, écrite par un humain. Ici, la même
IA écrit le code **et** les tests. Un vert sur des tests écrits par l'agent qui a
écrit le code ne prouve presque rien : tests tautologiques, sur-mockés, qui
recopient l'implémentation, ou « teach to the test ». « Auto-run + gate sur le
vert » **amplifie** ce biais au lieu de le corriger.

## Levier 1 — Exécution non-maquillable : `ai-flow harness verify`

`harness evidence` capture le diff + le scan de sécurité mais **ne lance pas** la
suite de tests. `harness verify` l'exécute réellement :

- **Source des commandes** (priorité décroissante) : `config.validation.commands`,
  puis le bloc `## Commands` de `tests.md` de la story, puis les scripts
  `package.json` usuels (`typecheck`, `type-check`, `lint`, `test`).
- **Exécute** chaque commande (`spawnSync`, shell, timeout 10 min), **capture
  verbatim** code de sortie + sorties (tronquées) dans `.coding-flow/runs/*-verify.json`.
- **Échoue (exit 1)** si une commande casse **ou si aucune commande n'a tourné** :
  « rien exécuté » n'est pas « vérifié ».
- `--dry-run` affiche le plan sans rien exécuter ; `--json` sort l'évidence brute.

Le JSON d'évidence est la vérité, pas le récit de l'agent. Pour que ce soit
totalement hors de sa main, la CI clean-room reste le gate ultime (voir plus bas).

Commandes déclaratives, indépendantes du langage :

```json
{ "validation": { "commands": ["pnpm typecheck", "pnpm test", "pnpm e2e"] } }
```

## Levier 2 — Preuve négative (dans les skills)

Un test qui ne peut jamais échouer ne prouve rien. Les skills exigent désormais,
pour chaque critère d'acceptation **critique**, un **red→green démontré** : casser
le comportement (revert/faute injectée) → le test guardien vire au rouge pour la
bonne raison → restaurer → vert. Consigné dans `implementation-notes.md`.

Le mutation testing est la version « plafond » (mutation score) : réservé aux
**modules** critiques, en reco opt-in, à cause de son coût — pas un défaut.

## Levier 3 — Discipline anti-slop + vérificateur indépendant (dans les skills)

- `blueprint-tests` : « Production-Grade Bar » (rejette tautologies, sur-mock,
  tests qui recopient l'implémentation, snapshots-fourre-tout, flaky/order-dependent,
  coverage padding) + traçabilité `critère -> file::test` + preuve négative. Le
  template `tests.md` généré porte une table de traçabilité et une checklist de
  preuve négative.
- `tests-check` : « Anti-Slop Quick Flags » + renvoi à `harness verify`.
- `agent-validator-tests` : conditions bloquantes anti-slop, **exécution
  indépendante** (relance lui-même, juge depuis story + diff, pas depuis le
  raisonnement de l'implémenteur), preuve négative exigée.
- `implement-slice` / `run-story` / `run-story-secure` : appellent `harness verify`
  après implémentation ; un échec est un blocage, pas quelque chose à contourner.

## Coût & budget (plan à 20 $)

- **Espace disque : négligeable** (évidences = petits JSON).
- **Le coût réel = tokens/passes d'agents.** Donc : preuve négative sur les
  critères *critiques*, mutation sur les *modules* critiques, vérificateur
  indépendant pour le *release-sensitive* — jamais par-story.
- **Faire porter le gate lourd par la CI** (compute GitHub gratuit) : trust ↑ et
  budget Claude ↓, puisque l'agent n'a plus à tout ré-exécuter lui-même.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `bin/lib/harness.js` | `verify` : résolution des commandes, exécution, capture verbatim, évidence, gate |
| `bin/lib/config.js` | Champ déclaratif `validation.commands` |
| `bin/lib/commands.js` | Aide : sous-commande `verify` |
| `templates/.claude/skills/blueprint-tests` | Barre production, preuve négative, traçabilité, template `tests.md` |
| `templates/.claude/skills/agent-validator-tests` | Anti-slop, exécution indépendante, preuve négative |
| `templates/.claude/skills/tests-check` | Anti-slop quick flags + renvoi verify |
| `templates/.claude/skills/{implement-slice,run-story,run-story-secure}` | Câblage de `harness verify` |
| `test/harness-verify.test.js` | 6 tests de contrat (exécution réelle, échec, aucune commande, dry-run, tests.md, parse) |

## Hors périmètre (volontaire)

- **Être le test-runner universel** : l'outil exécute les commandes *déclarées* par
  le projet, il n'invente pas de framework ni ne réimplémente le mutation testing.
- **Scaffolder la CI dans les apps cibles** : possible ensuite (template Actions +
  diff-coverage floor), mais pas dans cette tranche.
