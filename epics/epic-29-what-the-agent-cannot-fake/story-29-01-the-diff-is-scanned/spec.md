# Story 29-01 — The diff is scanned

## User Value

Before anyone reads an agent's diff, one command lists the few defects that a
green suite and a linter both let through — a function that only throws "not
implemented", an import of a package that exists nowhere, a relative import
to a file that does not exist, a `.only` — each with its file, line and fix.
`verify` runs it on the diff under proof and records it in the evidence.

## Requirements

- **Command.** `ai-flow scan [--changed | --staged | --diff <range>] [--json]`.
  Default `--changed`: merge base of the diff base (`diff-base.js`) to the
  working tree. Only added lines are examined (`diff-scope.js`); a finding on
  a line the diff did not add is never reported.
- **Four rules, TS/JS** (`.ts .tsx .mts .cts .js .jsx .mjs .cjs`; `dist/`,
  `node_modules/`, generated and `.d.ts` files skipped). Each one is a defect,
  never a style opinion, so there is no severity ladder:

  | Rule | Matches |
  |---|---|
  | `placeholder.not_implemented` | `throw new …Error("…not implemented / unimplemented / stub…")` |
  | `import.phantom_dependency` | a bare import neither declared (nearest `package.json`, root, workspace packages, tsconfig `paths`/`baseUrl`, `@types/*` for `import type`) nor installed |
  | `import.broken_relative_path` | a relative import resolving to no file (usual extensions and `index.*`) |
  | `test.only` | `.only(`, `fit(`, `fdescribe(` added in a test file |

  Style-level checks (`any`, `@ts-ignore`, `console.log`, `TODO`, empty
  `catch`) stay the project linter's job: duplicating them here was measured
  as noise on bethl (2026-11-14).
- **Suppression.** `ai-flow-scan-ignore <rule> -- <reason>` on the line or the
  line above; without a reason it does not suppress. Each suppression is
  listed in the output and copied verbatim into the evidence.
- **Config.** `scan.rules.<id>: off`; `scan.exclude`: globs.
- **Output.** One line per finding:
  `src/pay.ts:6 import.phantom_dependency — package \`receipt-engine\` is neither declared nor installed → add it to package.json or fix the name`.
  `--json`: `{ findings: [{ rule, file, line, message, fix }], suppressed }`.
- **Exit codes.** 0 nothing found; 1 at least one finding; 2 usage or config
  error; 3 tool failure.
- **Verify.** `verify` runs the scan on the diff under proof and records it in
  evidence (`scan: { findings, suppressed }`). A finding is a contrary signal
  `scan-finding`: listed every time, NOT PROVEN where strictness applies
  (entry 9). A scan that cannot run is `not examined`, never clean.

## Acceptance Criteria

- [ ] Given a diff that adds `throw new Error("not implemented")` in `src/a.ts`, when `ai-flow scan` runs, then it prints one `placeholder.not_implemented` at that line and exits 1.
- [ ] Given the same line already present at the merge base and untouched, when `ai-flow scan` runs, then it reports nothing and exits 0.
- [ ] Given an added `import x from "left-pad-ultra"` with no such dependency and no `node_modules/left-pad-ultra`, when the scan runs, then it reports `import.phantom_dependency`; given the package installed but not declared, then nothing is reported.
- [ ] Given an added `import { y } from "@/lib/y"` and a tsconfig `paths` entry `"@/*"`, when the scan runs, then nothing is reported (and a tsconfig whose strings contain `/*` still parses).
- [ ] Given `// ai-flow-scan-ignore test.only -- debugging the flaky suite` above an added `it.only(`, when the scan runs, then no finding is reported and the suppression is listed; without `-- reason`, the finding stays.
- [ ] Given a story verified with a finding in a `mode: strict` project, when verify runs, then the verdict is NOT PROVEN with the contrary signal `scan-finding` naming the file and line; in a default project the verdict is unchanged and the finding is listed.
- [ ] Given `--json`, then the output parses and holds `findings` and `suppressed`.

## Edge Cases

- Renamed files: only the lines the rename changed count (`--find-renames`).
- Untracked new files: all their lines are added (as `diff-scope.js` does).
- A tsconfig `extends` a package path (not relative): its `paths` are not
  read; the installed check still clears real packages.
- Monorepo: `package.json` is looked up from the file's directory upward.
- Non-JS files: not scanned, not counted.

## Out of Scope

- Style rules a linter already enforces, other languages, network registry
  lookups, a model in the loop, old debt.

## Security

Read-only. The scan prints source lines: it reuses the secret redaction of
`report` for any line the secret heuristic flags.
