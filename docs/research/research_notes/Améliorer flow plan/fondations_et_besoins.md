# Foundations and needs inventory for /flow-plan, for any project type (2025-2026)

Scope: what a planning step should decide once, up front, per project type, so that stories written later by agents stay consistent; and how agents keep those decisions applied. Research date: 2026-11-13.

Source legend: **[fetched]** = page read during this session. **[ref]** = canonical, well-known reference cited from prior knowledge and not re-fetched this session. Check [ref] items before quoting exact wording or versions.

---

## Q1. Foundations by project type: the smallest artifact that pays off, and how a machine checks it

### Takeaway
Every project type has one "contract surface" that later stories must not drift from: UI tokens and components, the API schema, the data model, the wire protocol, the public API of a library, the CLI interface, the game's core loop, or the hardware budget. The minimum viable foundation is that one surface, written in a machine-checkable format where one exists (DESIGN.md tokens, OpenAPI/proto, migration files, semver-checked API, a CLI help snapshot), plus one CI command that fails when it drifts. Prose-only foundations are the weakest option. The 2026 evidence from Atlassian shows a large always-loaded design file costing about 92% more tokens than on-demand tooling.

### Cited Findings

**UI apps (web, mobile, desktop, game UI)**
- DESIGN.md (Google Labs / Stitch) is an open format. It pairs YAML front-matter tokens (`colors`, `typography`, `rounded`, `spacing`, `components`) with markdown prose. Its sections run in a fixed order: Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts. Every section is optional, but the ones present must keep that order. Tokens are normative and the prose is context. Version is "alpha", and the spec, schema and CLI are still in active development. — [google-labs-code/design.md](https://github.com/google-labs-code/design.md) [fetched]
- Mechanical check: `npx @google/design.md lint DESIGN.md` exits 1 on errors. Rules include `broken-ref` (error), `contrast-ratio` (warning below WCAG AA 4.5:1), `missing-primary`, `orphaned-tokens` and `section-order`. `diff` exits 1 when tokens regress. `export --format` writes `css-tailwind`, `json-tailwind` or `dtcg` (W3C design-tokens format). — [google-labs-code/design.md](https://github.com/google-labs-code/design.md) [fetched]
- Google open-sourced the format on 2026-04-21. — [Google blog](https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-design-md/) (date as reported by search results; the page itself was not fetched)
- Atlassian (2026-06-15) tested DESIGN.md in practice. In a one-shot Figma Make demo it moved output "from generic 'slop' to something recognizably Atlassian". In a production login-screen task, DESIGN.md alone averaged 7.21M tokens, 6m46s and 45.3 turns, against 3.75M / 5m01s / 35.1 for their design-system MCP and 4.20M / 6m19s / 43 with no context. That is about 92% more tokens than the MCP. Their file is 80 KB (about 19.8k tokens) and is always loaded. It also pushed agents to *recreate* components instead of importing shared ones. Atlassian states the results are "not conclusive" and "not a research paper". Their conclusion is that DESIGN.md suits art direction, prototyping and theming, and is "not a replacement for richer design system tooling". — [Atlassian blog](https://www.atlassian.com/blog/how-we-build/atlassians-design-md-is-here-what-we-learned-testing-portable-design-context-in-practice) [fetched]
- Practitioner consensus (2026, mostly vendor and practitioner blogs, so weak evidence) is that agents break design systems when they generate UI without access to the real components, tokens and usage rules. A shadcn `components.json` can point to a team registry (a `registries` block) so that installs pull team components, and the shadcn MCP lets the agent look up component docs and props live. zeroheight's Design Systems Report 2026, as quoted second-hand, says 86% of design systems have tokens but only 40% have token automation. — [13labs guide](https://www.13labs.au/guides/ai-ui-that-doesnt-look-ai-generated), [21st.dev](https://21st.dev/blog/why-agents-invent-components), [dev.to shadcn + Claude Code](https://dev.to/_46ea277e677b888e0cd13/shadcnui-claude-code-3-settings-that-fix-ai-generated-ui-quality-2dea) (search snippets, not fetched)
- Atlassian defines "slop" as output that "may be functional, but lacks any real visual identity or intentional design decisions". One essay separates *rule adherence* (respecting tokens) from *coherence* (unity of intent) and argues that tokens alone do not give coherence. — [Atlassian](https://www.atlassian.com/blog/how-we-build/atlassians-design-md-is-here-what-we-learned-testing-portable-design-context-in-practice) [fetched]; [braindetox essay](https://braindetox.kr/en/posts/ai_generated_ui_coherence_2026.html) (snippet)
- Minimum viable: a short DESIGN.md (tokens plus a Do's/Don'ts section listing what is forbidden: second accent colour, gradients, arbitrary hex values), the component library the project already uses, and a "reuse before create" rule. Checks: `design.md lint`, a lint banning raw colour or pixel literals outside the token file, and axe/Lighthouse for accessibility. [inference; BeThl's own memory rules (single accent, shadcn-first, visible separators) are an instance of this "Do's and Don'ts" layer]

**APIs and services**
- Schema-first contracts can be checked mechanically for breakage. `buf breaking --against '.git#branch=main'` compares protobuf against a git baseline. `oasdiff breaking base.yaml head.yaml --fail-on ERR` detects 100+ kinds of breaking change in OpenAPI and fails only on ERR-level ones. — [buf docs](https://buf.build/docs/bsr/policy-checks/breaking/overview), [oasdiff BREAKING-CHANGES](https://github.com/tufin/oasdiff/blob/v1.10.16/BREAKING-CHANGES.md), [dev.to guide](https://dev.to/hassann/how-to-diff-openapi-specs-and-block-breaking-changes-in-ci-3a4p) (search results; the flags come from secondary guides and should be checked against the upstream READMEs)
- Standard error model: RFC 9457 "Problem Details for HTTP APIs" (2023, obsoletes RFC 7807) defines `type`, `title`, `status`, `detail` and `instance`. — [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) [ref]
- Other schema-first formats: AsyncAPI 3.x for event and message APIs, GraphQL SDL with breaking-change diff (e.g. graphql-inspector), and contract tests between consumer and provider (Pact). — [asyncapi.com](https://www.asyncapi.com/docs), [pact.io](https://docs.pact.io/) [ref]
- spec-kit's plan template has an "Integration-First Gate" that asks "Contracts defined?" and "Contract tests written?", and its constitution says "Contract tests mandatory before implementation". — [spec-kit spec-driven.md](https://github.com/github/spec-kit/blob/main/spec-driven.md) [fetched]
- Minimum viable: one schema file (OpenAPI/proto/SDL/AsyncAPI), one error shape (Problem Details or the gRPC status model), a versioning rule (URL `/v1`, header, or package version for proto), and pagination and idempotency conventions. Check with a breaking-change diff in CI plus a schema lint (Spectral or `buf lint`). [inference]

**Data model and migrations (any project with persistence)**
- No new source was fetched. Known tools for versioned, reviewable migrations: Flyway/Liquibase (JVM), Alembic (Python), golang-migrate/Atlas (Go), sqlx/diesel/refinery (Rust), EF Core migrations (C#), Prisma/Drizzle (TS). Atlas and squawk lint migrations for destructive or locking changes. [ref, unverified versions]
- Minimum viable: decide the source of truth (migrations vs. ORM schema), the expand/contract rule for breaking changes, ID strategy, timestamps/timezone (UTC), soft-delete policy and money type. Check with a migration lint and "migrate up from empty plus run tests" in CI. [inference]

**Networking and protocols**
- No 2026 source fetched. Conventional practice: an RFC-style spec using BCP 14 keywords (RFC 2119/8174 MUST/SHOULD) — [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174) [ref]; a wire format in a schema language (protobuf, Cap'n Proto, ASN.1, Kaitai Struct for binary layouts); an explicit state machine (states × events table); and fuzzing of parsers (libFuzzer, AFL++, cargo-fuzz, Go native fuzzing since 1.18, OSS-Fuzz) — [OSS-Fuzz](https://google.github.io/oss-fuzz/) [ref].
- Minimum viable: one page with message types, framing, versioning/negotiation and the state table, plus conformance test vectors (golden byte files). Checks: test vectors in CI, and a fuzz target per parser run for a short time in CI. [inference]

**Libraries and SDKs**
- SemVer 2.0.0: once the public API is declared, MAJOR is for incompatible changes. "Declare a public API" is rule 1. — [semver.org](https://semver.org/) [ref]
- Mechanical public-API checks per language: cargo-semver-checks (Rust), `apidiff`/`gorelease` (Go), japicmp/revapi (Java), Microsoft API Compatibility / PublicApiAnalyzers (C#), api-extractor (TS), griffe `check` (Python), abi-compliance-checker / libabigail (C/C++ ABI). [ref, unverified]
- Minimum viable: list the exported surface (or a snapshot file of it), choose the semver policy and minimum supported runtime (MSRV, Python, JDK…), and run an API-diff check in CI. [inference]

**CLIs**
- clig.dev's decide-once rules: primary output to stdout and messages to stderr; `--json`/`--plain` for machines; exit 0 on success and non-zero on failure, mapped to important failure modes; "Prefer flags to args"; full help on `-h/--help`; config precedence flags > env > project config > user config > system (XDG); respect `NO_COLOR`; prompt only when stdin is a TTY and offer `--no-input`; never put secrets in flags or env vars; treat subcommands, flags, config, env vars and output formats as a public interface ("Keep changes additive where you can"); no catch-all subcommand; consistent `noun verb` naming. — [clig.dev](https://clig.dev/) [fetched]
- Minimum viable: a command tree, the exit-code table, the JSON output rule and the config precedence order. Checks: snapshot tests of `--help` and `--json` output (e.g. insta, syrupy, golden files) so interface drift fails CI. [inference]

**Games**
- One-page GDD (Stone Librande's approach, promoted by Unity) is a working tool, not a contract. It holds the pitch, pillars, core loop "in three or four verbs" (e.g. "Fly, collect, dodge, repeat"), key mechanic, look and feel, and platform. — [Unity blog](https://unity.com/blog/one-page-game-design-document) (search snippet)
- Greybox: an art-free prototype to test control feel and the core loop. Vertical slice: a section that "looks, sounds, and plays like the final game"; if it fails, do not enter full production. — [StraySpark 2026](https://www.strayspark.studio/blog/game-design-document-template-indie-developers-2026), [Wayline](https://www.wayline.io/blog/best-workflow-game-design-documentation) (snippets, practitioner level)
- Engine conventions (Unity/Godot/Unreal folder layout, scene/prefab naming, physics tick, input map) are project-specific. I found no authoritative cross-engine source. [gap]
- Minimum viable: core loop verbs, 3 pillars, out-of-scope list, target platform and frame budget (e.g. 60 fps = 16.6 ms), engine version pinned. Mechanical checks are weak here; the real check is playtesting. Partial automated checks: engine headless tests (Godot GUT/gdUnit, Unity Test Framework) and frame-time capture. [inference]

**Embedded**
- No 2026 source fetched. Conventional decide-once items: target MCU and toolchain version, RAM/flash budget, real-time deadlines, dynamic allocation policy (often banned after init, MISRA C:2023), HAL boundary, interrupt rules. Checks: linker map size check in CI (fail if `.text`/`.data` exceed budget), MISRA/cppcheck/clang-tidy, host-side unit tests against the HAL (Unity/CMock/Ceedling), HIL tests where available. [ref/inference, unverified]

**Data / ML pipelines**
- No source fetched. Typical up-front decisions: data contracts and schemas (e.g. Great Expectations / pandera / dbt tests), dataset versioning (DVC, lakeFS), reproducibility (seeds, pinned env), evaluation metric and baseline. Check: schema tests on every pipeline stage and an eval threshold in CI. [ref/inference]

### Inferences
- The same structure fits every type: one **contract artifact** plus one **drift check**. /flow-plan could ask a single question, "what is this project's public surface?", and map the answer to a small table (type → artifact → check command) instead of shipping templates per type.
- Story 01, the walking skeleton, is a natural place to *create* the contract artifact and wire its check into `validation.quality`, so that every later story inherits a red light instead of a paragraph of prose.
- Prefer formats that already have a linter or differ (DESIGN.md, OpenAPI, proto, migration files, API snapshots). A foundation with no check depends on the agent reading it, and the AGENTS.md evidence in Q4 shows reading is costly and only modestly useful.
- For UI, the Atlassian data favours on-demand context (MCP/registry/skill) over a big always-loaded file. A *short* DESIGN.md (tokens plus don'ts) together with an existing component library is likely the sweet spot for a solo or small team; the size figure is my inference.

### Gaps
- No primary source evaluating game GDDs or engine conventions with agents. No indie postmortem retrieved.
- Embedded, data/ML and protocol sections rest on known references not re-fetched this session. Tool versions are unverified.
- The DESIGN.md release date (2026-04-21) comes from search results, not the fetched Google page.
- No independent (non-vendor) study shows a registry plus MCP measurably reducing "AI slop".

---

## Q2. Cross-cutting needs inventory (non-functional requirements) and what to decide at plan time vs. later

### Takeaway
Use a short, language-agnostic checklist of about 10 lines (security level, data sensitivity, observability, performance budget, reliability target, config and secrets, i18n, accessibility, packaging and deployment, testing strategy, licensing). Decide at plan time only the items that are expensive to retrofit: security level and auth model, data sensitivity, error and log format, config and secrets mechanism, i18n yes/no, accessibility target, and the testing strategy per layer. Defer concrete numbers such as SLO targets and performance budgets until the walking skeleton can measure them, but reserve the hook (a metrics endpoint, a benchmark harness) in story 01.

### Cited Findings
- OWASP ASVS 5.0.0 is the current stable release, published 30 May 2025. It serves as a metric, as guidance and in procurement. — [asvs.owasp.org](https://asvs.owasp.org/) [fetched]. The level definitions were not on that page. From the standard [ref]: L1 is the baseline / low assurance, L2 is the recommended level for most applications handling sensitive data, L3 is for critical applications. Check the exact 5.0 wording before quoting it.
- Threat modelling lite: STRIDE (Spoofing, Tampering, Repudiation, Information disclosure, DoS, Elevation of privilege) and the Threat Modeling Manifesto's four questions ("What are we working on? What can go wrong? What are we going to do about it? Did we do a good enough job?"). — [threatmodelingmanifesto.org](https://www.threatmodelingmanifesto.org/) [ref]
- Observability: OpenTelemetry is the vendor-neutral standard for traces, metrics and logs, with semantic conventions for attribute names. — [opentelemetry.io](https://opentelemetry.io/docs/) [ref]
- Reliability: SLOs/SLIs and error budgets from the Google SRE book and workbook. — [sre.google workbook](https://sre.google/workbook/implementing-slos/) [ref]
- Config and secrets: 12-factor rule III, "Store config in the environment". — [12factor.net](https://12factor.net/config) [ref]. For CLIs, clig.dev says *the opposite* for secrets: "Do not read secrets from environment variables" (prefer files or stdin). — [clig.dev](https://clig.dev/) [fetched]. These two conflict, so the right answer depends on the project type.
- Quality models: ISO/IEC 25010:2023 product quality characteristics (functional suitability, performance efficiency, compatibility, interaction capability (formerly usability), reliability, security, maintainability, flexibility (formerly portability), safety). — [iso25000.com](https://iso25000.com/index.php/en/iso-25000-standards/iso-25010) [ref; the 2023 renames are from memory, verify]. arc42 chapter 10 expresses quality requirements as concrete *quality scenarios* (stimulus → response → measure). — [arc42 quality](https://docs.arc42.org/section-10/) [ref]. AWS Well-Architected has six pillars: operational excellence, security, reliability, performance efficiency, cost optimization, sustainability. — [AWS WA](https://docs.aws.amazon.com/wellarchitected/latest/framework/the-pillars-of-the-framework.html) [ref]
- spec-kit's constitution template leaves Articles IV–VI for the project to fill, with placeholders such as integration testing, observability, versioning and breaking changes. — [spec-kit spec-driven.md](https://github.com/github/spec-kit/blob/main/spec-driven.md) [fetched]
- Testing strategy per type [ref/inference]: test pyramid for services; contract tests (Pact or schema diff) at service boundaries; property-based tests (Hypothesis, proptest, fast-check, jqwik, FsCheck, Go `testing/quick`/rapid) for pure logic and parsers; fuzzing for parsers and protocols; golden or snapshot tests for CLIs and codegen; HIL for embedded; playtesting for games; eval sets for ML.
- Licensing and dependencies: cargo-deny (licenses, advisories, bans, sources) for Rust; equivalents are `pip-licenses`/pip-audit, `go-licenses`/govulncheck, OWASP Dependency-Check, `license-checker` for npm. [ref]

**Plan-time vs. deferred (proposed split, my inference grounded in the sources above)**

| Item | Decide at plan time (cheap now, costly later) | Defer until the skeleton can measure it | Applies to |
|---|---|---|---|
| Security | ASVS level (L1/L2/L3), auth model, data sensitivity class, STRIDE pass on the trust boundaries only | Per-endpoint controls | services, web, mobile; L1 + input fuzzing for CLIs/libs |
| Observability | log format (structured JSON), correlation/trace id, OTel yes/no | dashboards, alert thresholds | services, pipelines; CLIs: `--verbose` + stderr only |
| Performance | which metric matters (p95 latency, fps, RAM, binary size, throughput) | numeric budget after first measurement | all |
| Reliability | is there an SLO at all? idempotency/retry policy | SLO numbers, error budget | services |
| Config/secrets | mechanism and precedence, where secrets live | specific keys | all (different answers for CLI vs. service) |
| i18n | yes/no, default locale, string externalisation | translations | UI, CLIs with user text |
| Accessibility | target (WCAG 2.2 AA) | per-screen audits | UI only |
| Packaging/deploy | artefact type (container, binary, wheel, crate, store app, firmware image), supported platforms | infra sizing | all |
| Testing | layers + tools + where fuzz/property/contract tests are mandatory | coverage numbers | all |
| Licensing | project licence, banned dependency licences | — | all, critical for libraries |

### Inferences
- ISO 25010, arc42 ch. 10 and AWS WA are useful as *source lists* for the checklist but too heavy as templates. A 10-row table with "yes/no/N/A + one line" per row fits the "documentation someone will read" constraint.
- The arc42 quality-scenario form (stimulus → response → measure) is the lightest way to make an NFR testable and can become an acceptance criterion in a story directly.
- Each answered NFR row should, where possible, point to its check in `validation.quality` (e.g. ASVS level → semgrep/ZAP baseline; licences → cargo-deny; a11y → axe). Rows without a check are reminders for the reviewer.

### Gaps
- ASVS 5.0 level definitions not confirmed from the fetched page.
- No empirical source on which NFR decisions are most often retrofitted; the plan-time vs. deferred split is reasoned, not measured.
- ISO 25010:2023 characteristic names not verified this session.

---

## Q3. Light architecture decision capture and turning decisions into automated checks

### Takeaway
Nygard ADRs (Title, Context, Decision, Status, Consequences; "one or two pages"; numbered, never reused; superseded rather than deleted) or the bare-minimal MADR template are the lightest durable decision log. Decisions that can be expressed as rules should become fitness functions in CI: dependency and layer rules (ArchUnit, dependency-cruiser, import-linter, go-arch-lint, cargo-deny), API diff, size budgets. A decision that is checked by a machine survives agent sessions far better than prose.

### Cited Findings
- Nygard (2011): each ADR has Title, Context, Decision, Status, Consequences. "The whole document should be one or two pages long". Status runs proposed → accepted → deprecated/superseded, and old records stay and point to their replacement. Stored in the repo as `doc/arch/adr-NNN.md` with sequential numbers that are never reused. — [Cognitect blog](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) [fetched]
- MADR "bare-minimal" template: Title, Context and Problem Statement, Considered Options, Decision Outcome with Consequences. — [MADR template](https://github.com/adr/madr/blob/develop/template/adr-template-bare-minimal.md) [fetched]
- Fitness functions: "Fitness functions describe how close an architecture is to achieving an architectural aim". They should express the intent of an "-ility" as an objective metric. Start by picking the five or six most-valued attributes, write a few fitness functions in a test framework, add them as pipeline gates, and begin with simple cases (e.g. logs are parseable). — [Thoughtworks](https://www.thoughtworks.com/insights/articles/fitness-function-driven-development) [fetched]. Categories (atomic/holistic, triggered/continuous) come from *Building Evolutionary Architectures* (Ford, Parsons, Kua, Sadalage, 2nd ed. 2022). [ref, not on the fetched page]
- Language-specific architecture-rule tools [ref]: ArchUnit (Java/Kotlin; ArchUnitNET for C#), dependency-cruiser (JS/TS), import-linter (Python, "contracts" for layers and forbidden imports), go-arch-lint (Go), cargo-deny (Rust dependencies/licences) plus crate visibility, and for C/C++ CMake target boundaries with include-what-you-use. Also Konsist (Kotlin), NetArchTest (C#).
- C4 model: four levels (Context, Container, Component, Code). Most teams need only the first two. — [c4model.com](https://c4model.com/) [ref]
- arc42 has 12 sections. Several are optional for small systems, and the "arc42 by example" / lean use is common practice. — [arc42.org](https://arc42.org/overview) [ref]
- Coding Flow already stores story decisions in the `plan.md` Decisions section and keeps `docs/project-context.md` as a state map with a "decision summary". [observed in user's RULES.md for BeThl]

### Inferences
- Minimum viable for Coding Flow: no separate ADR folder by default. Keep project-level decisions as one-line entries in `project-context.md` ("Decision — why — check: `<command>` or 'review only'"), and promote to a Nygard/MADR file only when a decision has real alternatives worth recording. This keeps a single place to read.
- The most useful addition is a "check" column: whenever a foundation decision is expressible as a rule (layering, forbidden imports, API compatibility, size budget), /flow-plan should propose the tool for the detected stack and put the command into `validation.quality`. This turns decisions into fitness functions without new docs.
- C4 level 1–2 as a 10-line text or Mermaid diagram in `project-context.md` is enough; deeper levels go stale.

### Gaps
- No empirical data comparing ADR adoption with decision drift in agent-written code.
- Tool lists are from prior knowledge. Current maintenance status (e.g. go-arch-lint activity) not verified.

---

## Q4. How AI coding tools carry foundations, whether agents follow them, and detecting the stack

### Takeaway
Every major tool converges on a few always-loaded markdown files (Kiro `product.md`/`tech.md`/`structure.md`; spec-kit `constitution.md`; AGENTS.md; Cursor rules) plus conditional loading. The best 2026 evidence (ETH Zurich, ICLR 2026) shows agents *do* follow context files, but those files generally do *not* raise task success and add more than 20% inference cost, mainly because unnecessary requirements make tasks harder, and repo overviews don't help. The design lesson: keep always-on foundations minimal, scope the rest to file patterns or to the story, and enforce what matters through checks (spec-kit's plan gates, CI) rather than prose.

### Cited Findings
- Kiro steering: three foundation files in `.kiro/steering/`. `product.md` covers purpose, users, features and objectives. `tech.md` covers frameworks, libraries, tools and technical constraints. `structure.md` covers file organisation, naming, imports and architectural decisions. All are "included in every interaction by default". Inclusion modes are `always`, `fileMatch` (with `fileMatchPattern`), `manual` (`#name`) and `auto` (matched on `description`). Guidance: "One domain per file", use conditional modes for context-heavy guidance, use `#[[file:...]]` to reference live files instead of copying, "Treat steering changes like code changes". AGENTS.md has no inclusion modes and is always included. — [kiro.dev/docs/steering](https://kiro.dev/docs/steering/) [fetched]
- spec-kit constitution (`memory/constitution.md`, "the architectural DNA of the system"), nine articles: Library-First; CLI Interface Mandate; Test-First ("NON-NEGOTIABLE"); IV–VI project-defined; VII Simplicity ("Maximum 3 projects for initial implementation"); VIII Anti-Abstraction ("Use framework features directly rather than wrapping them"); IX Integration-First ("Prefer real databases over mocks", "Contract tests mandatory before implementation"). It is enforced in the plan by "Phase -1: Pre-Implementation Gates" (Simplicity, Anti-Abstraction, Integration-First) described as "compile-time checks for architectural principles". Failures must be justified in a "Complexity Tracking" section. `/speckit.analyze` checks compliance. Only VII–IX have explicit gates. — [spec-kit spec-driven.md](https://github.com/github/spec-kit/blob/main/spec-driven.md) [fetched]
- ETH Zurich study "Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?" (Gloaguen, Mündler-Sasahara, Müller, Raychev, Vechev; arXiv 2602.11988, Feb 2026; ICLR 2026). Findings: "providing context files does not generally improve task success rates" and increases "inference cost by over 20% on average". This holds across LLMs and agents and for both LLM-generated and developer-written files. Agents follow the instructions well, but repository overviews are not helpful. — [arXiv 2602.11988](https://arxiv.org/abs/2602.11988) [fetched abstract]. Secondary summaries add that unnecessary requirements make tasks harder, that human-written files should list "only minimal requirements", and give a gain of up to about 4% for developer-written files and a 2–3% loss for LLM-generated ones. These figures were not verified in the paper itself. — [dev.to summary](https://dev.to/umesh_malik/agentsmd-files-dont-work-the-way-you-think-a-138-repo-study-proves-it-2k1g), [Upsun "less is more"](https://developer.upsun.com/posts/ai/agents-md-less-is-more) (snippets)
- The Atlassian DESIGN.md test (Q1) points the same way for design context: an always-loaded file cost more and did worse than on-demand MCP or skill context. — [Atlassian](https://www.atlassian.com/blog/how-we-build/atlassians-design-md-is-here-what-we-learned-testing-portable-design-context-in-practice) [fetched]
- AGENTS.md is an open convention (Linux Foundation / Agentic AI Foundation stewardship since late 2025) read by Codex, Cursor, Copilot, Jules and others. — [agents.md](https://agents.md/) [ref; stewardship date from memory, verify]. Cursor uses `.cursor/rules/*.mdc` with globs and always/auto/manual modes, mirroring Kiro. — [Cursor docs](https://docs.cursor.com/context/rules) [ref]
- BMAD's architect and UX-expert agents produce `architecture.md` and `front-end-spec.md` before the scrum-master agent shards stories. — [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) [ref, not fetched this session]
- Stack detection by manifest [ref, standard file names]: `pyproject.toml`/`requirements*.txt`/`uv.lock` (Python), `go.mod` (Go), `Cargo.toml` (Rust), `pom.xml`/`build.gradle(.kts)` (JVM), `*.csproj`/`*.sln`/`global.json` (.NET), `CMakeLists.txt`/`meson.build`/`Makefile` (C/C++), `package.json` + lockfile (JS/TS, with the package manager inferred from the lockfile), `Package.swift`, `pubspec.yaml` (Flutter), `ProjectSettings/ProjectVersion.txt` (Unity), `project.godot` (Godot), `*.uproject` (Unreal), `platformio.ini` / `west.yml` / `sdkconfig` (embedded). GitHub Linguist and tools such as `devcontainer`/`mise.toml`/`.tool-versions` also pin toolchain versions.

### Inferences
- For /flow-plan: the "foundations" output should be (a) a small always-loaded part limited to non-inferable rules (forbidden things, the contract artifact path, the commands to run) and (b) everything else referenced by path and loaded only when a story touches that area. Do **not** generate repo overviews or structure tours; the ETH data says they don't help.
- spec-kit's gate pattern is the transferable idea: foundations become a short checklist that /flow-plan and /flow-review run against each story ("Does this story change the contract? Then it updates the schema and the breaking-change check passes"), with exceptions written down. Coding Flow's INVEST check and readiness gate are the natural place to add a 2–3 question "foundations gate".
- Stack detection from manifests is deterministic and cheap, so it belongs in the CLI (`ai-flow bootstrap --scan`), not in the agent's reasoning. Its output can pre-fill the project type, test/lint/format commands and the proposed fitness-function tools, which the user confirms in one step.
- Combined with the user's simplicity constraint, the recommended minimal set per project is `project-context.md` (state map with decisions plus their check commands, NFR table answers), one contract artifact per type, and the `validation.quality` commands. No per-type template library.

### Gaps
- The ETH paper's exact per-condition numbers were not read from the full text.
- No study measured whether *checked* foundations (CI gates) reduce agent drift more than prose. This is a strong inference from the fitness-function literature and the compliance-vs-cost finding, but it is unmeasured.
- BMAD, Cursor and AGENTS.md stewardship details were not re-fetched for 2026 currency.
