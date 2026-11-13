# Product understanding before planning: discovery practices for an AI planning agent (/flow-plan), 2025-2026

Research date: 2026-11-13. About 18 search/fetch calls. Sources marked "(not re-fetched)" are canonical primary pages cited from established knowledge. I did not open them this session, so check them before quoting exact wording. Weak or secondary evidence is flagged inline.

Scope addition from the coordinator: Coding Flow serves mostly backends, in many languages, and every kind of project: games, networking and protocols, CLIs and dev tools, libraries and SDKs, embedded, data/ML and mobile. Section 6 covers how discovery differs by project type and which frameworks are web/SaaS-specific.

---

## 1. Which discovery frameworks compress well into an agent step (most planning value per token)?

### Takeaway
The best value per token comes from a few short structured fields:
- a problem stated as a job or outcome (JTBD or OST outcome);
- an appetite with explicit no-gos and rabbit holes (Shape Up);
- an assumption list tagged by Cagan's four risks and ranked riskiest first (OST assumption tests);
- a glossary (DDD ubiquitous language).

The heavier artefacts (Lean Canvas, full PR/FAQ, event storming workshops) are worth it only for greenfield products or new bounded contexts. /flow-plan already does story mapping (Backbone journey and walking skeleton).

### Cited Findings
- **Cagan's four risks** (SVPG, 2017-12-04):
  - Value: will customers buy it, or will users choose to use it?
  - Usability: can users figure out how to use it?
  - Feasibility: can engineers build it with the time, skills and technology available?
  - Business viability: does it work for the business (go-to-market, partner and legal constraints, CAC, monetization, brand)?
  - Owners: PM for value and viability, designer for usability, lead engineer for feasibility. — [SVPG, Four Big Risks](https://www.svpg.com/four-big-risks/)
- **Shape Up pitch ingredients** (Basecamp). — [Shape Up ch. 6 "Write the Pitch"](https://basecamp.com/shapeup/1.5-chapter-06)
  - Problem: ideally one specific story showing why the status quo fails, used as the baseline for judging the solution.
  - Appetite: the time the team is willing to spend (for example 6 weeks, or 2 weeks for a small batch). It constrains the solution, not the estimate.
  - Solution: core elements, shown as breadboards or fat-marker sketches.
  - Rabbit holes: risky details, each patched with a few lines of text.
  - No-gos: explicitly excluded functionality.
- **Opportunity Solution Tree** (Teresa Torres): a desired outcome at the top, then customer opportunities (needs, pain points, desires) found in interviews, then solutions, then assumption tests. Assumptions are typed as desirability, viability, feasibility, usability and ethical, and only the riskiest ones get tested. — [Product Talk, OST](https://www.producttalk.org/opportunity-solution-trees/) (the fetch timed out, so this is from the canonical page)
  - Product Talk published a 2026 case study on generating OSTs with AI from interview synthesis, with evals and "repair loops". It is a concrete example of an agent applying OST to real interview data, not invented data. — [Product Talk, Vistaly case](https://www.producttalk.org/generating-opportunity-solution-trees-with-ai-how-vistaly-rebuilt-its-product-around-interview-synthesis-evals-and-repair-loops/) (title seen in search results, body not read)
- **Amazon Working Backwards PR/FAQ**:
  - A one-page future-dated press release plus an FAQ. The first half of the FAQ holds customer questions and the second half internal questions (finance, legal, engineering).
  - It is iterated before any code is written.
  - It is documented in Bryar and Carr, *Working Backwards* (2021).
  - — [AWS re:Invent 2020 INO206 deck](https://d1.awsstatic.com/events/reinvent/2020/Working_Backwards_Amazons_approach_to_innovation_INO206.pdf); [GeekWire 2021](https://www.geekwire.com/2021/working-backwards-customer-inside-amazons-strategy-launch-new-products/). Most search hits were secondhand guides, so evidence on Amazon's internal practice is medium.
- **User story mapping** (Jeff Patton): a backbone of user activities, walking skeleton, and release slices cut horizontally. — [Jeff Patton & Associates](https://jpattonassociates.com/user-story-mapping/) (not re-fetched). /flow-plan already applies it.
- **Impact mapping** (Gojko Adzic, 2012): Goal, then Actors, then Impacts (behaviour changes), then Deliverables. It ties each deliverable to a measurable behaviour change of an actor. — [impactmapping.org](https://www.impactmapping.org/) (not re-fetched)
- **Event storming** (Alberto Brandolini) and **DDD ubiquitous language** (Eric Evans, 2003): domain events, commands, aggregates and bounded contexts; one shared vocabulary used in code and conversation. — [eventstorming.com](https://www.eventstorming.com/) (not re-fetched)
- **Jobs-to-be-Done**: the job statement format "When [situation], I want to [motivation], so I can [expected outcome]" (Intercom's job story, Alan Klement). — [Intercom, "Replacing the user story with the job story"](https://www.intercom.com/blog/accomplishing-a-job/) (not re-fetched; URL may differ)

### Inferences
- **Ranking by planning value per token for /flow-plan** (my judgement, not sourced as a ranking):
  1. Shape Up appetite, no-gos and rabbit holes. They are cheap and map directly to "Out of scope" and to story size limits. They are also domain-agnostic.
  2. Cagan's four risks plus an OST-style assumption list ranked by risk. This drives story ordering: the riskiest assumption is tested in story 01 or 02, next to the walking skeleton.
  3. A JTBD job statement or impact map line (goal, actor, behaviour change). It gives each story a "why" and a measurable signal.
  4. A glossary (ubiquitous language). It costs little, is durable across epics and reduces naming drift in generated code.
  5. A PR/FAQ, only for new products or major features. The internal FAQ half is a good template for viability and feasibility questions.
  6. Lean Canvas: low value inside a coding agent. It targets startup business models (channels, revenue, unfair advantage) and is mostly non-actionable for story writing.
  7. Event storming as a full workshop is not feasible for a single agent. A light "list the domain events and commands" pass is useful for backend and event-driven work.
- All of these are lenses, not documents to generate in full. An agent should fill in only the fields that change the plan.

### Gaps
- I found no empirical comparison of these frameworks' effect on downstream delivery quality, human or AI. The ranking above is reasoned, not measured.
- Lean Canvas was not researched further (Ash Maurya, leanstack.com).

---

## 2. How AI tools and teams do discovery with agents

### Takeaway
The dominant 2025-2026 pattern is a staged pipeline: an analyst or interviewer agent, then a brief, then a PRD or spec, then architecture, then stories. Three points stand out:
- An interview step in which the AI questions the human ("grill me", spec-kit `/clarify`) measurably improves results on underspecified tasks.
- A persistent project-level context file sits under every feature (spec-kit constitution, Kiro steering `product.md`).
- Deep-research agents are used for market and competitor scans, but their citation accuracy is only 40-80%, so their claims must be verified.

### Cited Findings
- **BMAD Method (v4, 2025)**:
  - The Analyst agent ("Mary") works in three modes: brainstorming, deep research and project briefing.
  - `create-project-brief` asks about concept, audience, key features and success metrics, and writes `docs/project-brief.md`.
  - The Analyst writes a handoff prompt for the PM covering key insights and areas needing attention.
  - The PM writes the PRD from the brief (fast track), or runs a longer interactive session when there is no brief. The PRD includes functional and non-functional requirements, epics and stories.
  - Then Architect.
  - — [BMAD user guide v4.43.1 (npm mirror)](https://cdn.jsdelivr.net/npm/@ptnglobal/bmad-method@4.43.1/docs/user-guide.md); [tessl registry: BMAD planning phase](https://tessl.io/registry/tessl/npm-bmad-method/files/docs/guides/planning-phase.md). These are mirrors, and command names vary by version.
- **GitHub Spec Kit** (open source, MIT):
  - Pipeline: `constitution` → `specify` (what/why, PRD-like) → `clarify` (asks targeted questions about ambiguous or underspecified parts) → `plan` → `tasks` → `analyze` → `implement`.
  - The constitution lives in `.specify/memory/constitution.md` and applies to every feature.
  - — [context7 index of github/spec-kit](https://context7.com/github/spec-kit); [DEV deep dive](https://dev.to/x4nent/github-spec-kit-deep-dive-spec-driven-development-the-constitution-speckit-slash-commands-1m71). Third-party write-ups; the repository is primary: https://github.com/github/spec-kit (not re-fetched).
- **Kiro (AWS) steering files**:
  - `.kiro/steering/product.md` holds purpose, target users, key features and business objectives. `tech.md` holds stack and constraints. `structure.md` holds layout, naming and architecture decisions.
  - They can be auto-generated with "Generate Steering Docs".
  - Workspace steering is per repo, global steering lives in `~/.kiro/steering/`. AGENTS.md is always included.
  - — [Kiro docs, Steering](https://kiro.dev/docs/steering/); [Kiro blog, global steering](https://kiro.dev/blog/stop-repeating-yourself/)
- **Matt Pocock "grill-me"**:
  - The skill reverses the interview: the AI interrogates the human, walking through every aspect of the plan, until there is shared understanding.
  - `/grill-with-docs` is a variant that leaves a written trail.
  - A separate skill turns the conversation into a PRD or spec: `/to-prd`, which a guide says was replaced by `/to-spec` in v1.1 (2026-07-08).
  - — [aihero.dev, grill-me](https://aihero.dev/skills-grill-me); [skills.sh grill-me](https://www.skills.sh/mattpocock/skills/grill-me); [skillselion map v1.1](https://skillselion.com/guide/matt-pocock-skills-map) (third-party; version history unverified)
- **Evidence that asking questions helps**:
  - Ambig-SWE (Vijayvargiya, Zhou, Yerukola, Sap, Neubig; arXiv 2502.13069, first posted 2025-02-18, ICLR 2026).
  - Models "struggle to distinguish between well-specified and underspecified instructions".
  - Interaction on underspecified inputs improves performance "up to 74% over the non-interactive settings".
  - — [arXiv 2502.13069](https://arxiv.org/abs/2502.13069)
- **Other ambiguity work, 2025**:
  - Agent-based detection and resolution of incompleteness and ambiguity adds little when the input already has enough context. — [arXiv 2507.03726](https://arxiv.org/pdf/2507.03726)
  - Debate between models to decide whether to ask one clarifying question. — [arXiv 2507.12370](https://arxiv.org/pdf/2507.12370)
  - ECLAIR: multi-agent, domain-aware ambiguity detection for enterprise use. — [arXiv 2503.20791](https://web3.arxiv.org/pdf/2503.20791)
  - SAGE-Agent (Nov 2025): structured uncertainty gives better coverage with fewer clarifying questions. — [arXiv 2511.08798](https://www.arxiv.org/pdf/2511.08798)
- **Deep-research citation reliability**:
  - DeepTRACE (arXiv 2509.04499, Sep 2025; ICLR 2026 poster) audits public deep-research modes.
  - Citation accuracy ranges from about 40% to 80%: GPT-5 Deep Research 79.1%, Gemini deep research 40.3%.
  - A large share of statements are unsupported by the sources listed, and answers stay one-sided on debate questions.
  - — [arXiv 2509.04499](https://arxiv.org/pdf/2509.04499); [ICLR 2026](https://iclr.cc/virtual/2026/poster/10009560). Figures come via an emergentmind summary and should be checked in the paper.
  - LiveResearchBench / DeepEval (arXiv 2510.14240, Oct 2025) covers 17 systems. Single-agent deep research (for example o3 Deep Research) shows more uncited or unsupported claims, and multi-agent systems score better on citation association. — [emergentmind summary](https://www.emergentmind.com/articles/2510.14240) (secondary)
  - An Oppo FINDER/DEFT study reportedly found that about 20% of errors were fabricated content. — [The Decoder](https://the-decoder.com/ai-research-agents-would-rather-make-up-facts-than-say-i-dont-know/) (secondary news, weak)
- **Teresa Torres on AI**:
  - Synthetic interview snapshots summarize "pretend people" and teach nothing about real customers.
  - AI should be "additive, not a replacement".
  - Cheap AI delivery makes discovery more critical, not less (Growth podcast, Aug 2025).
  - — [Product Talk, generative AI and discovery](https://www.producttalk.org/generative-ai-discovery.md) (fetch timed out; content from search snippet); [Aakash Gupta podcast](https://www.news.aakashg.com/p/teresa-torres-podcast)

### Inferences
- /flow-plan's existing "Clarify First" step matches the strongest evidence (Ambig-SWE). Two improvements:
  - Make the check for underspecification explicit, since models are bad at noticing it on their own. For example, use a checklist of required brief fields; a missing field triggers a question.
  - Cap the number of questions (SAGE-Agent result).
- Product context should live in a persistent file like Kiro's `product.md` or the spec-kit constitution, not be regenerated per epic. `docs/project-context.md` is the natural home, or a sibling `docs/product.md`.
- With 40-80% citation accuracy, web research in /flow-plan needs a verification pass. Every external claim gets a URL, a quoted supporting snippet and a retrieval date, and claims without a quote are moved to "Assumptions".

### Gaps
- ChatPRD, Productboard AI and Linear AI were not researched (budget). I have no sourced detail on how they cite sources or separate facts from assumptions.
- Anthropic's, OpenAI's and Perplexity's own documentation on deep-research citation behaviour was not fetched.

---

## 3. Evidence and failure modes of LLM-generated requirements and personas

### Takeaway
Research on LLMs for requirements engineering is booming but mostly lab-evaluated. Synthetic personas have weak validity, and peer-reviewed audits say they must be grounded in real data and labelled as such. Generic PRDs, invented market numbers and over-optimism are the typical failures.

### Cited Findings
- **Zadenoori, Dąbrowski, Alhoshan, Zhao, Ferrari**, "LLMs for Requirements Engineering: A Systematic Literature Review" (arXiv 2509.11446, 2025-09-14): 74 primary studies from 2023-2024.
  - Focus has shifted to elicitation and validation, away from defect detection and classification.
  - The studies mostly use GPT models with zero- or few-shot prompting.
  - Evaluation happens mostly in controlled settings, with limited industry use and little integration into complex workflows.
  - The authors call it a preliminary study without cross-checking.
  - — [arXiv 2509.11446](https://arxiv.org/abs/2509.11446)
- A 2025 Tampere thesis reviews 58 studies on prompting strategies for LLM requirements elicitation (PRISMA 2020). — [trepo.tuni.fi](https://trepo.tuni.fi/handle/10024/232320) (thesis, medium weight)
- An MDPI Information mapping study covers 74 studies on automated elicitation from 2021-2025. Fine-tuned transformer encoders set the performance ceiling for elicitation tasks. — [citedrive listing, DOI 10.3390/info17080777](https://www.citedrive.com/en/discovery/automated-software-requirements-elicitation-a-systematic-mapping-study/) (only the abstract was seen)
- **Batzner et al., "Whose Personae?"** (AAAI/ACM AIES 2025; arXiv 2512.00461) reviewed 63 papers from 2023-2025 that use synthetic personas.
  - Ecological validity is weak.
  - Only 35% of the studies discussed whether their personas were representative.
  - The authors propose a transparency checklist: representative sampling, grounding in empirical data, ecological validity.
  - — [arXiv 2512.00461](https://arxiv.org/pdf/2512.00461); [AIES proceedings](https://ojs.aaai.org/index.php/AIES/article/view/36553)
- **Salminen et al. (2025)** call synthetic users "an imitation of user research" because no real participants are involved. They are promoted for convenience, while user research aims for depth. — [Univ. of Vaasa repository](https://osuva.uwasa.fi/server/api/core/bitstreams/d457c50b-3a06-495b-8dd1-36261ca69a70/content)
- Practitioner reports describe an over-optimism bias in LLM synthetic users. — [UX Collective](https://uxdesign.cc/are-synthetic-users-really-the-future-of-ux-research-fd76fcb479ec) (practitioner opinion, weak)
  - A claim that the sign of synthetic-vs-real effects "flipped 32% of the time" could not be traced to a primary source, so it is excluded.
- Deep-research fabrication and unsupported-claim rates: see section 2 (DeepTRACE).

### Inferences
- **Failure modes for /flow-plan to guard against:**
  1. Invented personas or "users want X" claims with no source.
  2. Market sizes and competitor features hallucinated or cited to pages that do not support them.
  3. Generic PRD boilerplate: every product gets "fast, secure, intuitive".
  4. Over-optimistic value assumptions.
  5. The model failing to notice that the request is underspecified.
- **Mitigation pattern** (synthesised from Batzner's checklist, DeepTRACE and Torres). Every product claim in the brief is tagged with its provenance:
  - `user-stated`: the human said it in this session;
  - `repo-observed`: code, docs, issues or analytics found in the repo, with a path;
  - `web-sourced`: URL, quote and date;
  - `assumption`: with a confidence level and the risk type it belongs to.
  - Personas may only be `user-stated` or `repo-observed`. An agent should never generate a persona from nothing; it can propose "persona hypotheses" tagged `assumption`.

### Gaps
- I found no study measuring how often coding-agent planning tools (BMAD, spec-kit) produce hallucinated requirements.
- No quantitative data on the "generic PRD" problem; the evidence is anecdotal.

---

## 4. Making product context durable and reusable across epics

### Takeaway
2025-2026 tools converge on a small set of always-loaded or on-demand project files: product, tech, structure, constitution or rules, and AGENTS.md. Feature specs reference these files instead of restating them. Keeping the files current is mostly manual. The patterns that help are scoped inclusion, generating the files from the codebase, and short files that point to sources.

### Cited Findings
- Kiro: `product.md`, `tech.md` and `structure.md` are generated from the repo and can be global or workspace-scoped. Custom steering files can be scoped instead of always included, while AGENTS.md is always included. — [Kiro docs](https://kiro.dev/docs/steering/)
- Spec Kit: `constitution.md` is seeded once by `specify init` and applies to every feature spec. — [DEV deep dive](https://dev.to/x4nent/github-spec-kit-deep-dive-spec-driven-development-the-constitution-speckit-slash-commands-1m71) (third-party)
- BMAD: `docs/project-brief.md` comes before the PRD and architecture documents, and a fast-track PRD is produced when the brief exists. — [BMAD user guide](https://cdn.jsdelivr.net/npm/@ptnglobal/bmad-method@4.43.1/docs/user-guide.md)
- Game GDDs are described as "living documents" that record why each choice was made and which alternatives were considered. — [Wayline, game design fundamentals](https://www.wayline.io/learn/game-design/3) (practitioner)
- Architecture Decision Records (Michael Nygard, 2011): short, immutable decision records with Context, Decision and Consequences. — [cognitect.com blog](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) (not re-fetched)

### Inferences
- **Proposed layering for Coding Flow** (design suggestion):
  - **Durable product layer** (`docs/product.md`, or a section in `project-context.md`):
    - vision in one paragraph;
    - users and actors (human or system);
    - jobs and outcomes;
    - success metrics;
    - non-goals;
    - glossary;
    - known competitors or alternatives, with sources and dates.
  - **Assumption register**: id, statement, risk type (value, usability, feasibility, viability), confidence, evidence, status, last checked. Epics reference assumption ids.
  - **Per-epic `index.md`**: links to the product facts it relies on and lists only epic-specific assumptions.
- **Staleness controls**:
  - Put a `last_verified` date on each web-sourced fact.
  - /flow-plan re-checks facts older than N months only when an epic depends on them.
  - Closing an epic updates the assumption statuses (validated or invalidated), which mirrors the OST assumption-test loop.
- This complements the existing RULES.md boundary ("project-context.md is a state map, not a journal"). Assumption history belongs in the register or in the Decisions section of `plan.md`, not in the context map.

### Gaps
- I found no primary-source evidence on how teams keep steering or constitution files fresh in practice, or how badly stale context hurts agent output. The guidance above is inferred.

---

## 5. How to scope: non-goals, appetite, assumptions with confidence, riskiest assumption first, measurable success

### Takeaway
Combine:
- Shape Up's appetite and no-gos (scope as a fixed time or effort budget);
- Torres and Cagan's riskiest-assumption-first (ordering);
- impact mapping or JTBD outcomes (measurable success).

The walking-skeleton story should also be the cheapest test of the riskiest assumption.

### Cited Findings
- Appetite is a constraint chosen before the solution. No-gos and rabbit holes are written explicitly into the pitch. — [Shape Up ch. 6](https://basecamp.com/shapeup/1.5-chapter-06)
- Assumptions are typed by risk and tested starting with the riskiest. — [SVPG four risks](https://www.svpg.com/four-big-risks/); [Product Talk OST](https://www.producttalk.org/opportunity-solution-trees/) (canonical, not re-fetched)
- Impact mapping ties deliverables to measurable behaviour changes of actors. — [impactmapping.org](https://www.impactmapping.org/) (not re-fetched)
- API developer-experience metrics such as "time to first call". — [Nordic APIs](https://nordicapis.com/why-api-developer-experience-matters-more-than-ever/) (practitioner)
- Game success test: "a first-time player can explain their strategy in 30 seconds without prompting". — [Wayline postmortem](https://www.wayline.io/blog/ten-playtesters-one-core-loop-prototype-postmortem) (single developer anecdote, weak)

### Inferences
- **Minimum scoping block for each epic `index.md`:**
  - Problem: one concrete story.
  - Outcome metric: how we will know, with a target or an observable signal.
  - Appetite: number of stories or days.
  - Non-goals.
  - Rabbit holes.
  - Top 3 assumptions: risk type, confidence (low, medium or high), and the story that tests each one.
- Add an INVEST-like check: "the riskiest assumption is exercised by story ≤ 02".
- Success criteria must be checkable. Prefer behavioural or operational signals that the codebase can emit or tests can assert (latency, error rate, a CLI exit code, time to first call) over vanity metrics.

### Gaps
- No empirical data on whether appetite-based scoping improves agent-run delivery.

---

## 6. Beyond web/SaaS: who the "user" is and what discovery looks like per project type (scope addition)

### Takeaway
Most named frameworks were born in web/SaaS product management:
- strongly web/SaaS: Lean Canvas, PR/FAQ in its customer-launch form, Cagan's viability framing, OST with continuous interviews;
- moderately web/SaaS: story mapping, which assumes a UI-driven journey.

The ideas that transfer to every project type are:
- name the actor (human or system);
- state the job or outcome;
- set appetite and no-gos;
- rank assumptions by risk;
- maintain a glossary;
- build the earliest end-to-end proof.

The "user" and the discovery method change by domain.

### Cited Findings
- **Games**:
  - Games "live and die" by their core loop.
  - Design pillars are 3-5 high-level values set early.
  - Prototype the core loop with placeholder assets before investing in final art, and playtest by watching players without helping them, in a repeating loop.
  - The GDD is a living document.
  - — [Game Developer (Gamasutra), core loops and prototyping](https://www.gamasutra.com:443/design/how-supporting-core-loops-and-early-prototyping-are-key-to-your-game-s-success); [Wayline](https://www.wayline.io/blog/rpg-500-spells-prototype-fast); [Justin Gary, Loops and tension](https://justingarydesign.substack.com/p/loops-and-tension)
  - Practitioner sources only. The "find the fun" attribution to Miyamoto is unverified.
- **APIs, SDKs and backends**:
  - Design-first means reviewing the OpenAPI, GraphQL or gRPC contract with consumers before implementation, from the outside in.
  - Discovery is the first friction point for consumers.
  - Measure time to first call.
  - Hold frequent provider-consumer feedback loops.
  - — [Solita](https://www.solita.fi/blogs/how-api-design-first-can-provide-good-developer-experience); [VMware Tanzu Labs, API as product](https://blogs.vmware.com/tanzu/principles-of-designing-and-developing-an-api-product/); [Nordic APIs](https://nordicapis.com/why-api-developer-experience-matters-more-than-ever/) (practitioner)
- **Event storming / DDD**: domain events and bounded contexts apply directly to backends and distributed services. — [eventstorming.com](https://www.eventstorming.com/) (not re-fetched)
- No sources were found this session for networking/protocols, embedded, data/ML or CLI-specific discovery. The inferences below for those types are unsourced.

### Inferences
| Project type | Who the "user" is | What discovery looks like | Frameworks that transfer | Success signals |
|---|---|---|---|---|
| Backend service / API | Consuming developers and services; operators (SRE) | Consumer interviews, existing call patterns (logs), contract-first review (OpenAPI/proto), error-case catalogue | JTBD for the consumer, event storming/DDD, four risks (feasibility and operability dominate), appetite | Time to first call, p99 latency, error budget, contract-test pass |
| Library / SDK | Developers who integrate it | Read the issue tracker and Stack Overflow, write the README or usage example first (a "working backwards" README), API ergonomics review | PR/FAQ adapted as "README first", glossary, no-gos (supported versions and platforms) | Lines to hello world, breaking-change count, adoption |
| CLI / dev tool | Developers and CI pipelines | Write the `--help` and example sessions first, scripting and exit-code needs, non-interactive use | JTBD, story mapping over command flows, appetite | Commands per task, scriptability, exit codes |
| Networking / protocol | Peer implementations, operators, network conditions | Spec and RFC reading, interop matrix, failure and adversarial cases (latency, partitions) | Four risks (feasibility and security), assumption register, glossary of protocol terms | Interop tests passing, conformance suite, throughput or latency |
| Game | Players (by segment), plus designers and modders | Core loop and pillars, paper or greybox prototype, playtests (observe, don't explain) | Appetite, riskiest assumption first (is the loop fun?), walking skeleton = playable core loop; GDD as the durable context | Playtest observations, retention proxies, "explain the strategy" test |
| Embedded | Device operators, end users, hardware constraints, certification bodies | Hardware datasheets, power, memory and timing budgets, safety and regulatory requirements | Four risks (feasibility dominates), non-goals, assumption register | Timing and power budgets met, HIL tests |
| Data / ML | Downstream consumers of predictions, labelers, decision-makers | Baseline and data availability audit, error-cost analysis, evaluation set first | Impact mapping (which decision changes), riskiest assumption = "is the data sufficient?" | Offline metric versus baseline, online business metric |
| Mobile / web app | End users | Interviews, analytics, usability tests | All frameworks, including OST, story mapping and PR/FAQ | Activation, task success |

- **Implications for /flow-plan:**
  - Replace "persona" with "actor", which can be a human, a service, a peer, a device or a player. This mirrors impact mapping's Actors and DDD's context map.
  - Make the Backbone journey type-aware: a user journey for apps, a request lifecycle for backends, a command flow for CLIs, a core loop for games, a data pipeline for ML, a handshake or state machine for protocols.
  - The walking skeleton becomes:
    - a playable greybox loop for games;
    - an end-to-end request through every layer for a backend;
    - a hello-world integration for an SDK;
    - two peers exchanging one message for a protocol.
  - Online research should be type-aware:
    - specs, RFCs and standards for protocols;
    - comparable libraries and their issue trackers for SDKs;
    - comparable games and reviews for games;
    - dataset and benchmark cards for ML.
    - Market-size research is relevant mainly to SaaS or consumer products and should be optional.
- **Web/SaaS-specific frameworks or parts:** Lean Canvas (revenue, channels, CAC), PR/FAQ in its customer-launch form, OST continuous interviewing (needs reachable customers), and conversion and activation metrics. These should be optional modules, not defaults.

### Gaps
- No primary or peer-reviewed sources were found on discovery practice for protocols, embedded, data/ML or CLIs. That part of the table is reasoned from general engineering practice.
- No authoritative source on Stripe or other API-review processes (the search returned none).
- No academic evidence on LLM agents doing discovery in non-web domains, such as game design assistants or protocol requirement extraction.
