# RULES.md

The single rulebook for this repository: project constraints first, then the
operating rules every agent follows. `CLAUDE.md` imports this file.

This file states what the repository demands of any agent. It deliberately does
**not** restate the workflow — intensity modes, context budgets, stop conditions
and depth are owned by `/flow-run` and `/flow-review`, which are loaded only when
they are used. A rule written in two places is a rule that will eventually
disagree with itself, and the always-loaded copy is the one that wins by default.

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
- Document meaningful architecture decisions in the active story plan (Decisions section).
- In a larger repo, treat each epic as one bounded context: do not reach into
  another epic's internal modules, tables, or types directly. Integrate through
  an explicit interface (a function, an API, an event) instead.

### Code Quality

- Treat quality as context efficiency: duplication and complexity make every future story more expensive, so keeping the code clean serves the agent too.
- Follow existing project conventions before introducing new ones.
- Prefer strong typing and explicit boundaries.
- Avoid `any` unless it is justified in code or story notes.
- Keep functions small and intention-revealing.
- Prefer duplication over the wrong abstraction: apply the rule of three, and only unify cases that are the same concept and will change together.
- Run deterministic quality checks (lint, format, duplication) as validation; declare them in `.coding-flow/config.json` under `validation.quality` so they are executed and captured, not asserted. For STRICT-risk changes, a project may opt into mutation testing (Stryker/PIT) the same way — it is expensive, so it stays a project's explicit choice, never a default `/flow-run` adds on its own.
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

These apply at every intensity. What changes with intensity is the ceremony
around the work, never these constraints.

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
- Stop and report instead of guessing when the work hits a condition the story cannot answer.

### Execution Flow

- Load the smallest context that can safely finish the work in one pass.
- Start with the user request, active story, acceptance criteria, and targeted search anchors.
- Read project docs only when the selected mode or risk requires them.
- For story work, read the active story folder. Read the epic `index.md` when sequencing, scope, or dependencies are unclear.
- Use targeted searches before opening broad directories.
- Implement only the active story scope.
- Record what was actually changed in the story's Result section, and meaningful tradeoffs in its Decisions section.
- Preserve one-shot delivery: once scope and edit points are clear, implement code, tests, validation, and notes in the same focused pass.

### Context Boundaries

- `docs/project-context.md` is the current state map of the project.
- Do not use `project-context.md` as a scratchpad, implementation log, or detailed decision journal.
- The story's Decisions section stores detailed story decisions, tradeoffs, alternatives, and consequences.
- The story's `## Result` section stores what was actually changed, tests run, issues, follow-ups, and remaining risks.
- Only update `project-context.md` when the project's current state, target architecture, domains, roles, workflows, constraints, risks, roadmap, or decision summary changes.

### Tooling Friction

When Coding Flow itself is the obstacle — a gate nothing legitimate can satisfy,
a check that fires on a non-risk or misses a real one, a message that does not
say what to do next — add a row to `docs/DOGFOODING.md` in the same pass.
**Always add one when a check is disabled, relaxed, or exempted to keep going**,
reason included. A failing test, or a gate that rightly demanded one, is the tool
working — that stays out.

### Communication

- Summarize what changed.
- List validation commands run.
- State remaining risks or follow-ups.
- Keep summaries concise and grounded in files.
