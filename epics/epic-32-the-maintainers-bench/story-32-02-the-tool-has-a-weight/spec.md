# Story 32-02 — The tool has a weight

## User Value

Every pull request on Coding Flow shows what the tool costs the people who use
it:
- the guard's latency on each agent command;
- the CLI's cold start;
- the npm package size;
- the tokens the tool injects into every session.

A pull request that makes any of them heavier past a budget fails this
repository's CI. Weight becomes a gate, like coverage.

## Requirements

- **`node evals/bench/weight.js [--json]`** measures:
  - **guard latency** per call: p50 and p95, cold and in-process, over the
    everyday command corpus (the guard tests' allowed commands) and the
    29-03 decisions corpus;
  - **CLI cold start**: `ai-flow --version` and `ai-flow status` on a fixture
    project, median of 5 runs;
  - **package size**: `npm pack --dry-run --json`, total size and file count;
  - **tokens injected per session**, estimated as characters ÷ 4 and labelled
    as an estimate:
    - each installed `SKILL.md`;
    - the `AGENTS.md` and `CLAUDE.md` blocks that `init` writes;
    - the guard's longest refusal message;
    - `verify`'s output on a green run;
  - **surface**: the number of commands and flags in `ai-flow --help`.
- **Budgets** in `evals/bench/budgets.json`, one per measure, set from the
  first measured values plus a margin. CI runs `weight.js --check` and fails on
  any measure over its budget. The failure names the measure, its value and the
  budget. Raising a budget is a reviewed edit to that file.
- **The latency is measured with the machine load recorded.** A run under high
  load (above the CPU count) is marked unreliable and does not fail the check.

## Acceptance Criteria

- [ ] Given this repository, when `weight.js --json` runs, then it prints
      every measure above, and each token figure is labelled as an estimate.
- [ ] Given a budget lowered below the measured value, then `--check` exits 1
      and names the measure, its value and the budget. Given the budgets as
      committed, then it exits 0.
- [ ] Given a load above the CPU count, then the latency measures are marked
      unreliable and do not fail `--check`.
- [ ] CI runs `weight.js --check` on the Ubuntu job only.

## Edge Cases

- `npm pack` unavailable: the package measure is skipped, and the skip is said.
- A skill added: its tokens are counted. The budget covers the total, not each
  file.

## Out of Scope

- Making anything lighter. This story only measures. Proposals come from
  32-03, and changes from stories of their own.
