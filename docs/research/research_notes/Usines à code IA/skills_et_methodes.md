# Skills and methods frameworks for AI coding agents (2025-2026)

Scope: the open "workflow layer" that sits on top of Claude Code, Codex, Cursor, Copilot and similar agents. Research date: 2026-11-12. Each item marks whether a behaviour is **enforced mechanically** (hook, script, file lock, tool restriction, approval gate) or is **prose only** (instructions the model may or may not follow).

## mattpocock/skills (Matt Pocock): contents, philosophy, usage

### Takeaway
A set of small, composable Markdown skills ("Skills for Real Engineers", "not vibe coding"). It is built around four failure modes (misalignment, verbosity, broken code, mud), each paired with a fix: grilling, a shared glossary, feedback loops, and daily design care. Almost everything is prose. Discipline comes from explicit "gates" written into the skill text and from splitting user-invoked from model-invoked skills.

### Cited Findings
- The repo calls itself "Skills for Real Engineers", for "real engineering - not vibe coding". Its skills are "small, easy to adapt, and composable" and "work with any model". — [mattpocock/skills](https://github.com/mattpocock/skills)
- The philosophy maps four problems to four fixes. Misalignment is fixed by grilling ("No-one knows exactly what they want", Thomas & Hunt). Verbosity is fixed by a shared language, a `GLOSSARY.md`. Broken code is fixed by feedback loops ("The rate of feedback is your speed limit"). Mud is fixed by design care (Kent Beck: "Invest in the design of the system every day"). — [mattpocock/skills](https://github.com/mattpocock/skills)
- **User-invoked engineering skills:** `ask-matt` (a router), `grill-with-docs` (grilling that also updates GLOSSARY.md and ADRs), `triage` (an issue state machine), `improve-codebase-architecture` (HTML report on deepening opportunities, then grills on one pick), `setup-matt-pocock-skills` (run once per repo: issue tracker, labels, doc layout), `to-spec`, `to-tickets` ("tracer-bullet tickets with blocking edges"), `implement` (uses `/tdd`, then `/code-review`), `implement-spec` ("one integration branch, running subagents across ready tickets"), `wayfinder` (work too large for one session, kept as "a shared map of decision tickets"), and `retro` (environment improvements after a session). — [mattpocock/skills](https://github.com/mattpocock/skills)
- **Model-invoked engineering skills:** `prototype`, `diagnosing-bugs`, `research` (writes a cited Markdown file), `tdd` (red-green-refactor, "one vertical slice at a time"), `domain-modeling`, `codebase-design` ("deep modules: large behaviour behind a small interface"), `code-review` ("Standards and Spec axes using parallel subagents"), `pr` (PR body including a "merge-danger call"), and `wizard` (a bash wizard for steps only a human can do). — [mattpocock/skills](https://github.com/mattpocock/skills)
- **Productivity skills:** `grill-me`, `handoff` ("compacts the conversation into a document another agent can continue from"), `teach`, `to-questionnaire`, and `wait-what` (user-invoked). `grilling` ("the reusable interview primitive") and `writing-for-agents` (guidance for SKILL.md, AGENTS.md and CLAUDE.md) are model-invoked. — [mattpocock/skills](https://github.com/mattpocock/skills)
- **grilling SKILL.md:**
  - It opens with "Interview the user relentlessly until you reach a shared understanding".
  - It models decisions as a design tree. Each round asks, in one numbered batch, every question on the frontier, meaning decisions whose prerequisites are already settled. Each question carries a recommended answer worded so that "yes" accepts it.
  - The agent looks up environmental facts itself through a subagent instead of asking the user. Decisions belong to the user.
  - The session ends when the frontier is empty, with the rule "Do not act on it until the user confirms you have reached a shared understanding".
  - Source: [grilling/SKILL.md](https://raw.githubusercontent.com/mattpocock/skills/main/skills/productivity/grilling/SKILL.md)
- **diagnosing-bugs SKILL.md:** six gated phases. Source: [diagnosing-bugs/SKILL.md](https://raw.githubusercontent.com/mattpocock/skills/main/skills/engineering/diagnosing-bugs/SKILL.md)
  1. Build a feedback loop. Gate: "No red-capable command, no Phase 2".
  2. Reproduce and minimise.
  3. Write 3-5 ranked, falsifiable hypotheses in the form "If X is the cause, then changing Y will make the bug disappear".
  4. Instrument one variable at a time, tagging logs with a unique prefix such as `[DEBUG-a4f2]` for grep cleanup.
  5. Fix with a regression test at the real call site. A missing seam is reported as an architecture finding.
  6. Cleanup checklist. The commit names the hypothesis that turned out correct.
- **Install:**
  - Claude Code plugin: `claude plugin install mattpocock-skills@claude-plugins-official`.
  - Codex plugin marketplace; Copilot and Gemini CLI also supported.
  - `npx skills@latest add mattpocock/skills -a <agent>` for other agents.
  - Then run `/setup-matt-pocock-skills` once per repo.
  - Source: [mattpocock/skills](https://github.com/mattpocock/skills)

### Inferences
- The gates in diagnosing-bugs and grilling are textual. Nothing stops the model from skipping a phase. The only mechanical parts are plugin packaging, the user-invoked vs model-invoked split (which maps to Claude Code's `disable-model-invocation` / `user-invocable` fields), and subagent dispatch.
- Memory is externalized to repo artifacts (GLOSSARY.md, ADRs, issue-tracker tickets, handoff documents) rather than to a framework-specific state store.

### Gaps
- No per-skill dates or changelog were reviewed. The repo shows 553 commits ([repo](https://github.com/mattpocock/skills)).
- The writing-for-agents SKILL.md body was not fetched.
- No practitioner reports on outcomes were found.

## addyosmani/agent-skills and Osmani's writing (70% problem, orchestration)

### Takeaway
agent-skills packages senior-engineer lifecycle workflows (Define → Plan → Build → Verify → Review → Ship). Each skill ends with evidence requirements and anti-rationalization tables. Osmani's essays argue that AI gets you about 70% of the way and that the bottleneck has moved from generation to verification. He sees the workflow shifting from "conductor" (one agent) to "orchestrator" (3-5 parallel agents behind quality gates).

### Cited Findings
- **Repo contents:**
  - 25 skills: 24 lifecycle skills plus the `using-agent-skills` meta-skill that routes work.
  - 9 commands: `/spec`, `/plan`, `/build`, `/test`, `/constraints`, `/review`, `/webperf`, `/code-simplify`, `/ship`.
  - 4 reviewer personas: code-reviewer, test-engineer, security-auditor, web-performance-auditor.
  - 7 reference checklists, including a definition of done.
  - Source: [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)
- **Stages and the skills in each:**
  - Define: interview-me, idea-refine, spec-driven-development, constraint-driven-development.
  - Plan: planning-and-task-breakdown.
  - Build: incremental implementation, TDD, context engineering, source-driven development, doubt-driven development.
  - Verify: browser testing, debugging.
  - Review: code review, simplification, security, performance.
  - Ship: git workflow, CI/CD, ADRs, observability, launch.
  - Source: [agent-skills](https://github.com/addyosmani/agent-skills)
- **Philosophy:** "Skills encode the workflows, quality gates, and best practices that senior engineers use", "Process, not prose", and "AI coding agents default to the shortest path". Each skill has anti-rationalization tables that counter the excuses agents use to skip steps. — [agent-skills](https://github.com/addyosmani/agent-skills)
- **Verification and review:**
  - "Verification is non-negotiable"; "'Seems right' is never sufficient".
  - `/build auto` still requires TDD and one commit per task, and pauses on failures or risky steps.
  - `doubt-driven-development` is "Adversarial fresh-context review of every non-trivial decision in-flight".
  - Reviews use five axes, a change size of about 100 lines, and severity labels.
  - Orchestration rule: "personas don't invoke personas".
  - Source: [agent-skills](https://github.com/addyosmani/agent-skills)
- **Context:** the `context-engineering` skill aims to "Feed agents the right information at the right time". References use progressive disclosure. Installing a single skill with npx omits the shared `references/` checklists. — [agent-skills](https://github.com/addyosmani/agent-skills)
- **The 70% problem** ([Osmani](https://addyosmani.com/agentic-engineering/the-70-percent-problem/); [Pragmatic Engineer reprint](https://newsletter.pragmaticengineer.com/p/how-ai-will-change-software-engineering)):
  - AI gets you about 70% of the way fast. The last 30% takes longer and needs judgment.
  - The "knowledge paradox": AI helps experienced developers more than juniors.
  - Juniors who accept AI output produce a "house of cards".
  - The idea dates from late 2024 and is Ch. 3 of *Beyond Vibe Coding* (2025) ([O'Reilly](https://www.oreilly.com/library/view/beyond-vibe-coding/9798341634749/ch03.html)).
  - Note: the essay text was summarised from search snippets. The direct fetch failed.
- **"The Code Agent Orchestra" (2026-03-26)** ([Osmani](https://addyosmani.com/blog/code-agent-orchestra/)):
  - "Three focused agents consistently outperform one generalist agent working three times as long."
  - Patterns: subagents (start here), Agent Teams, hierarchical subagents, and the Ralph Loop ("pick, implement, validate, commit, reset" with external memory).
  - Team size: 3-5 teammates is the "sweet spot", with 1 reviewer per 3-4 builders. The WIP limit is bounded by what a human can review.
  - Gates: plan approval before code; `TaskCompleted` / `TeammateIdle` hooks that run tests and lint; a read-only reviewer teammate; a hard iteration cap and a forced reflection prompt before each retry.
  - Failure modes: stuck loops, flaky tests becoming systemic blockers, valid-looking tests that miss cases, and compounding small mistakes that degrade the architecture.
  - "The bottleneck is no longer generation. It's verification."
  - Isolation: one git worktree per agent.
  - Humans keep architecture, scope ("deciding what NOT to build") and final review.
  - Human-curated AGENTS.md files are preferred, since LLM-generated ones showed no benefit in cited research.
- **Conductor vs orchestrator** (Jan 2026 essay): the conductor is one human with one synchronous agent; the orchestrator is a human managing several autonomous parallel agents. — [Osmani](https://addyosmani.com/blog/future-agentic-coding/); [O'Reilly Radar](https://www.oreilly.com/radar/conductors-to-orchestrators-the-future-of-agentic-coding/)

### Inferences
- agent-skills is prose discipline (anti-rationalization tables, evidence checklists). In Osmani's own orchestration writing, mechanical enforcement comes from the host (Claude Code hooks, worktrees, plan approval), not from the skills.

### Gaps
- The full 70% essay could not be fetched (socket error). Its phrasing is from secondary sources.
- No independent evaluation of agent-skills outcomes was found.

## obra/superpowers (Jesse Vincent)

### Takeaway
A mandatory, auto-triggering skills methodology with this sequence:
1. Brainstorm into a design document.
2. Create a git worktree with a clean test baseline.
3. Write a plan of 2-5 minute tasks with exact code and verification steps.
4. Execute, either through subagent-driven development (a fresh subagent per task plus review after each) or inline.
5. Strict TDD that deletes code written before its tests.
6. Code review between tasks.
7. Finish the branch.

The only mechanical part is the bootstrap injection through a SessionStart hook on harnesses that support it. Everything else is "mandatory" in prose.

### Cited Findings
- **Workflow:**
  1. Brainstorming draws out intent and shows the spec in readable chunks. Small changes are agreed in chat; projects get a design document.
  2. Git worktree with a verified clean test baseline.
  3. Writing-plans: 2-5 minute tasks with "exact file paths, complete code, and verification steps", emphasizing TDD, YAGNI and DRY.
  4. Execution through `subagent-driven-development` (fresh subagent per task, review after each) or `executing-plans` (inline, one final review).
  5. TDD red-green-refactor that "deletes code written before its tests".
  6. Code review between tasks. "Critical issues block progress."
  7. Finishing-a-development-branch: merge, PR, keep or discard, then worktree cleanup.
  - Source: [superpowers README](https://raw.githubusercontent.com/obra/superpowers/main/README.md)
- **15 skills:** test-driven-development; systematic-debugging, verification-before-completion, diagnosing-superpowers; brainstorming, writing-plans, executing-plans, dispatching-parallel-agents, requesting-code-review, receiving-code-review, using-git-worktrees, finishing-a-development-branch, subagent-driven-development; writing-skills, using-superpowers. — [README](https://raw.githubusercontent.com/obra/superpowers/main/README.md)
- **Enforcement:**
  - "The agent checks for relevant skills before any task." The skills are "Mandatory workflows, not suggestions".
  - The `using-superpowers` bootstrap is injected by a native `SessionStart` hook on some harnesses, and on others at startup and again after compaction.
  - On harnesses without a post-compaction hook, long sessions "can lose the bootstrap". The advice is to start a fresh session.
  - Source: [README](https://raw.githubusercontent.com/obra/superpowers/main/README.md)
- **Origin:** Vincent built his own skills system before Claude Code had skills, as "markdown files, plus a hook that runs at startup that tells Claude that it has these things called skills". It was published 2025-10-09 and is now in the official Claude plugin marketplace. — [Larridin interview](https://larridin.com/blog/how-jesse-vincent-turned-code-writing-over-to-superpowers); [DataCamp tutorial](https://www.datacamp.com/tutorial/claude-code-superpowers). The original blog post (blog.fsck.com/2025/10/09/superpowers/) could not be fetched.
- **Adding skills:**
  - The project "generally" doesn't accept new skills. Contributors follow the `writing-skills` meta-skill.
  - Skill changes "must work across all of the coding agents we support".
  - Skill behaviour is tested with a `superpowers-evals` harness.
  - Source: [README](https://raw.githubusercontent.com/obra/superpowers/main/README.md)
- **Popularity:** star counts reported by secondary sources range from >40k in early 2026 to ~298k later. These are unverified. — [kunalganglani.com](https://www.kunalganglani.com/blog/superpowers-agentic-skills-framework.md)

### Inferences
- Superpowers' "learning" happens by authoring new SKILL.md files (writing-skills) and testing them with evals. Nothing is learned automatically at runtime.
- Context isolation per task (fresh subagent) is its main context-management mechanism. Durable memory lives in the design doc, the plan file and git.

### Gaps
- Not verified from primary sources: the persuasion-principles approach to skill writing and the "pressure scenario" testing of skills, which secondary coverage attributes to Vincent's blog.
- No version number was shown on the README.

## BMAD Method

### Takeaway
BMAD (Breakthrough Method for Agile AI-Driven Development) is a persona-based agile simulation:
- An analyst, a PM and an architect produce a PRD and an architecture document.
- These documents are "sharded" into story files.
- A Scrum Master agent writes hyper-detailed stories.
- Dev (and in v4, QA) agents implement them in fresh chats.

As of Nov 2026 the stable line is v6.12 and v7 is in preview alpha, repositioned as a lighter skills-based loop.

### Cited Findings
- **Current state:**
  - Stable v6.12 (`npx bmad-method install`) is frozen except for bug fixes.
  - The v7 Preview Alpha is installed via `npx skills add bmad-code-org/BMAD-METHOD --skill '*'` or the Claude Code / Codex marketplaces. "Expect breaking changes between updates." v7 is expected around mid-November 2026.
  - The README describes a Clarify → Plan → Build and verify → Learn loop: "Small changes go straight to build. Complex work gets the depth it needs."
  - It promises "Durable context" so decisions need not be re-explained.
  - A "BMad Loop" add-on "builds, verifies, and retros a whole epic unattended".
  - Source: [BMAD README](https://raw.githubusercontent.com/bmad-code-org/BMAD-METHOD/main/README.md)
- **Sharding:** monolithic PRD and architecture documents are broken into atomic story files, so dev agents load only the context they need. The SM agent "transforms these detailed plans into hyper-detailed development stories". — [BMAD v4 user guide mirror](https://cdn.jsdelivr.net/npm/@ptnglobal/bmad-method@4.43.1/docs/user-guide.md); [bmad-kb](https://cdn.jsdelivr.net/npm/@ptnglobal/bmad-method@4.43.1/bmad-core/data/bmad-kb.md)
- **v4 cycle:** SM → Dev → QA. Story files carry notes between agents ("Dev: Mark Ready for Review + Add Notes then QA review"), and QA can refactor and add tests before a story is done. In v6 the DEV agent took over quality validation that was QA in v4. v6 quick-start guidance recommends a fresh chat for each workflow. — [v4 user guide mirror](https://cdn.jsdelivr.net/npm/@ptnglobal/bmad-method@4.43.1/docs/user-guide.md); summary of community docs via search (mirrors and forks partly conflict on version details)

### Inferences
- BMAD's core context strategy is document sharding combined with fresh chats per role, which manually enforces context isolation. Persona handoffs are prose and file conventions, not mechanical gates.
- The v7 README language ("small changes go straight to build") reads as a response to ceremony criticism.

### Gaps
- The official README for v7 no longer lists personas, phases or scale tracks (Quick Flow / BMad Method / Enterprise). Those details come from v4/v6 mirrors and third-party guides, which partly conflict.
- docs.bmad-method.org was not fetched (time budget).

## Spec-driven development: GitHub spec-kit, Amazon Kiro, Tessl

### Takeaway
- spec-kit is a CLI plus slash-command scaffold: constitution → specify → plan → tasks → implement. The current README also has a converge loop and bug/assessment flows.
- Kiro is an IDE with specs (requirements/bugfix → design → tasks, with parallel task "waves"), steering files and event hooks.
- Tessl explores spec-as-source.

All three are mostly "spec-first" in practice ([Böckeler](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)).

### Cited Findings
- **spec-kit current README:**
  - Core commands: `/speckit-constitution` (once per project), `/speckit-specify`, `/speckit-plan`, `/speckit-tasks`, `/speckit-implement`, and `/speckit-converge` ("repeat implement and converge until it reports `Converged`").
  - Bug-fix commands (`/speckit-bug-assess|fix|test`) end with a verdict `verified|partial|failed`, and "only `verified` confirms a successful fix".
  - Idea-assessment commands write `.specify/assessments/<slug>/decision.md` with `go|needs-clarification|kill`.
  - The README describes no automated constitution checks. "Reviewing each result before continuing" is process guidance.
  - Source: [spec-kit README](https://raw.githubusercontent.com/github/spec-kit/main/README.md)
  - Note: the earlier, widely documented command set (`/speckit.clarify`, `/speckit.analyze`, `/speckit.checklist`) does not appear on the current README. The README now only mentions "clarification, checklists, and consistency analysis" as walkthrough topics. Treat command names as version-dependent.
- **spec-kit as Böckeler describes it (Oct 2025):** Constitution → Specify → Plan → Tasks, with many files per spec and one branch per spec. It aspires to be spec-anchored ("maintaining software means evolving specifications") but behaves spec-first. — [martinfowler.com](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)
- **Kiro specs:**
  - Each spec has three files: requirements.md (or bugfix.md, which records current, expected and unchanged behaviour), design.md (architecture, sequence diagrams, data flow, error handling, testing strategy), and tasks.md.
  - Feature specs offer a Requirements-First or Design-First flow.
  - "Quick Spec" generates all three files "in one pass without approval gates".
  - "Run all tasks" builds a dependency graph and runs independent tasks concurrently in "waves".
  - A Markdown Review lets users comment on specific passages.
  - Source: [kiro.dev/docs/specs](https://kiro.dev/docs/specs/)
- Kiro requirements use user stories with GIVEN/WHEN/THEN acceptance criteria and EARS-style notation. — [Böckeler](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html); [DZone](https://dzone.com/articles/kiro-feature-to-requirements-design-tasks)
- **Kiro steering:** Markdown files under `.kiro/steering/` provide persistent project context. "Generate Steering Docs" writes product.md, tech.md and structure.md. — [zenn.dev](https://zenn.dev/oikon/articles/kiro-steering); [Medium](https://medium.com/@Sanjjushri/advanced-kiro-steering-strategies-skills-powers-and-production-workflows-b68153ba88c2) (secondary)
- **Kiro agent hooks:** predefined agent actions run automatically when files are created, saved or deleted. — [kiro.dev first project](https://kiro.dev/docs/getting-started/first-project/); [lablab.ai](https://lablab.ai/ai-tutorials/aws-kiro-hooks-steering-custom-agents-deep-dive)
- **Tessl:** private beta at the time of review. It explicitly aims for spec-anchored and explores spec-as-source; generated code is marked "GENERATED FROM SPEC - DO NOT EDIT". Böckeler observed non-deterministic output from the same spec. Tessl's stance: "specs — not code — are the primary artifact". — [Böckeler](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)

### Inferences
- Kiro is the only SDD tool here with mechanical execution features: the task dependency graph and parallel waves, and file-event hooks. spec-kit's enforcement is scripts and templates plus prose review steps; its converge loop and bug verdicts are structured outputs, not hard gates.

### Gaps
- The Kiro steering and hooks docs were not fetched directly; the details are from secondary sources.
- Tessl's 2026 status was not researched.
- The current spec-kit artifact file names (spec.md, plan.md, tasks.md) are not stated on the current README.

## Anthropic primitives: skills, subagents, hooks, agent teams, and engineering guidance

### Takeaway
Anthropic supplies the mechanical layer that most of these frameworks build on:
- **Hooks:** deterministic, and can block via exit 2.
- **Skills:** progressive disclosure, with invocation control.
- **Subagents:** isolated context.
- **Agent teams (experimental):** shared task list with file locking, mailboxes, quality-gate hooks.

The engineering posts argue for simplicity, and for long tasks they recommend an initializer/coder split with external artifacts (feature-list JSON, progress file, git, init.sh) and one feature per session.

### Cited Findings
- **Hooks:**
  - "Hooks ... give you deterministic control: certain actions always happen rather than relying on the LLM to choose to run them."
  - Events include PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, UserPromptSubmit, Stop, SubagentStart, SubagentStop, SessionStart, SessionEnd, PreCompact, Notification, TaskCreated, TaskCompleted, TeammateIdle.
  - "exit 2 = block the action". Some events (e.g. SessionStart) cannot be blocked.
  - Prompt-based and agent-based hooks exist for judgment calls.
  - Source: [Claude Code hooks guide](https://code.claude.com/docs/en/hooks-guide)
- **Skills:**
  - A skill is a SKILL.md with YAML frontmatter.
  - Descriptions are always in context; "a skill's body loads only when it's used". Keep SKILL.md under 500 lines.
  - `disable-model-invocation: true` makes a skill user-only ("You don't want Claude deciding to deploy because your code looks ready"). `user-invocable: false` makes it model-only.
  - `context: fork` runs the skill in a subagent that "doesn't see your conversation history".
  - `` !`command` `` injects dynamic context.
  - Custom slash commands "have been merged into skills".
  - Skills follow the cross-tool "Agent Skills open standard".
  - Source: [Claude Code skills docs](https://code.claude.com/docs/en/skills)
- **Agent teams vs subagents:**
  - Agent teams are "experimental and disabled by default" (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`).
  - A lead coordinates teammates, each a full session with its own context. Teammates share a task list (pending, in progress, completed, plus dependencies; "Task claiming uses file locking") and message each other through JSON mailbox files.
  - Subagents only "report results back to the main agent" and cost fewer tokens.
  - Quality-gate hooks: `TeammateIdle`, `TaskCreated` and `TaskCompleted` (exit 2 blocks or keeps working).
  - Guidance: start with 3-5 teammates and about 5-6 tasks per teammate; avoid two teammates editing the same file; start with research and review rather than parallel implementation.
  - Limitations: no resume of in-process teammates, task status can lag, no nested teams, the lead may "decide the team is finished before all tasks are actually complete".
  - Teammate plans are auto-approved unless the permission mode is changed.
  - Source: [agent teams docs](https://code.claude.com/docs/en/agent-teams)
- **"Building effective agents" (2024-12-19):**
  - Distinguishes workflows ("predefined code paths") from agents.
  - Patterns: prompt chaining, routing, parallelization (sectioning and voting), orchestrator-workers, evaluator-optimizer.
  - "the simplest solution possible, and only increasing complexity when needed".
  - Prioritise transparency and the agent-computer interface (ACI).
  - Frameworks "often create extra layers of abstraction that can obscure the underlying prompts".
  - Source: [Anthropic](https://www.anthropic.com/engineering/building-effective-agents)
- **"Effective harnesses for long-running agents" (2025-11-26):**
  - "each new session begins with no memory of what came before"; compaction alone was insufficient.
  - The initializer agent creates `init.sh`, `claude-progress.txt`, an initial commit, and a JSON feature list (200+ features, all failing). Coding agents may only flip the `passes` field: "It is unacceptable to remove or edit tests".
  - JSON was chosen because the model overwrites it less readily than Markdown.
  - Each session handles one feature and runs a basic e2e check at session start.
  - End-to-end verification uses Puppeteer MCP "as a human user would", which "dramatically improved performance". Browser-native alert modals stayed invisible to it.
  - Failure modes: declaring victory early, leaving buggy or undocumented state, marking features done prematurely.
  - Open question: whether a single agent or a multi-agent setup with QA agents is better.
  - Source: [Anthropic](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)

### Inferences
- Third-party frameworks are mostly prose plus packaging. Mechanical guarantees in practice come from host primitives: hooks with exit 2, skill invocation flags, subagent isolation, task-list locking, and permission modes. A framework that wants hard gates has to wire them into hooks or CI.

### Gaps
- The subagents doc page and the Anthropic multi-agent research-system post were not fetched separately (budget).

## Criticisms of spec-driven development and heavy ceremony

### Takeaway
Practitioners report:
- disproportionate process for small changes;
- review overload from verbose Markdown, potentially doubling review;
- "context blindness";
- agents ignoring the spec, giving a false sense of control;
- parallels with waterfall and model-driven development.

Defenders argue that fast feedback loops distinguish SDD from waterfall, and that specs should stay small.

### Cited Findings
- **Birgitta Böckeler (Thoughtworks, 2025-10-15)** ([martinfowler.com](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)):
  - Distinguishes spec-first, spec-anchored and spec-as-source.
  - Kiro turned a small bug into 4 user stories with 16 acceptance criteria ("sledgehammer to crack a nut").
  - "I'd rather review code than all these markdown files."
  - Agents ignored instructions (recreating existing classes) or followed them too eagerly.
  - Small work packages "almost seem counter to the idea of SDD".
  - Model-driven development parallels: inflexibility plus LLM non-determinism.
  - "Semantic diffusion" of the word "spec".
  - "Are we making something worse in the attempt of making it better?"
- **François Zaninotto (Marmelab), "Spec-Driven Development: The Waterfall Strikes Back" (2025-11-12)** ([Marmelab](https://marmelab.com/blog/2025/11/12/spec-driven-development-waterfall-strikes-back.html)):
  - A spec-kit spec for displaying the current date produced "8 files and 1,300 lines of text".
  - SDD trades "80% of your time reading instead of thinking".
  - "Context Blindness": agents "often miss existing functions that need updates".
  - Technical specs contain code, so review is doubled.
  - An agent marked "verify implementation" done without writing tests.
  - Proposed alternative: riskiest-assumption-first small increments, which he calls "Natural Language Development".
- **Counterpoint (Allstacks, Mar 2026):** SDD invests more up front, but unlike waterfall "the feedback loop is still fast". — [Allstacks](https://allstacks.com/blog/spec-driven-development-isnt-waterfall-why-the-ai-coding-bottleneck-changed-everything)
- **Counterpoint (glukhov.org):** the waterfall critique targets bad SDD; keep specs small. — [glukhov.org](https://glukhov.org/de/ai-devtools/vibe-coding/spec-driven-development-vs-vibe-coding/)
- The frameworks themselves responded: Kiro offers "Quick Spec" without approval gates ([kiro.dev](https://kiro.dev/docs/specs/)), and BMAD v7 sends small changes "straight to build" ([BMAD README](https://raw.githubusercontent.com/bmad-code-org/BMAD-METHOD/main/README.md)). Anthropic's own guidance favours the simplest solution ([Anthropic](https://www.anthropic.com/engineering/building-effective-agents)).

### Inferences
- The tools converge on risk-scaled ceremony: Kiro Quick Spec, BMAD scale-adaptive tracks, superpowers' "small changes agreed in chat". This is the main lesson from the critiques.
- Every critique names agents not following the spec or skipping verification. That points to mechanical verification (executed tests, hooks, verdict files) rather than more prose.

### Gaps
- No controlled studies were found comparing SDD and skills frameworks against plain agent use. The evidence is anecdotal and practitioner-reported.
