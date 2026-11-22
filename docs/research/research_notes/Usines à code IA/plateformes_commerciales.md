# Plateformes commerciales d'agents de code autonomes (« usines à code », flottes d'agents), 2025-2026

Notes de recherche, 2026-11-12. Les sources primaires (blogs et docs des éditeurs, articles arXiv) sont préférées. Quand une affirmation ne vient que d'une source secondaire, c'est indiqué. Les informations datant d'avant 2025 sont signalées.

## Factory.ai et ses « Droids » : principe de l'usine logicielle, types de Droids, intégrations, mémoire, métriques

### Takeaway
Factory est passé de « Droids » (agents qui codent, investiguent les incidents, gèrent les tickets et relisent les PR, GA en mai 2025) à une « software factory » (juin 2026) : une boucle fermée signal → triage → plan → build → test → review → sécurité → livraison → monitoring → nouveau signal. Les étapes y partagent un même cœur d'agent, un contexte d'organisation commun et un apprentissage continu. Factory publie peu de métriques chiffrées. Elle annonce surtout des logos de clients et une première place sur Terminal-Bench, une affirmation de l'éditeur lui-même.

### Cited Findings
- GA de Factory annoncée le 28 mai 2025. Capacités listées : code autonome de bout en bout, résolution d'incidents d'astreinte (triage, cause racine), recherche approfondie dans le code, gestion automatisée des tickets Linear, rédaction de specs produit depuis des conversations Slack, review de PR — [Factory GA](https://factory.com/news/ga)
- Intégrations nommées à la GA : GitHub, GitLab, Jira, Slack, PagerDuty, Linear, plus MCP pour apporter son propre contexte — [Factory GA](https://factory.com/news/ga)
- Mémoire : une mémoire au niveau de l'organisation et de l'utilisateur conserve « decisions, docs, and run-books » d'une session à l'autre, sans cloner toute la base de code. L'indexation en temps réel tient à jour le code, les tickets et les schémas d'architecture — [Factory GA](https://factory.com/news/ga)
- Autonomie à la GA : un Droid construit une fonctionnalité à partir d'un ticket, d'une spec ou d'un prompt, avec des « fine-grained controls and guardrails ». On peut travailler en binôme interactif ou lancer des tâches longues, en local ou dans le cloud — [Factory GA](https://factory.com/news/ga)
- Tarif affiché à la GA : environ 40 $ par équipe plus 10 $ par utilisateur actif et par mois. Le texte de la page est altéré, donc à confirmer — [Factory GA](https://factory.com/news/ga)
- Clients cités à la GA : MongoDB, Zapier, Framer, Clari. Les gains de vitesse sont qualitatifs (diagnostic d'incident en « minutes ») — [Factory GA](https://factory.com/news/ga)
- 25 septembre 2025 : série B de 50 M$ et disponibilité générale des Droids. Le communiqué revendique la première place sur Terminal-Bench (affirmation de l'éditeur ; page lue seulement via un extrait de recherche, l'accès direct a renvoyé 403) — [BusinessWire](https://www.businesswire.com/news/home/20250925993478/en/Factory-Raises-50M-Series-B) ; [SiliconANGLE](https://siliconangle.com/2025/09/25/factory-unleashes-droids-software-agents-50m-fresh-funding/)
- Surfaces : terminal (CLI), IDE, navigateur, Slack. « Give Droids a task in natural language and they plan, write, test, and ship code » — [Factory, page Droids](https://factory.ai/product/droids)
- Le site de Factory cite EY qui déploie les Droids auprès de plus de 5 000 ingénieurs (vu dans un extrait de recherche, non vérifié sur la page) — [factory.ai](https://www.factory.ai/)
- « Factory 2.0: From coding agents to software factories », 15 juin 2026, par Matan Grinberg et Eno Reyes. L'usine logicielle y est définie comme un système « agent-native », de bout en bout, qui s'améliore en s'observant lui-même. Les signaux (bugs, retours clients, besoins métier) sont triés en changements planifiés, puis construits, testés, relus, sécurisés, livrés et surveillés, et la surveillance produit de nouveaux signaux : « a continuous feedback loop » — [Factory, Software Factory](https://factory.com/news/software-factory)
- Trois exigences de cette usine :
  - **Indépendance vis-à-vis du modèle** : choix délibéré du modèle, ou routeur par coût, performance ou vitesse.
  - **« Sovereign Intelligence »** : déploiement du cloud jusqu'à l'air-gapped, avec un système qui apprend de ses propres sessions et reviews.
  - **Apprentissage continu** : review, sécurité, docs, QA et réponse aux incidents partagent un même cœur d'agent et le même contexte d'organisation, si bien que ce qu'une étape trouve informe les autres.

  — [Factory, Software Factory](https://factory.com/news/software-factory)
- Modes d'exécution en 2026 :
  - « Droid agents or skills » pour les tâches bien définies et mesurables.
  - « Automations » pour les flux récurrents, avec un objectif et une mémoire partagés.
  - « Droid Computers » pour les agents longs, persistants, distants ou locaux.
  - « Missions » pour le travail multi-agent complexe, qui dure des heures ou des jours en « decomposing work into parallel tracks ».

  — [Factory, Software Factory](https://factory.com/news/software-factory)
- L'autonomie y est présentée comme progressive : « Autonomy is a maturation process that is gradual ». Le mode se choisit selon le guidage humain nécessaire, la sensibilité des informations et l'« Agent Readiness » — [Factory, Software Factory](https://factory.com/news/software-factory)
- Clients nommés en 2026 : NVIDIA, EY, Adobe, Palo Alto Networks, Adyen, Blackstone, Wipro, Comarch. L'article ne donne aucune métrique chiffrée — [Factory, Software Factory](https://factory.com/news/software-factory)

### Inferences
- Le discours de Factory a évolué de « des agents spécialisés par tâche » (2025) vers « un système en boucle fermée qui apprend de ses propres sessions et reviews » (2026). La mémoire d'organisation et le retour du monitoring vers le backlog sont les éléments qui distinguent l'« usine » d'un simple agent de code.
- L'absence de taux de merge ou de taux de succès publiés contraste avec Cognition, qui publie un taux de merge.

### Gaps
- Les noms historiques des Droids (Code Droid, Knowledge Droid, Reliability Droid, Product Droid, Tutorial Droid, connus avant 2025) n'apparaissent pas dans les pages 2025-2026 lues. Il n'a pas été vérifié s'ils existent encore.
- Le score Terminal-Bench exact et sa date n'ont pas été obtenus de source primaire (BusinessWire a renvoyé 403).
- Aucun chiffre de client (temps gagné, temps de cycle, taux de merge) trouvé dans les sources primaires.
- Les détails d'intégration CI (déclenchement sur un build en échec, statut des checks) n'ont pas été trouvés.

## Devin (Cognition) : planification, sessions, Knowledge, playbooks, Devins en parallèle, apprentissage, taux de succès et critiques

### Takeaway
Devin est un agent asynchrone qu'on pilote par sessions, depuis Slack, une app web ou une API. Sa mémoire repose sur des « Knowledge » (des conseils rappelés automatiquement, que Devin propose lui-même à partir des retours humains) et sur des « Playbooks » (des recettes de tâches récurrentes, qu'il peut générer à partir de sessions réussies). DeepWiki fournit la documentation du code, et Interactive Planning ou Ask Devin servent à cadrer le travail. Cognition annonce un taux de merge des PR passé de 34 % à 67 % (novembre 2025). Les évaluations indépendantes sont plus sévères : 3 tâches réussies sur 20 chez Answer.AI (janvier 2025), et un taux de merge parmi les plus bas dans les études académiques de PR agentiques de 2026.

### Cited Findings
- « Devin's 2025 Performance Review », 14 novembre 2025, 18 mois après le lancement. Devin est utilisé dans des milliers d'entreprises, dont Goldman Sachs, Santander et Nubank, et a fait merger « hundreds of thousands of PRs ». La part de ses PR mergées passe de 34 % à 67 % en un an, sans définition formelle de ce que « merged » recouvre. Cognition annonce aussi environ 4x plus de vitesse et 2x plus d'efficacité en ressources — [Cognition](https://cognition.com/blog/devin-annual-performance-review-2025)
- Chiffres de clients dans la même revue (tous rapportés par l'éditeur) :
  - Correctifs de vulnérabilités : environ 30 min pour un humain contre environ 1,5 min pour Devin, soit 5 à 10 % du temps total des développeurs économisé dans une grande organisation.
  - Migration ETL dans une banque : de 30-40 h à 3-4 h par fichier.
  - Montée de version Java : environ 14x plus rapide par dépôt.
  - Couverture de tests : de 50-60 % à 80-90 %.
  - Litera : couverture de tests +40 % et cycles de régression 93 % plus rapides.
  - Une banque a généré la documentation de plus de 400 000 dépôts.
  - Devin a poussé environ un tiers des commits de l'application web de Cognition.

  — [Cognition](https://cognition.com/blog/devin-annual-performance-review-2025)
- Points forts selon Cognition : l'« exécution junior à l'échelle », c'est-à-dire des tâches de 4 à 8 h pour un junior, aux exigences claires et au résultat vérifiable (migrations, findings SonarQube ou Veracode, tests unitaires, petits tickets). Les Devins tournent en parallèle comme une « fleet » sur plusieurs dépôts. Points faibles : les exigences ambiguës, les changements de périmètre en cours de tâche, le design visuel sans spécifications précises — [Cognition](https://cognition.com/blog/devin-annual-performance-review-2025)
- Boucle humaine décrite :
  - Les ingénieurs cadrent le travail en amont et apprennent à « manager » Devin.
  - Les humains écrivent un playbook de tests unitaires pour quelques centaines de dépôts, Devin écrit les tests, puis les code owners vérifient la logique.
  - La review faite par Devin n'est qu'une première passe, car la qualité du code « is not straightforwardly verifiable ».

  — [Cognition](https://cognition.com/blog/devin-annual-performance-review-2025)
- DeepWiki fournit une documentation à jour en continu, avec diagrammes. AskDevin répond aux questions sur le code et sert à planifier ce qui revient aux humains ou à l'IA — [Cognition](https://cognition.com/blog/devin-annual-performance-review-2025)
- Knowledge : une réserve de conseils et d'instructions que Devin consulte à chaque session et rappelle automatiquement quand ils sont pertinents. Devin propose de nouvelles entrées (et des mises à jour d'entrées existantes) à partir des retours en chat, et l'humain les valide, les édite ou les rejette — [Devin docs, Knowledge](https://docs.devin.ai/product-guides/knowledge) ; [Devin docs, Onboard Knowledge](https://docs.devin.ai/Onboard_Devin/knowledge)
- Playbooks : recommandés pour le travail répétitif en plusieurs étapes. Les « Advanced capabilities » permettent à Devin d'orchestrer des sessions gérées, d'analyser du travail passé, de créer des playbooks à partir de plusieurs sessions réussies et de gérer la base de connaissances. C'est le mécanisme d'apprentissage d'une session à l'autre, avec validation humaine — [Devin docs, Advanced capabilities](https://docs.devin.ai/work-with-devin/advanced-capabilities) ; [Devin docs, Creating playbooks](https://docs.devin.ai/product-guides/creating-playbooks.md)
- Devin 2.0 et Interactive Planning : le premier livrable est un plan (fichiers concernés, constats) à relire avant l'implémentation. Source secondaire (fast.io), non confirmée sur une page de Cognition — [fast.io](https://fast.io/resources/devin-2-0-guide/)
- Answer.AI, « Thoughts On A Month With Devin », 8 janvier 2025, par Hamel Husain, Isaac Flath et Johno Whitaker : 3 tâches réussies sur 20 (création de projets, recherche, modification de projets existants). « Tasks that seemed straightforward often took days rather than hours, with Devin getting stuck in technical dead-ends or producing overly complex, unusable solutions ». Les auteurs concluent que des workflows menés par le développeur avec assistance IA sont plus fiables. Évaluation de Devin 1.x — [Answer.AI](https://www.answer.ai/posts/2025-01-08-devin) ; [The Register](https://www.theregister.com/2025/01/23/ai_developer_devin_poor_reviews)
- Étude académique (MSR '26, sur le jeu de données AIDev) : sur 3 380 PR de Devin dans des dépôts de plus de 500 étoiles, 53,6 % sont mergées, contre 71,0 % pour Codex et 71,4 % pour Cursor. Devin et Copilot apparaissent plus souvent dans des workflows où le reviewer intervient — [arXiv 2605.22534](https://arxiv.org/html/2605.22534)
- Mazloomzadeh, Morovati et Khomh (juillet 2026, 9 428 PR agentiques sur 489 dépôts Python) estiment la probabilité de merge de Devin à 43,0 %, la plus basse, contre 84,3 % pour Claude Code et 73,5 % pour Codex (vu via un extrait de recherche) — [arXiv 2607.21832](https://arxiv.org/pdf/2607.21832)

### Inferences
- Le taux de merge de 67 % annoncé par l'éditeur et les 43-54 % mesurés en open source ne mesurent pas la même chose. D'un côté des clients entreprise qui cadrent fortement les tâches avec des playbooks, de l'autre des dépôts publics. Aucun des deux ne contrôle la difficulté des tâches.
- L'« apprentissage » de Devin est explicite et passe par l'humain : Knowledge suggérée puis validée, playbooks dérivés de sessions. Ce n'est pas un apprentissage automatique des poids.

### Gaps
- Je n'ai pas trouvé de doc officielle à jour sur « Devin Wiki » (la revue 2025 parle de DeepWiki), ni sur le nombre maximal de Devins en parallèle ou MultiDevin.
- La définition exacte du taux de merge de 67 % n'est pas publiée.
- Il manque une évaluation indépendante de Devin 2.x comparable à celle d'Answer.AI.

## OpenAI Codex, GitHub Copilot coding agent / Agent HQ, Google Jules, Cursor background/cloud agents, Sourcegraph Amp : boucles, sandboxes, vérification, handoff, fichiers d'instructions, parallélisme

### Takeaway
Tous suivent le même schéma : une tâche est lancée de façon asynchrone dans une VM ou un conteneur cloud isolé, le dépôt est cloné, l'agent planifie puis édite, lance tests et linters, et produit un diff ou une PR qu'un humain relit. Ils diffèrent sur le point d'entrée (issue GitHub, chat, Slack, IDE), sur l'existence d'un point d'approbation du plan (Jules), sur la vérification interne (le « critic » de Jules, l'évaluation multi-runs de Cursor, l'« oracle » d'Amp) et sur la mémoire (Copilot Memory, AGENTS.md).

### Cited Findings
**OpenAI Codex (agent cloud)**
- Lancé en research preview le 16 mai 2025. Agent cloud qui traite de nombreuses tâches en parallèle, chacune dans sa propre sandbox cloud préchargée avec le dépôt (page d'OpenAI vue via un extrait de recherche, l'accès direct a renvoyé 403) — [OpenAI, Introducing Codex](https://openai.com/index/introducing-codex/)
- Codex lit et modifie les fichiers, lance tests, linters et type checkers, et journalise ses résultats. La plupart des tâches prennent de 1 à 30 minutes. Les fichiers AGENTS.md lui servent d'instructions : conventions de test, structure du code, messages de PR — [The Decoder](https://the-decoder.com/?p=23787)
- Selon le billet de lancement, codex-1 fonctionne bien même sans AGENTS.md ni scaffolding sur mesure (vu via un extrait de recherche) — [OpenAI](https://openai.com/index/introducing-codex/)
- Le travail s'arrête à une PR qu'un humain approuve. Les retours viennent de la suite de tests du projet (explicatif secondaire) — [The AI Engineer](https://theaiengineer.substack.com/p/how-openai-codex-works)
- GA le 6 octobre 2025 : intégration Slack, Codex SDK (TypeScript) et outils d'admin, avec analytics de la review de code. À partir du 20 octobre 2025, les tâches cloud comptent dans les limites d'usage. Cisco annonce jusqu'à 50 % de temps de review gagné sur les PR complexes — [OpenAI, Codex GA](https://openai.com/index/codex-now-generally-available) ; [C# Corner](https://www.c-sharpcorner.com/news/openai-makes-codex-generally-available-adds-slack-integration-sdk-admin-tools)
- L'affirmation de Sam Altman selon laquelle presque tout le nouveau code d'OpenAI est écrit avec Codex est rapportée de seconde main, sans source primaire trouvée — [NewsBytes](https://www.newsbytesapp.com/news/science/openais-codex-is-now-writing-almost-all-of-its-code/tldr)
- Une page plus récente évoque GPT-5.3-Codex travaillant de façon autonome plus de 7 h, et le CLI permettrait de déléguer au cloud avec plusieurs tentatives (`--attempts` 1-4). Sources secondaires non vérifiées — [Daniel Vaughan](https://codex.danielvaughan.com/2026/05/19/codex-cli-cloud-delegation-workflows-plan-locally-execute-remotely-apply-diffs/)

**GitHub Copilot coding agent (rebaptisé « cloud agent » dans la doc) et Agent HQ**
- GA le 25 septembre 2025. L'agent ouvre une PR en brouillon et travaille dans son propre environnement, propulsé par GitHub Actions — [GitHub changelog](https://github.blog/changelog/2025-09-25-copilot-coding-agent-is-now-generally-available/)
- Points d'entrée : assigner une issue à Copilot, l'onglet Agents, Copilot Chat, l'IDE, le tableau de bord. Copilot étudie le dépôt, planifie, implémente en arrière-plan, et peut « run tests and linters in a cloud development environment ». Il peut aussi corriger des alertes de code scanning — [GitHub Docs](https://docs.github.com/copilot/concepts/coding-agent/about-copilot-coding-agent)
- Trois environnements. **GitHub Actions** : un seul dépôt, runners self-hosted possibles, 59 minutes maximum non extensibles, données conservées 28 jours. **Sandbox cloud** : peut couvrir plusieurs dépôts d'une organisation et respecte les allowlists du firewall. **Remote**. Copilot travaille sur une branche à la fois et ouvre une PR par tâche. Les rulesets et la protection de branche peuvent le bloquer, sauf contournement accordé par un admin — [GitHub Docs](https://docs.github.com/copilot/concepts/coding-agent/about-copilot-coding-agent)
- Côté humain : il faut relire et tester avant la production, les logs de session ne remplacent pas la review, et les sessions sont partageables avec l'équipe. Copilot code review peut proposer des corrections sur les PR — [GitHub Docs](https://docs.github.com/copilot/concepts/coding-agent/about-copilot-coding-agent)
- Personnalisation : instructions personnalisées, agents personnalisés, agent skills et serveurs MCP. **Copilot Memory** construit une compréhension persistante des dépôts et des préférences d'une session à l'autre — [GitHub Docs](https://docs.github.com/copilot/concepts/coding-agent/about-copilot-coding-agent)
- Agent HQ, annoncé à GitHub Universe le 28 octobre 2025, doit orchestrer les agents tiers (Anthropic, OpenAI, Google, Cognition, xAI) depuis GitHub, avec un « mission control » comme première brique. Le déploiement a été progressif et le statut GA n'a pas été confirmé — [GitHub Blog](https://github.blog/news-insights/product-news/welcome-home-agents/) ; [The New Stack](https://thenewstack.io/github-embraces-the-coding-agent-competition-with-agent-hq/)

**Google Jules**
- Bêta en mai 2025, GA en août 2025 (billet du 7 août), dans les pays où Gemini est disponible. Jules travaille dans une VM Ubuntu cloud avec accès internet, dont le disque passe à 20 Go le 15 août 2025 — [TechRepublic](https://techrepublic.com/article/news-google-jules-ai-coding-agent) ; [Jules changelog](https://jules.google/docs/changelog)
- Plan visible avant toute modification, avec un sélecteur « Interactive plan », « Review plan » ou « Plan and go ». L'auto-approbation après un délai (5 min) et l'option `requirePlanApproval` de l'API ne sont rapportées que par des sources secondaires — [InfoQ](https://www.infoq.com/news/2025/08/google-jules) ; [rywalker.com](https://rywalker.com/research/jules)
- Le « critic » (changelog du 8 août 2025) est un relecteur interne qui conteste chaque changement proposé. Il signale les problèmes sans corriger et renvoie le travail à Jules — [Jules changelog](https://jules.google/docs/changelog)
- Jules Tools est un CLI (`npm`, `jules login`) qui crée et liste les sessions distantes et récupère les diffs — [rywalker.com](https://rywalker.com/research/jules)

**Cursor background agents, devenus Cloud Agents**
- Cursor 2.0 (29-30 octobre 2025) : modèle Composer et interface multi-agents. Les Background Agents deviennent les « Cloud Agents », annoncés à 99,9 % de fiabilité avec démarrage instantané. Quand plusieurs agents tournent en parallèle, Cursor évalue automatiquement les runs et recommande la meilleure solution. Bugbot génère un résumé des changements quand une PR est créée — [Cursor changelog 2.0](https://cursor.com/changelog/2-0)
- Jusqu'à 8 agents en parallèle, isolés par git worktrees ou sandboxes distantes (source secondaire) — [The Decoder](https://the-decoder.com/cursor-2-0-shifts-to-in-house-ai-with-composer-model-and-parallel-agents/)
- Les agents clonent le dépôt dans une VM Ubuntu isolée, travaillent sur une branche et livrent une PR (annuaire secondaire). Bugbot Autofix (février 2026, d'après un blog personnel) lance un agent cloud qui teste un correctif et le propose sur la PR. Non vérifié sur une source primaire — [Enterprise DNA](https://enterprisedna.co/directories/agents/cursor-background-agent)

**Sourcegraph Amp**
- Amp lit AGENTS.md dans le répertoire courant, les répertoires parents et des emplacements globaux, avec repli sur AGENT.md ou CLAUDE.md, et permet des @-mentions de fichiers à l'intérieur — [Daniel Vaughan](https://codex.danielvaughan.com/2026/04/07/sourcegraph-amp-multi-repo-orchestrator/) ; [rywalker.com](https://rywalker.com/research/amp-sourcegraph)
- Sous-agents spécialisés (Search, Oracle, Librarian, Read Thread), chacun dans sa propre fenêtre de contexte. L'Oracle est un modèle de raisonnement plus fort que l'agent principal consulte. Les sources divergent sur son déclenchement (automatique ou explicite) et sur le modèle utilisé — [morphllm](https://www.morphllm.com/comparisons/amp-vs-claude-code) ; [rywalker.com](https://rywalker.com/research/amp-sourcegraph)
- Les « threads » (un par tâche) peuvent être forkés, partagés et pilotés depuis le web ou le mobile, avec un « handoff » explicite pour continuer. Amp aurait été séparé de Sourcegraph fin 2025 (Amp Inc. ou Amp Frontier Corp., selon les sources) — [rywalker.com](https://rywalker.com/research/amp-sourcegraph)

### Inferences
- La vérification repose partout d'abord sur la suite de tests et les linters du projet, lancés dans la sandbox. AGENTS.md, ou son équivalent, sert à déclarer ces commandes, ce qui rend la qualité de la vérification dépendante de la préparation du dépôt.
- Trois patrons de « second regard » interne apparaissent : un critique séparé (Jules), la sélection entre plusieurs runs parallèles (Cursor, et `--attempts` côté Codex), et la consultation d'un modèle plus fort (l'Oracle d'Amp). Aucun ne remplace la review humaine de la PR, que toutes les docs exigent.

### Gaps
- La page de lancement de Codex (403) et la doc Codex cloud n'ont pas été lues directement. Le mécanisme des citations de logs de terminal et de sorties de test dans les réponses de Codex, connu du lancement de mai 2025, n'a pas été revérifié.
- Aucune doc officielle de Cursor lue sur les Cloud Agents (environnement, `environment.json`, accès internet).
- Aucune doc officielle d'Amp lue (ampcode.com). Les détails viennent de sources secondaires.
- Le statut GA d'Agent HQ n'a pas été confirmé.

## Points communs et différences : moments d'intervention humaine, approche de la vérification, mémoire

### Takeaway
Le point de contrôle humain commun est la review de la PR, en fin de boucle. Les plateformes ajoutent ou non un point en amont (validation du plan chez Jules, cadrage interactif chez Devin, choix du niveau d'autonomie chez Factory). La mémoire va de simples fichiers d'instructions versionnés (AGENTS.md chez Codex et Amp, instructions chez Copilot) à des mémoires gérées par la plateforme (Copilot Memory, Knowledge et playbooks de Devin, mémoire d'organisation de Factory), validées par un humain ou non.

### Cited Findings
- Moment humain en amont :
  - Jules : plan interactif, plan à relire ou « Plan and go » — [InfoQ](https://www.infoq.com/news/2025/08/google-jules)
  - Devin : cadrage en amont par les ingénieurs — [Cognition](https://cognition.com/blog/devin-annual-performance-review-2025)
  - Factory : choix du mode selon le guidage humain nécessaire et l'« Agent Readiness » — [Factory](https://factory.com/news/software-factory)
- Moment humain en aval : Copilot exige de relire et tester avant la production, et les rulesets de branche peuvent le bloquer — [GitHub Docs](https://docs.github.com/copilot/concepts/coding-agent/about-copilot-coding-agent). Codex s'arrête à une PR qu'un humain approuve — [The AI Engineer](https://theaiengineer.substack.com/p/how-openai-codex-works)
- Mémoire :
  - Copilot Memory persiste d'une session à l'autre — [GitHub Docs](https://docs.github.com/copilot/concepts/coding-agent/about-copilot-coding-agent)
  - Devin propose sa Knowledge, que l'humain valide — [Devin docs](https://docs.devin.ai/product-guides/knowledge)
  - Factory a une mémoire d'organisation et d'utilisateur (decisions, docs, runbooks) — [Factory GA](https://factory.com/news/ga) — et un système qui apprend de ses propres sessions et reviews — [Factory](https://factory.com/news/software-factory)
- Parallélisme :
  - Codex : une sandbox par tâche — [OpenAI](https://openai.com/index/introducing-codex/)
  - Devin : une « fleet » sur plusieurs dépôts — [Cognition](https://cognition.com/blog/devin-annual-performance-review-2025)
  - Cursor : runs parallèles évalués entre eux — [Cursor](https://cursor.com/changelog/2-0)
  - Factory : Missions découpées en « parallel tracks » — [Factory](https://factory.com/news/software-factory)
  - Copilot : une branche et une PR par tâche — [GitHub Docs](https://docs.github.com/copilot/concepts/coding-agent/about-copilot-coding-agent)

### Inferences
- Seul Factory (2026) décrit explicitement une boucle fermée qui part de la production (monitoring, incidents) et revient au backlog. Les autres s'arrêtent à la PR.
- La tendance 2025-2026 est à la consolidation : GitHub se positionne en couche d'orchestration multi-agents (Agent HQ), Factory en « plateforme d'usine », tandis que les agents eux-mêmes se ressemblent de plus en plus.

### Gaps
- Aucune comparaison indépendante, sur un même jeu de tâches, de ces plateformes en conditions d'entreprise.

## Problèmes rapportés : goulot de la review, faibles taux de merge, succès hallucinés, coût

### Takeaway
Les études de 2026 sur les PR agentiques (jeu de données AIDev) donnent des taux de merge de 43 à 85 % selon l'agent et l'étude, avec des classements contradictoires. Une partie des rejets ne reflète pas un échec de l'agent : PR en doublon, remplacée ou abandonnée. Le coût de la review humaine n'est pas mesuré. Le coût monétaire apparaît surtout via les changements de tarification (tâches cloud de Codex comptées à partir d'octobre 2025).

### Cited Findings
- MSR '26 (Peralta et al., Waseda et autres ; arXiv mis en ligne le 21 mai 2026) : 9 799 PR agentiques fermées dans des dépôts de plus de 500 étoiles, 63,1 % mergées. Par agent : Claude Code 61,0 %, Copilot 58,7 %, Cursor 71,4 %, Devin 53,6 %, Codex 71,0 % — [arXiv 2605.22534](https://arxiv.org/html/2605.22534)
- Sur 353 rejets analysés à la main : 35,7 % sont de vrais échecs de l'agent (checks ou tests en échec, changement qui ne marche pas), 31,2 % des fermetures sans lien avec l'agent (doublons, PR remplacées, inactivité), 33,1 % sans justification observable. Conclusion des auteurs : les rejets surestiment fortement les erreurs des agents — [arXiv 2605.22534](https://arxiv.org/html/2605.22534)
- Sur 364 merges : 79,1 % sans boucle de feedback observée, 7,7 % après feedback et révision par l'agent, 7,7 % avec des commits ajoutés par le reviewer. Copilot représente 29 des 49 PR mergées avec intervention humaine. La durée de review et le volume de commentaires n'ont pas été mesurés, donc le coût de l'intervention humaine reste inconnu — [arXiv 2605.22534](https://arxiv.org/html/2605.22534)
- Autre étude (arXiv 2601.15195) : 71,48 % de merge global, Codex le plus haut (82,59 %) et Copilot le plus bas (43,04 %). Vu via un résumé alphaXiv — [alphaXiv 2601.15195](https://www.alphaxiv.org/overview/2601.15195)
- PR de correctifs (arXiv 2602.00164, janvier 2026) : 8 106 PR, 65,0 % mergées, environ 81,6 % pour Codex contre 42-43 % pour Copilot et Devin. Vu via un résumé emergentmind — [emergentmind](https://www.emergentmind.com/papers/2602.00164)
- Mazloomzadeh et al. (juillet 2026) : probabilités de merge de 84,3 % pour Claude Code, 73,5 % pour Codex et 43,0 % pour Devin. Copilot et Devin ne sont pas significativement différents, et les taux montent entre le premier et le quatrième trimestre — [arXiv 2607.21832](https://arxiv.org/pdf/2607.21832)
- Succès apparent mais inutilisable : Answer.AI décrit des tâches qui prennent des jours, des impasses techniques et des solutions « overly complex, unusable » (janvier 2025) — [The Register](https://www.theregister.com/2025/01/23/ai_developer_devin_poor_reviews)
- Cognition reconnaît que la review par Devin n'est qu'une première passe, la qualité du code n'étant « not straightforwardly verifiable » — [Cognition](https://cognition.com/blog/devin-annual-performance-review-2025)
- Coût : les tâches cloud de Codex comptent dans les limites d'usage depuis le 20 octobre 2025 — [OpenAI](https://openai.com/index/codex-now-generally-available). Un billet de Lenny's Newsletter s'intitule « I spent $20,000 on Devin in a month » (contenu non lu) — [Lenny's Newsletter](https://lennysnewsletter.com/p/i-spent-20000-on-devin-in-a-month)
- Copilot : sessions GitHub Actions limitées à 59 min, et la doc avertit que Copilot peut produire du code incorrect ou non sécurisé — [GitHub Docs](https://docs.github.com/copilot/concepts/coding-agent/about-copilot-coding-agent)

### Inferences
- Les classements par taux de merge s'inversent d'une étude à l'autre (Copilot à 43 % ou à 59 %, Codex à 71 % ou à 83 %). Ils dépendent surtout du jeu de données, de la période et des filtres. Le taux de merge seul est un mauvais indicateur.
- Le goulot de la review est souvent affirmé mais pas quantifié : l'étude MSR '26 dit explicitement ne pas avoir mesuré l'effort de review.
- Le fort taux de merge des PR Codex et Cursor « sans interaction » peut refléter un usage où le développeur qui lance l'agent est aussi celui qui merge, donc un dépôt personnel et une tâche auto-assignée. C'est une hypothèse, non démontrée.

### Gaps
- Je n'ai pas trouvé de mesure publiée du temps passé par les reviewers sur les PR d'agents, ni du taux de « succès hallucinés », c'est-à-dire d'un agent qui déclare avoir réussi alors que les tests échouent ou n'ont pas tourné.
- Je n'ai pas trouvé de comparaison de coût par tâche réussie entre plateformes.
- Les fils Hacker News et les billets de Simon Willison n'ont pas été lus, faute de budget de recherche.
