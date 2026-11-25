# Story 33-01 — The evidence has a type

## User Value

A contributor (human or agent) who renames or misuses a field of the verify
evidence is told by the compiler before running a single test.

## Requirements

- `tsconfig.json`: `allowJs`, `checkJs`, `noEmit`, `module`/`target` matching
  Node 18, `include` limited to the files with `// @ts-check` (the rest stays
  unchecked until a later story opts it in).
- `bin/lib/types.js` (or `bin/lib/*.d.ts` if JSDoc cannot express it) holding
  `@typedef`s: `VerifyEvidence`, `VerifyResult`, `ReviewEvidence`, `Config`.
- `// @ts-check` on `bin/lib/evidence.js`, `bin/lib/config.js`, and the readers
  of the evidence (`status`, `next`, `review`), with the types applied.
- `npm run typecheck` runs the compiler through `npx --yes typescript@<pinned>
  tsc -p .`; CI runs it on the Ubuntu 22.x job.
- `package.json` `dependencies` and `devDependencies` stay empty; `files`
  unchanged.

## Acceptance Criteria

- [ ] Given this repository, when `npm run typecheck` runs, then it exits 0.
- [ ] Given a field of `VerifyEvidence` renamed in one producer only (a test
      edits a throwaway copy), then `typecheck` exits non-zero and names the file
      and line.
- [ ] Given the CI workflow, then the Ubuntu 22.x job runs `typecheck`.
- [ ] `npm pack --dry-run` lists the same files as before; `package.json` has
      no dependency of either kind.
- [ ] Any real type error found while typing is fixed with a test that fails
      before the fix, and listed in the Result.

## Edge Cases

- No network for `npx`: `typecheck` says the compiler could not be fetched;
  `npm test` does not depend on it.

## Out of Scope

- Typing the guard and verify (33-02), the tests, or any `.ts` file.
