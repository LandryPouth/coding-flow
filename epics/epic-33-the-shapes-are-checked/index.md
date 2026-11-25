# Epic 33 — The shapes are checked

## Goal

The data shapes that cross the tool (verify and review evidence, config,
`status --json`, guard decisions) are checked by the TypeScript compiler,
without turning the tool into TypeScript: JSDoc types, `// @ts-check`, and
`tsc --noEmit --checkJs` in CI. No build step, no runtime dependency, no
change to what ships or to how the guard runs.

## Why

- **The maintainer asked on 2026-11-25** whether to move to TypeScript. The
  answer recorded with them: not a rewrite. A rewrite of ~35 k lines plus
  ~35 k of tests would need a build (`dist/`, source maps) or Node's type
  stripping (Node ≥ 22.18, while `engines` promises `>=18`), would make the
  guard live only after a rebuild, and would conflict with every story in
  flight. Most of the gain — shapes checked, a renamed field or a
  propagated `undefined` caught before verify — comes from checking the
  JavaScript as it is.
- **Today no file is type-checked** (no `@ts-check`, no `@typedef`).
- **Whether it pays is measured, not assumed:** epic 32's ledger records the
  red-verify rate (one in five on coding-flow and bethl at the 2026-11-25
  baseline) before and after.

## Scope

**In scope**
- `tsconfig.json` with `allowJs`, `checkJs`, `noEmit`, strictness raised
  module by module.
- `@typedef`s for the shared shapes, `// @ts-check` on the modules that
  produce and read them.
- A CI step running the compiler.

**Out of scope**
- `.ts` files, a build step, a `dist/` in the package.
- `typescript` as a dependency of the package. The compiler runs through
  `npx` at a pinned version in CI and in an npm script (decision D1 of 33-01).
- Typing the tests.

Backbone: the evidence has a type → its producers and readers are checked → the guard and verify are checked

```text
s1
└── s2
```

## Stories

1. [story-33-01-the-evidence-has-a-type](story-33-01-the-evidence-has-a-type/spec.md) *(STANDARD — walking skeleton: tsconfig, one shape, its producer and readers, CI)*
2. [story-33-02-the-guard-and-verify-are-typed](story-33-02-the-guard-and-verify-are-typed/story.md) *(STANDARD)*

## Readiness

ready.
