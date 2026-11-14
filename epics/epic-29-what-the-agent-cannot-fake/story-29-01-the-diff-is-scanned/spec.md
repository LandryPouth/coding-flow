# Story 29-01 — The diff is scanned

## User Value

Before anyone reads an agent's diff, one command lists the defects agents
typically leave in the lines they added — a function that only throws "not
implemented", a `@ts-ignore`, an `any` on an exported signature, an import of
a package that exists nowhere, a relative import to a file that does not
exist, a `.only` — each with its file, line, rule and fix. `verify` runs it
on the diff under proof and records it in the evidence.

## Requirements

- **Command.** `ai-flow scan [--changed | --staged | --diff <range>] [--story <dir>] [--json] [--explain <rule>]`.
  Default `--changed`: merge base of the diff base (`diff-base.js`) to the
  working tree. Only added lines are examined (`diff-scope.js`); a finding on
  a line the diff did not add is never reported.
- **Rules, TS/JS** (`.ts .tsx .mts .cts .js .jsx .mjs .cjs`; generated,
  `dist/`, `node_modules/`, `.d.ts` skipped):

  | Rule | Severity | Matches |
  |---|---|---|
  | `placeholder.not_implemented` | high | `throw new …Error("…not implemented / unimplemented / todo / stub…")` |
  | `placeholder.empty_function` | medium | a named function or method whose body is `{}` |
  | `error.swallowed` | medium | `catch (…) {}` |
  | `placeholder.todo_comment` | low | `TODO`, `FIXME`, `HACK`, `XXX` comments |
  | `trust.ts_ignore` | medium | `@ts-ignore`, `@ts-nocheck` |
  | `trust.any_boundary` | medium | `any` in an exported signature |
  | `trust.as_any` | low | `as any` |
  | `trust.lint_disable_bare` | low | `eslint-disable…` without `-- <reason>`; `@ts-expect-error` without a description |
  | `import.phantom_dependency` | high | a bare import neither declared (nearest `package.json`, root, workspace packages, tsconfig `paths`/`baseUrl`, `@types/*` for `import type`) nor installed |
  | `import.undeclared_dependency` | low | installed only through another package |
  | `import.broken_relative_path` | high | a relative import resolving to no file (with the usual extensions and `index.*`) |
  | `debug.debugger` | high | `debugger` |
  | `debug.console` | low | `console.log` / `console.debug` outside test files |
  | `test.only` | high | `.only(`, `fit(`, `fdescribe(` added in a test file |

  The skip markers and assertion counts already in `coverage-gate.js`
  (`SKIP_MARKERS`, `ASSERTION_MARKERS`) are reused, not copied.
- **Suppression.** `ai-flow-scan-ignore <rule> -- <reason>` on the line or the
  line above; without a reason it does not suppress. Each suppression is
  listed in the output and copied verbatim into the evidence.
- **Config.** `scan.failOn`: `none | high | medium` (default `high`);
  `scan.rules.<id>`: `off` or a severity; `scan.exclude`: globs.
- **Output.** One line per finding, severity first:
  `[high] src/pay.ts:6 import.phantom_dependency — package \`receipt-engine\` is neither declared nor installed → <fix>`,
  then `Scan: ready | needs a look | needs work` (Shipmoor's three states).
  `--json`: `{ verdict, counts, findings: [{ rule, severity, file, line, message, fix }], suppressed }`.
- **Exit codes.** 0 ready or needs a look; 1 needs work (a finding at or
  above `failOn`); 2 usage or config error; 3 tool failure.
- **Verify.** `verify` runs the scan on the diff under proof and records it in
  evidence (`scan: { verdict, counts, findings, suppressed }`). A finding at
  or above `failOn` is a contrary signal `scan-finding`: listed every time,
  NOT PROVEN where strictness applies (entry 9). A scan that cannot run is
  `not examined`, never `ready`.
- **Explain.** `ai-flow scan --explain <rule>` prints what the rule matches,
  a known false positive, and the fix.

## Acceptance Criteria

- [ ] Given a diff that adds `throw new Error("not implemented")` in `src/a.ts`, when `ai-flow scan` runs, then it prints one high `placeholder.not_implemented` at that line and exits 1.
- [ ] Given the same line already present at the merge base and untouched, when `ai-flow scan` runs, then it reports nothing for it.
- [ ] Given an added `import x from "left-pad-ultra"` with no such dependency and no `node_modules/left-pad-ultra`, when the scan runs, then it reports `import.phantom_dependency` high; given the package installed but not declared, then `import.undeclared_dependency` low.
- [ ] Given an added `import { y } from "@/lib/y"` and a tsconfig `paths` entry `"@/*"`, when the scan runs, then nothing is reported (and a tsconfig whose strings contain `/*` still parses).
- [ ] Given `// ai-flow-scan-ignore trust.as_any -- vendor type gap` above an `as any`, when the scan runs, then no finding is reported and the suppression is listed; without `-- reason`, the finding stays.
- [ ] Given `scan.failOn: medium` and one medium finding, when the scan runs, then it exits 1; with the default, it exits 0 and says "needs a look".
- [ ] Given a story verified with a high finding in a `mode: strict` project, when verify runs, then the verdict is NOT PROVEN with the contrary signal `scan-finding` naming the file and line; in a default project the verdict is unchanged and the finding is listed.
- [ ] Given `--json`, then the output parses and holds `verdict`, `counts`, `findings`, `suppressed`.

## Edge Cases

- Renamed files: only the lines the rename changed count (`--find-renames`).
- Untracked new files: all their lines are added (as `diff-scope.js` does).
- A tsconfig `extends` a package path (not relative): its `paths` are not
  read; an import it would have resolved can show as phantom — documented in
  `--explain`, and the installed check still catches real packages.
- Monorepo: `package.json` is looked up from the file's directory upward.
- Non-JS files: not scanned, not counted.

## Out of Scope

- Other languages, network registry lookups, a model in the loop, old debt.

## Security

Read-only. The scan prints source lines: it reuses the secret redaction of
`report` for any line the secret heuristic flags.
