# RULES.md

The single rulebook for this repository: project constraints, then the operating
rules every agent follows. `CLAUDE.md` imports it, so it is read on every turn — the
workflow itself (intensity, context budgets, stop conditions) lives in `/flow-run`
and `/flow-review`, loaded only when used. Never write a rule in both places.

---

## Project constraints

### Architecture

- Prefer feature-first organization.
- Keep business logic out of UI components, and domain logic testable and
  independent from rendering.
- Isolate data access behind explicit services or repositories when persistence is
  involved.
- Prefer deep modules with clear APIs over many tiny abstractions; introduce no
  speculative abstraction.
- Record a new architectural pattern or a meaningful decision in the active story's
  Decisions section.
- In a larger repo, each epic is one bounded context: integrate with another epic
  through an explicit interface (a function, an API, an event), never its internal
  modules, tables or types.

### Code Quality

- Quality is context efficiency: duplication and complexity make every future story
  more expensive.
- Follow existing conventions before introducing new ones; one implementation per
  business rule.
- Prefer strong typing and explicit boundaries; avoid `any` unless justified in code
  or story notes.
- Keep functions small and intention-revealing.
- Prefer duplication over the wrong abstraction: rule of three, and unify only cases
  that are the same concept and will change together.
- Run deterministic checks (lint, format, duplication) as validation, declared in
  `.coding-flow/config.json` under `validation.quality` so they are executed and
  captured, not asserted. Mutation testing (Stryker/PIT) for STRICT-risk changes is a
  project's explicit opt-in there, never a default.

### Validation

- Validate external inputs at the boundary. Never trust client-side validation
  alone: validate server-side before persistence or privileged actions.
- Keep error handling explicit and user-safe.

### Testing

- New business logic requires tests; TDD for complex logic, permissions,
  validation, transformations, workflows and bug fixes.
- Integration tests where data flow or service boundaries matter; E2E for critical
  user/admin flows. Do not over-test trivial UI.

### Security

- Never expose secrets.
- Never bypass authentication or authorization checks.
- Check permissions server-side.
- Avoid leaking private admin data into public surfaces.
- Treat file uploads, user content, and external inputs as hostile.

These apply at every intensity; only the ceremony around the work scales.

---

## Operating rules

### Core Behavior

- The project constraints above come before any agent preference.
- Preserve the current architecture unless the story explicitly changes it.
- Do not bypass tests to make a task pass, and do not change unrelated files.
- Run the relevant validation commands when available.
- Record unresolved risk instead of hiding it.
- Stop and report instead of guessing when the work hits a condition the story
  cannot answer.

### Execution Flow

- Load the smallest context that can finish the work in one pass: the request, the
  active story folder and its acceptance criteria, then targeted searches before any
  broad directory. Read the epic
  `index.md` when sequencing, scope or dependencies are unclear, and project docs
  only when the mode or the risk requires them.
- Implement only the active story's scope. Once scope and edit points are clear,
  deliver code, tests, validation and notes in the same pass.

### Context Boundaries

- `docs/project-context.md` is the current state map — never a scratchpad, log or
  decision journal. Update it only when the project's state, architecture, domains,
  roles, workflows, constraints, risks, roadmap or decision summary change.
- Record a story's tradeoffs and alternatives in its Decisions section, and what
  actually changed — tests run, issues, follow-ups, remaining risks — in its
  `## Result`.

### Tooling Friction

When Coding Flow itself is the obstacle — a gate nothing legitimate can satisfy,
a check that fires on a non-risk or misses a real one, a message that does not
say what to do next — add a row to `docs/DOGFOODING.md` in the same pass.
**Always add one when a check is disabled, relaxed, or exempted to keep going**,
reason included. A failing test, or a gate that rightly demanded one, is the tool
working — that stays out.

### Communication

End with what changed, the validation commands run, and the remaining risks or
follow-ups — concise and grounded in files.
