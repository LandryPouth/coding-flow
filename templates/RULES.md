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

`SCOUT` is not an execution mode. Use a scout pre-step (the read-only Context Map pass in `/flow-run`'s Context Policy) when edit points are unclear, the story crosses modules, or broad reading would otherwise be needed.

Context budget defaults:

- `QUICK`: stop after 3 searches or 5 files if the edit point is still unclear.
- `FAST`: stop after 5 searches or 8 files if the edit point is still unclear.
- `STANDARD`: create or reuse a Context Map before implementation; use scout if the map cannot stay compact.
- `STRICT`: read required docs, but still inspect implementation files through targeted searches first.

If a context budget is exceeded, stop and summarize what is known before reading more.

### Workflow

The skill set is small and flat — one skill per stage:

- `/flow-setup` — scaffold Coding Flow into the repo (once).
- `/flow-plan` — turn an objective, product intent, or brownfield scan into implementation-ready stories.
- `/flow-run` — execute one story end-to-end; it selects `QUICK`..`STRICT` by risk and runs the right depth.
- `/flow-verify` — capture verbatim pass/fail proof for a story.
- `/flow-review` — findings-first pre-merge review.
- `/flow-ship` — push the branch and open or update the PR.

Depth (`STRICT` mode, deep validators, the context scout, TDD) lives as opt-in
*sections* inside `/flow-run` and `/flow-review`. You do not chain separate skills by hand:
pick the skill for the stage, and let it escalate depth by the story's risk.

### Intensity Modes

Use the lightest mode that protects the story's risk.

#### FAST

Use for small UI changes, copy/text, simple bugs, isolated components, and low-risk local changes.

- **Reads**: story folder plus targeted files. Read epic/docs only if scope or conventions are unclear.
- **Artifacts**: no formal orchestration required; inline stop conditions and rollback notes suffice.
- **Traceability**: `tasks.md` `## Result` only for non-trivial changes; skip the `plan.md` Decisions section unless a real tradeoff occurred.

`/flow-run` in FAST:

1. Implement the slice.
2. Run a lightweight test check.
3. Record the result in `tasks.md`.

#### STANDARD

Use for normal CRUD, product features, frontend/backend integration, and ordinary vertical stories.

- **Reads**: story folder, targeted files, epic index when needed, project docs only when they affect the change.
- **Artifacts**: compact Execution Packet + Context Map + Validation Gates + Stop Conditions + Rollback Notes.
- **Traceability**: `tasks.md` `## Result` always; `plan.md` Decisions for meaningful tradeoffs only.

`/flow-run` in STANDARD:

1. Build a compact Execution Packet and Context Map.
2. Implement the slice.
3. Run tests.
4. Architecture check.
5. Advisory quality check (skip for tiny changes).
6. `/flow-review`.
7. Record decisions in `plan.md` and the result in `tasks.md`.

#### STRICT

Use for auth, admin, permissions, payments, DB migrations, risky refactors, security-sensitive work, enterprise workflows, and high-regression-risk changes.

- **Reads**: required docs, epic index, story folder, and targeted implementation files. Use scout when broad discovery would otherwise be needed.
- **Artifacts**: all - Execution Packet + Context Map + Validation Gates + Stop Conditions + Rollback Notes.
- **Traceability**: both the `tasks.md` `## Result` and the `plan.md` Decisions required.

`/flow-run` in STRICT:

1. Clarify requirements first (via `/flow-plan`) when they are unclear.
2. Plan the execution and build the Context Map (scout when discovery is broad).
3. TDD for critical logic.
4. Implement the slice.
5. Run tests and E2E.
6. Architecture check (deep review for refactors or new patterns).
7. Deep quality review for refactors or wide duplication.
8. Security check: server-side enforcement plus the required security questions.
9. `/flow-review`, then a fix loop.
10. Record decisions in `plan.md` and the result in `tasks.md`.

### Quality Gates

- When `ai-flow harness` is available, use it automatically for story work: `preflight` before orchestration, `check` after validation, and `evidence` at the end of STANDARD, STRICT, or secure stories.
- Run relevant tests.
- Run lint and typecheck when available.
- Deterministic quality (lint, format-check, duplication detectors like jscpd) belongs in `validation.quality`, so `verify` executes and captures it as proof — a red quality command blocks like a red test. Judgment quality (the advisory quality pass inside `/flow-review`) stays advisory.
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

### Choosing depth

Depth is opt-in and lives inside `/flow-run` and `/flow-review`. Escalate by the story's
risk, not by chaining separate skills.

- **Context scout** — the read-only Context Map pass in `/flow-run`, before implementing, when edit points are unclear or the story crosses modules. Does not modify files.
- **Architecture** — a quick architecture checklist after a normal story; escalate to a deep review for refactors, cross-module changes, or new patterns.
- **Tests** — a quick test-adequacy check after implementation; escalate to a deep review for complex logic, critical flows, flaky suites, or release-sensitive work.
- **Quality** — a quick advisory pass (duplication, complexity, naming, convention drift; reviews only, never edits); escalate to a deep review for refactors or wide duplication.
- **Security** — a quick check for stories touching auth, admin, inputs, persistence, or data visibility; escalate to a deep review for permissions, payments, uploads, secrets, external integrations, or sensitive data.

Brownfield: run `ai-flow bootstrap --scan`, then `/flow-plan` to turn the scan into
durable project context without modifying application code.

### Communication

- Summarize what changed.
- List validation commands run.
- State remaining risks or follow-ups.
- Keep summaries concise and grounded in files.
