# Plan — 33-01 The evidence has a type

## Implementation Context

- Likely files: `tsconfig.json`, `bin/lib/types.js`, `bin/lib/evidence.js`,
  `bin/lib/config.js`, readers in `bin/lib/{status,next,review}.js`,
  `package.json` (`scripts.typecheck`), `.github/workflows/test.yml`,
  `test/typecheck.test.js`, `docs/contributing.md`.
- Search anchors: `writeEvidence`, `readEvidence`, `readConfig`, `results[]`.
- Execution mode: STANDARD. Scout pre-step: no.
- Avoid: behaviour changes. Types describe the code; a type error that is a
  real bug is fixed with its own test.

## Decisions

- D1: the compiler is fetched by `npx` at a pinned version, not declared as a
  devDependency: the repository keeps no dependency of any kind, and
  `npm install` stays instant.
- D2: opt-in by `// @ts-check` per file, so the check grows module by module
  and never blocks unrelated work.
- D3: `typecheck` is not part of `npm test`: the suite must run offline.

## Test Plan

`test/typecheck.test.js`: skipped when the compiler cannot be fetched; on a
throwaway copy, rename a field in one producer and assert a non-zero exit
naming the file. Plus the pack/dependency assertion.

## Acceptance Traceability

(filled by `/flow-run`)

## Commands

```bash
npm test
npm run typecheck
```
