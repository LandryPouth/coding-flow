# Session coding-flow abandonnée (2026-11-10) : faire tourner l agent seul

Source : transcript Claude Code ed554f54 (« Dépôt mattpocock/skills »), réponse du 2026-11-10 19:45 à la demande : « Est ce qu on a possibilité de laisser l agent tourner de façon auto ? Pour que le user choisisse les tâches qu il vienne lui même faire, ou qu il donne une sorte de suite de tâches à l agent qui vont tourner en auto et puis renvoyer un rapport au user ». L utilisateur a ensuite dit « laissons le côté automatique » (20:57) pour se concentrer sur mattpocock/skills. Rien n a été implémenté. Contrainte rappelée : zéro dépendance runtime (node:* seulement, git/gh/CLI agent en appels optionnels).

 Les deux sont faisables avec zéro dépendance : uniquement `node:*` et des appels optionnels à des binaires déjà présents (`git`, `gh`, le CLI de ton agent, comme `ship` le fait déjà avec `gh`). Les trois quarts de l'autonomie existent déjà. Il manque une seule pièce, et elle a été différée volontairement.

## 1. Faire tourner l'agent seul

### Ce qui existe déjà

| Brique | Rôle pour l'autonomie |
|---|---|
| `ai-flow run --epic/--story` (`bin/lib/run.js`) | Orchestrateur de lot avec un rapport agrégé, mais il n'implémente rien : son seul driver, `none`, vérifie un travail déjà fait |
| `worktree place/lock/autoland` | Une chaîne de stories par worktree, dans l'ordre des dépendances |
| `verify` exécuté par la CLI | La preuve ne dépend pas de ce que dit l'agent |
| Story 10-02 | Les commandes venant de `plan.md` sont refusées quand personne ne regarde. `--clean-env` retire les secrets de l'environnement |
| `mode: strict` | La garde refuse tout ce qu'elle ne sait pas lire |
| `evals/benchmark/run.js` | Pilote déjà `claude -p` et relève le coût (`total_cost_usd`) |

**La pièce manquante est le « Batch 4b »** du plan pivot : `run --unattended` lance un agent par story. Il a été différé le 2026-07-31 pour deux raisons : un abonnement à 20 $ ne supporte pas des runs gourmands en tokens, et la décision « outil personnel ». D'après ta propre règle de gel, c'est à toi de dire si ces deux prémisses ont changé, pas à moi de le supposer.

**Faits vérifiés sur la doc Claude Code** (vérification déléguée à un sous-agent) :
- Les hooks de `.claude/settings.json`, donc notre garde, tournent en mode `-p`.
- Un prompt `/flow-run <story>` y déclenche bien le skill.
- `--max-turns` et `--max-budget-usd` existent.
- `--permission-prompts none` retire `AskUserQuestion` : l'agent ne peut plus poser de question.
- Pièges : `--bare` saute les hooks (donc la garde), et la doc ne dit pas si un refus de la garde est respecté avec `bypassPermissions`. Il faut le tester avant toute affirmation.

### Le design proposé : pas de nouveau skill, un driver sur la commande existante

```bash
ai-flow run --driver claude --epic 13 --budget-usd 5
```

Pour chaque story, dans l'ordre des dépendances :

1. **Pré-contrôles ; le lot entier est refusé sinon :**
   - garde vérifiée pour cette plateforme (Gemini et Antigravity sont exclus) ;
   - `mode: strict` ;
   - commandes déclarées dans `config.json` ;
   - story jugée `ready` ;
   - story **marquée pour l'agent**.
2. `place` puis `lock` du worktree (code existant).
3. Implémentation :
   ```bash
   claude -p "/flow-run <story>" --permission-mode dontAsk --allowedTools … \
     --max-turns N --max-budget-usd X --permission-prompts none --output-format json
   ```
4. **`verify` lancé par la CLI**, pas par l'agent.
5. **En STRICT, la revue tourne dans un second processus `claude -p "/flow-review …"`.** C'est un contexte réellement neuf, plus sûr qu'un sous-agent : la doc mentionne un mode « fork » où le sous-agent hérite de la conversation parente.
6. Si c'est vert, on intègre la story sur la branche d'epic. Sinon elle passe `blocked`, ses dépendantes sont sautées et les chaînes indépendantes continuent.
7. **Rapport** : `run.json` plus un résumé markdown, et une PR vers la branche d'epic. Le merge vers `main` reste humain.

**Pour « le user choisit ce qu'il fait lui-même » :** chaque story porte un marqueur `agent` ou `human`, `human` par défaut. Le driver ne prend que les stories `agent`, et `/flow-next` présente les autres à l'humain. Une question que l'agent ne peut pas poser se termine en `## Status: blocked`, affiché dans le rapport comme « a besoin de toi ».

**Ce qu'on peut faire dès aujourd'hui, sans code :** une boucle shell `claude -p "/flow-run <story>"` par story, suivie de `ai-flow run --epic …` pour le rapport de preuve. Le driver ne fait que mettre des garde-fous autour de ça.

### Trois prérequis, à traiter avant de coder le driver

- **Une ligne `DOGFOODING.md` du 2026-11-09 :** `autoland` supprime les preuves avec le worktree. Un run autonome rendrait donc un rapport où toutes les stories apparaissent `in-progress`.
- **L'ambiguïté tranchée en silence** (tâche 5 du benchmark). Sans humain, l'effet est amplifié : c'est le point « grilling » de ma réponse précédente. Il faut qu'une supposition qui change le comportement rende la story `not ready`.
- **Le coût :** 3,5× celui de l'agent seul au benchmark. Un plafond par story et par lot est obligatoire, et le coût doit figurer dans le rapport.

## 2. Format des issues GitHub

D'abord un point honnête sur le motif. Dans coding-flow, `epics/` fait 15 epics, 65 stories, 177 fichiers et 585 Ko. Le remède le plus rapide à l'encombrement, c'est **archiver**. Une fois l'epic mergée, on fait `git rm` du dossier (l'historique git le garde) et on ajoute une ligne dans `epics/ARCHIVE.md`. Pas de réseau, une journée de travail. Le backend GitHub, lui, se justifie surtout s'il sert aussi de **file d'attente pour l'agent** et de **canal de rapport**. Là, les deux sujets se renforcent.

**Ce que j'ai vérifié en direct :**
- Les endpoints REST `sub_issues` et `dependencies/blocked_by` répondent 200. L'objection « il faut passer par GraphQL, c'est fragile » de `storage-backends.md` est périmée.
- Ton `gh` 2.45 n'a aucune commande pour les sub-issues : on passe uniquement par `gh api`.
- Ton compte est de type `User` : pas de types d'issue (réservés aux organisations), donc des labels.

### Le format

| Élément | Format |
|---|---|
| Epic | Issue avec le label `coding-flow:epic`. Corps = l'`index.md` actuel (Goal, Why, Scope, Decisions, verdict de readiness), **sans l'arbre ASCII** |
| Story | Sub-issue de l'epic, label `coding-flow:story`. L'ordre des sub-issues donne l'ordre du backbone |
| Dépendances | `blocked_by` natif. Il remplace l'arbre ASCII, à l'origine de trois lignes `DOGFOODING.md` sur des erreurs de parsing |
| Corps d'une story | Le format **`story.md` en un seul fichier**, que `story.js` sait déjà lire (spec/plan/tasks) : User Value, Acceptance Criteria (cases à cocher, que GitHub affiche comme une barre de progression), Edge Cases, Plan, Tasks, Result, Decisions |
| File d'attente | Label `coding-flow:agent` pour l'agent, assignation à toi pour une tâche humaine |
| Identité | `#123`, branche `story/123-slug`, et un marqueur caché `<!-- coding-flow:story … -->` pour rendre la migration rejouable |
| Statut | Toujours dérivé de la preuve, jamais d'un label. Fermée sans preuve = « closed, unproven » |
| Rapport | Un commentaire sur l'issue d'epic, pour l'affichage seulement : il n'est jamais relu comme preuve |

**Ce qui ne va jamais dans une issue :**
- **`## Commands`** : l'auteur d'une issue peut éditer son corps même sans droit d'écriture sur le dépôt. Les commandes ne viennent que de `config.json`, revu en PR.
- **Les seuils de politique** : ils restent dans `harness.json` (entrée 4).
- **Les preuves** : elles restent locales, indexées par `gh:owner/repo#123` plus le sha256 du corps de l'issue.
- **Les findings de sécurité ouverts** si le dépôt est public : c'est la règle existante de `/flow-recover`.
- **Une issue écrite par quelqu'un sans droit d'écriture ne doit jamais alimenter un run autonome**, sinon c'est une porte ouverte à l'injection de prompt.

### Le mécanisme clé : une copie de travail locale

On ne réécrit pas les parseurs. Le backend tire l'issue dans `.coding-flow/stories/123-slug/story.md`, un dossier ignoré par git. Il l'enregistre comme **localisateur de story**, exactement comme l'adaptateur Spec Kit le fait déjà (`registerStoryLocator`, `bin/lib/harness.js:23`). Ensuite :

- `verify`, le score de risque, les critères et les exemptions tournent sans changement sur ce dossier.
- L'écriture vers l'issue (critères cochés, Result, Status) est **refusée si le corps distant a changé** depuis le pull. L'issue reste l'unique source de vérité ; la copie locale n'est qu'un checkout.
- Bonus : la preuve enregistre le sha du corps. Si l'issue est modifiée après un `verify`, la story passe `stale (story changed)`, ce qui donne la détection de dérive des critères (13-05) gratuitement.
- Hors ligne : `status` lit un cache horodaté.
- Ce qu'on perd, c'est la story dans le diff de la PR. On compense avec `ship`, qui écrit « Verified against #123 @ sha » et `Closes #123`.

**Le coût réel :** l'interface de stockage fuit. `listEpics` sert huit modules, mais une vingtaine connaissent le chemin `epics/` (liaison des worktrees par nom de dossier, préfixe `epics/` exigé dans `harness.js`, `audit` qui parcourt le dossier lui-même). C'est un epic moyen qui touche aux clés de preuve, donc STRICT.

## Ordre recommandé

1. Les prérequis : les preuves qui survivent à `autoland`, et le grilling avec le gate de readiness.
2. L'archive des epics finies (soulagement immédiat).
3. `run --driver claude` en séquentiel, avec un auto-test de la garde en headless avant le lot.
4. Le backend GitHub, si tu veux toujours la file d'attente dans GitHub.

## Décisions qui t'appartiennent

- **Budget :** les runs `claude -p` passent-ils sur l'abonnement ou sur une clé API ? Quel plafond par lot ? C'était la prémisse du report de 2026-07.
- **Merge :** l'agent s'arrête-t-il à la branche d'epic, avec un merge vers `main` toujours humain ? C'est ma recommandation.
- **Dépôt public :** des stories en issues publiques rendent tes plans publics. Ça te va ?

Je n'ai rien modifié dans le dépôt. Si tu tranches ces trois points, je peux écrire le plan (en anglais) dans `docs/plans/`, avec l'entrée `design-decisions.md` qui énonce le changement de prémisse, puis en faire des epics avec `/flow-plan`.
