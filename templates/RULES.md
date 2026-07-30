# RULES.md

The single rulebook for this repository: project constraints first, then the
operating rules every agent follows. `CLAUDE.md` imports this file.

---

## Project constraints

These constrain all agent work in this repository.

### Architecture

- Prefer feature-first organization.
- Keep business logic out of UI components.
- Keep domain logic testable and independent from rendering.
- Isolate data access behind explicit services or repositories when persistence is involved.
- Prefer deep modules with clear APIs over many tiny abstractions.
- Do not introduce speculative abstractions.
- Document meaningful architecture decisions in the active story `plan.md` (Decisions section).

### Code Quality

- Treat quality as context efficiency: duplication and complexity make every future story more expensive, so keeping the code clean serves the agent too.
- Follow existing project conventions before introducing new ones.
- Prefer strong typing and explicit boundaries.
- Avoid `any` unless it is justified in code or story notes.
- Keep functions small and intention-revealing.
- Prefer duplication over the wrong abstraction: apply the rule of three, and only unify cases that are the same concept and will change together.
- Run deterministic quality checks (lint, format, duplication) as validation; declare them in `.coding-flow/config.json` under `validation.quality` so they are executed and captured, not asserted.
- Do not silently modify unrelated files.

### Validation

- Validate external inputs at the boundary.
- Never trust client-side validation alone.
- Validate server-side before persistence or privileged actions.
- Keep error handling explicit and user-safe.

### Testing

- New business logic requires tests.
- Use TDD for complex logic, permissions, validation, transformations, workflows, and bug fixes.
- Add integration tests where data flow or service boundaries matter.
- Add E2E tests for critical user/admin flows.
- Do not over-test trivial UI.

### Security

- Never expose secrets.
- Never bypass authentication or authorization checks.
- Check permissions server-side.
- Avoid leaking private admin data into public surfaces.
- Treat file uploads, user content, and external inputs as hostile.

---

## Operating rules

### Core Behavior

- Follow the project constraints above before any agent preference.
- Prefer existing patterns, APIs, and conventions.
- Do not duplicate business logic.
- Do not introduce new architectural patterns without recording the decision.
- Do not bypass tests to make a task pass.
- Do not change unrelated files.
- Read the relevant docs and story files before coding.
- Preserve the current architecture unless the story explicitly changes it.
- Run relevant validation commands when available.
- Record unresolved risk instead of hiding it.

### Execution Flow

- Load the smallest context that can safely finish the work in one pass.
- Start with the user request, active story, acceptance criteria, and targeted search anchors.
- Read project docs only when the selected mode or risk requires them.
- For story work, read the active story folder. Read the epic `index.md` when sequencing, scope, or dependencies are unclear.
- Use targeted searches before opening broad directories.
- Implement only the active story scope.
- Update the `tasks.md` `## Result` section after execution.
- Update the `plan.md` Decisions section when a meaningful tradeoff is made.
- Every non-quick story execution must define an Execution Packet, Validation Gates, Stop Conditions, and Rollback Notes before implementation begins.
- Preserve one-shot delivery: once scope and edit points are clear, implement code, tests, validation, and notes in the same focused pass.

### Context Boundaries

- `docs/project-context.md` is the current state map of the project.
- Do not use `project-context.md` as a scratchpad, implementation log, or detailed decision journal.
- The `plan.md` Decisions section stores detailed story decisions, tradeoffs, alternatives, and consequences.
- The `tasks.md` `## Result` section stores what was actually changed, tests run, issues, follow-ups, and remaining risks.
- Only update `project-context.md` when the project's current state, target architecture, domains, roles, workflows, constraints, risks, roadmap, or decision summary changes.

### Context Ladder

Use the lightest context level that protects the story.

- `QUICK`: user request or `spec.md`, direct target files, 1-3 searches, no formal artifacts.
- `FAST`: story folder, targeted files, inline stop conditions and rollback notes, no orchestrator unless scope expands.
- `STANDARD`: story folder, epic index as needed, compact Execution Packet, targeted Context Map, normal validation.
- `STRICT`: required project docs, compact Context Map, security/architecture/test gates, deeper validators when risk justifies them.

`SCOUT` is not an execution mode. Use `/agent-context-scout` as a pre-step when edit points are unclear, the story crosses modules, or broad reading would otherwise be needed.

Context budget defaults:

- `QUICK`: stop after 3 searches or 5 files if the edit point is still unclear.
- `FAST`: stop after 5 searches or 8 files if the edit point is still unclear.
- `STANDARD`: create or reuse a Context Map before implementation; use scout if the map cannot stay compact.
- `STRICT`: read required docs, but still inspect implementation files through targeted searches first.

If a context budget is exceeded, stop and summarize what is known before reading more.

### Composite Workflows

- Use `plan-epic` to create an epic and its implementation-ready stories from product intent or brownfield analysis.
- Use `bootstrap-brownfield` after `ai-flow bootstrap --scan` to turn a local scan into durable project docs.
- Use `quick-story` for small, isolated changes that need no orchestration or formal artifacts.
- Use `run-story` for story execution in `FAST`, `STANDARD`, or `STRICT` mode. Use `STRICT` for security-sensitive stories: it adds security validation (server-side enforcement, the required security questions, and `agent-validator-security`).
- Prefer composite workflows for daily work; use atomic skills when a specific phase needs focused attention.

### Intensity Modes

Use the lightest mode that protects the story's risk.

#### FAST

Use for small UI changes, copy/text, simple bugs, isolated components, and low-risk local changes.

- **Reads**: story folder plus targeted files. Read epic/docs only if scope or conventions are unclear.
- **Artifacts**: no formal orchestration required; inline stop conditions and rollback notes suffice.
- **Traceability**: `tasks.md` `## Result` only for non-trivial changes; skip the `plan.md` Decisions section unless a real tradeoff occurred.

Pipeline:

1. `implement-slice`
2. lightweight `tests-check`
3. `blueprint-implementation-notes`

#### STANDARD

Use for normal CRUD, product features, frontend/backend integration, and ordinary vertical stories.

- **Reads**: story folder, targeted files, epic index when needed, project docs only when they affect the change.
- **Artifacts**: compact Execution Packet + Context Map + Validation Gates + Stop Conditions + Rollback Notes.
- **Traceability**: `tasks.md` `## Result` always; `plan.md` Decisions for meaningful tradeoffs only.

Pipeline:

1. `agent-orchestrator`
2. `implement-slice`
3. `tests-check`
4. `architecture-check`
5. `quality-check` (advisory; skip for tiny changes)
6. `review-codebase`
7. `blueprint-implementation-notes`

#### STRICT

Use for auth, admin, permissions, payments, DB migrations, risky refactors, security-sensitive work, enterprise workflows, and high-regression-risk changes.

- **Reads**: required docs, epic index, story folder, and targeted implementation files. Use scout when broad discovery would otherwise be needed.
- **Artifacts**: all - Execution Packet + Context Map + Validation Gates + Stop Conditions + Rollback Notes.
- **Traceability**: both the `tasks.md` `## Result` and the `plan.md` Decisions required.

Pipeline:

1. `agent-planner` or `grill-me` if requirements are unclear
2. `agent-orchestrator`
3. `tdd` for critical logic
4. `implement-slice`
5. `tests-check`
6. `e2e-check`
7. `architecture-check`
8. `quality-check` (escalate to `agent-validator-quality` for refactors or wide duplication)
9. `security-check`
10. `review-codebase`
11. fix loop
12. `blueprint-implementation-notes`

### Quality Gates

- When `ai-flow harness` is available, use it automatically for story work: `preflight` before orchestration, `check` after validation, and `evidence` at the end of STANDARD, STRICT, or secure stories.
- Run relevant tests.
- Run lint and typecheck when available.
- Deterministic quality (lint, format-check, duplication detectors like jscpd) belongs in `validation.quality`, so `verify` executes and captures it as proof — a red quality command blocks like a red test. Judgment quality (`quality-check`) stays advisory.
- Treat code quality as context efficiency, not style: duplication and complexity make every future story more expensive. Prefer duplication over the wrong abstraction — apply the rule of three, and only unify cases that are the same concept and will change together.
- If validation fails, fix the root cause when feasible.
- If validation cannot be completed, document the reason clearly.
- Stop instead of guessing when a stop condition is triggered.

### Required Stop Conditions

Stop story execution when:

- Database schema changes would be breaking or require migration approval.
- Auth, role, or permission model is unclear.
- Tests, lint, typecheck, or required validation commands cannot run.
- Existing architecture conflicts with the requested implementation.
- Story acceptance criteria are incomplete or not testable.
- External service behavior, credentials, or API contracts are unknown and required.
- The requested implementation would require unrelated refactors.
- Security-sensitive behavior lacks clear server-side enforcement rules.

When stopped, report:

- Triggered stop condition.
- Why continuing would be risky.
- What decision, artifact, or user input is needed.
- Suggested next skill or command.

### Skill Selection

- Use `*-check` skills for quick, targeted post-story checklists.
- Use `agent-validator-*` skills for deeper reviewer-agent passes on risky or broad changes.
- `bootstrap-brownfield`: convert `docs/bootstrap-scan.md` into useful project context without modifying application code.
- `quick-story`: minimal workflow for isolated changes - no orchestration, no formal artifacts.
- `agent-context-scout`: compact pre-implementation context discovery for broad, ambiguous, cross-module, or high-risk stories. Does not modify files.
- `architecture-check`: quick architecture checklist after a normal story.
- `agent-validator-architecture`: deep architecture review for refactors, cross-module changes, new patterns, or architecture-critical work.
- `tests-check`: quick test adequacy checklist after implementation.
- `agent-validator-tests`: deep test review for complex logic, critical flows, flaky suites, or release-sensitive work.
- `quality-check`: quick advisory code-quality checklist (duplication, complexity, naming, convention drift). Reviews only; never edits.
- `agent-validator-quality`: deep advisory quality review for refactors, wide duplication, or quality-critical work.
- `security-check`: quick security checklist for stories touching auth, admin, inputs, persistence, or data visibility.
- `agent-validator-security`: deep security review for auth, permissions, payments, uploads, secrets, external integrations, or sensitive data.

### Communication

- Summarize what changed.
- List validation commands run.
- State remaining risks or follow-ups.
- Keep summaries concise and grounded in files.
