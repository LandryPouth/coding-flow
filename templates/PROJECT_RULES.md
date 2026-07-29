# PROJECT_RULES.md

These rules constrain all agent work in this repository.

## Architecture

- Prefer feature-first organization.
- Keep business logic out of UI components.
- Keep domain logic testable and independent from rendering.
- Isolate data access behind explicit services or repositories when persistence is involved.
- Prefer deep modules with clear APIs over many tiny abstractions.
- Do not introduce speculative abstractions.
- Document meaningful architecture decisions in the active story `decisions.md`.

## Code Quality

- Treat quality as context efficiency: duplication and complexity make every future story more expensive, so keeping the code clean serves the agent too.
- Follow existing project conventions before introducing new ones.
- Prefer strong typing and explicit boundaries.
- Avoid `any` unless it is justified in code or story notes.
- Keep functions small and intention-revealing.
- Prefer duplication over the wrong abstraction: apply the rule of three, and only unify cases that are the same concept and will change together.
- Run deterministic quality checks (lint, format, duplication) as validation; declare them in `.coding-flow/config.json` under `validation.quality` so they are executed and captured, not asserted.
- Do not silently modify unrelated files.

## Validation

- Validate external inputs at the boundary.
- Never trust client-side validation alone.
- Validate server-side before persistence or privileged actions.
- Keep error handling explicit and user-safe.

## Testing

- New business logic requires tests.
- Use TDD for complex logic, permissions, validation, transformations, workflows, and bug fixes.
- Add integration tests where data flow or service boundaries matter.
- Add E2E tests for critical user/admin flows.
- Do not over-test trivial UI.

## Security

- Never expose secrets.
- Never bypass authentication or authorization checks.
- Check permissions server-side.
- Avoid leaking private admin data into public surfaces.
- Treat file uploads, user content, and external inputs as hostile.

## Agent Behavior

- Read `AGENT_RULES.md` before implementation work.
- Read the relevant docs and story files before coding.
- Preserve the current architecture unless the story explicitly changes it.
- Run relevant validation commands when available.
- Record unresolved risk instead of hiding it.
