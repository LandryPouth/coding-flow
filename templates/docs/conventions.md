# Conventions

This file captures local conventions that agents should follow before inventing new patterns.

Keep it short, concrete, and easy to scan.

## Naming

- Files:
- Components:
- Services:
- Hooks:
- Tests:
- Routes:
- Database objects:

## Code Style

- Language rules:
- Type safety:
- Error handling:
- Validation:
- Logging:
- Comments:

## Code Quality And DRY

Quality here means **context efficiency**, not style policing. Duplication of one
concept, tangled coupling, and runaway complexity make every future story more
expensive to find and change safely. That is why quality is worth enforcing — for
the agent as much as for humans.

Two kinds of quality, routed differently:

- **Deterministic quality** — lint, format-check, typecheck, duplication detectors
  (jscpd/similarity). Executable and reproducible. Declare it in
  `.coding-flow/config.json` under `validation.quality` so `ai-flow verify`
  runs it and captures the result as proof. A red quality command blocks like a red
  test.
- **Judgment quality** — the right abstraction level, naming intent, justified
  coupling. Subjective and contextual. It stays advisory via the Quality section of
  `/flow-review`; it never becomes a fake-precise merge gate.

On DRY, the most misapplied principle (and worse with an agent):

- Apply the **rule of three** — two similar blocks are not yet a pattern.
- **"Duplication is cheaper than the wrong abstraction"** (Sandi Metz). Coupling
  things that merely look alike raises the blast radius of every future change.
- Duplication is a **signal to review**, never a rule to eliminate on sight. Only
  unify cases that are the same concept and will change together.

## Project Organization

- Prefer:
- Avoid:
- Shared code belongs in:
- Feature code belongs in:
- Test code belongs in:

## UI Conventions

- Component library:
- Styling approach:
- Layout conventions:
- Forms:
- Loading states:
- Empty states:
- Error states:
- Accessibility:

## API And Data Conventions

- API style:
- Request validation:
- Response shape:
- Error shape:
- Data access:
- Transactions:
- Migrations:

## Testing Conventions

- Unit test framework:
- Integration test framework:
- E2E framework:
- Test file naming:
- Fixture strategy:
- Commands:

Example commands:

```bash
npm run lint
npm run typecheck
npm test
```

Replace these with real project commands.

## Git Conventions

- Branch naming:
- Commit messages:
- PR expectations:
- One story per branch:

## Agent Conventions

- Start with targeted search before broad directory reads.
- Prefer existing helpers and patterns.
- Record meaningful tradeoffs in the story-level `plan.md` Decisions section.
- Record implementation facts in the story-level `tasks.md` `## Result` section.
- Stop instead of guessing when validation, auth, data ownership, or scope is unclear.
