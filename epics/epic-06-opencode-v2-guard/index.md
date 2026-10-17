# Epic 06 — The OpenCode guard runs on OpenCode 2

## Goal

The guard plugin `ai-flow` writes for OpenCode refuses a write to `.env` on
OpenCode 1.x **and** on OpenCode 2.x, from one generated file, and `doctor`
says so — or says plainly when it cannot.

## Why

Measured 2026-10-16 (see `docs/plans/hardening-roadmap.md`): OpenCode 1.19
already offers `opencode upgrade --major` and a `/update` menu entry; on
2.0.30 the generated plugin (`export const CodingFlowGuard = async
({ directory }) => ({ "tool.execute.before": … })`) is the V1 shape, V2 reports
"1 plugin failed", and a real model wrote `.env` with nothing in the way. The
skills and the `/flow-*` commands keep working on V2 — only the guard is gone,
and nothing says so. A guard that disappears on a host upgrade is the worst
kind of fail-open: the user believes they are covered.

A dual-shape plugin was built and checked in the sandbox on both versions with
real models: write tool and `echo … > .env` refused on 1.19.0 and 2.0.30, the
seven `/flow-*` commands still present on 2.0.30.

## Scope

**In scope**

- One generated plugin file with both entry shapes: the V1 hook map and the V2
  `{ id, server, setup }` default export whose `setup(ctx)` registers
  `ctx.tool.hook("execute.before", …)`.
- V2 argument names (`path`, `oldString`/`newString`, `shell`, `patch`)
  mapped to the same Claude-shaped payload `decide` reads.
- `doctor` detects the installed OpenCode major version and a plugin file
  written before this epic (no V2 entry), and says what to run.
- This repository's own tracked plugin stops carrying the maintainer's
  absolute path.

**Out of scope — decisions made while planning**

- **Distributing coding-flow to OpenCode as an npm plugin** (`"plugin":
  ["@landry_pouth/coding-flow"]`). Measured: unpinned specs never update on
  V1 or V2 (`plugin check` saw nothing), an offline registry at update time
  removes skills, commands and guard (V1 after a 69 s hang, V2 silently), and
  on V1 plugin-provided skills shadow the user's project edits. Files stay the
  distribution channel; the plugin stays a single generated guard file.
- **Loading the global package by path as a plugin.** Viable later (one
  `npm i -g` updates everything) but a vanished path after an `nvm` switch is
  silent on V1. Revisit when V2 is stable.
- **Stricter fail-closed behaviour.** Belongs to epic-05 (`unchecked`
  decision, `mode: strict`); this epic only restores parity with V1.

## Backbone

`Backbone: OpenCode (1.x or 2.x) loads .opencode/plugins/coding-flow-guard.js → a write tool call reaches the guard with the right path and content → decide() refuses .env → the model sees the refusal → doctor reports the guard as wired for the detected OpenCode major`

### Story dependency tree

```text
s1
├── s2
└── s3
```

`s1` is the walking skeleton and the whole user value. `s2` (doctor) and `s3`
(self-install path) read what `s1` generates; they touch different files and
can run in parallel.

## Stories

1. **story-06-01-dual-shape-guard-plugin** — the generated plugin carries both
   entry shapes and maps V2 argument names. *(STRICT — security boundary; a
   mapping mistake allows the write silently, exactly what the V1-only file
   does today)*
2. **story-06-02-doctor-knows-the-opencode-major** — `doctor` reads
   `opencode --version`, flags a pre-06 plugin on a 2.x host as "guard not
   loaded", and names `ai-flow upgrade` / `upgrade --global`. *(STANDARD)*
3. **story-06-03-repo-plugin-without-absolute-path** — this checkout's tracked
   plugin resolves `bin/ai-flow.js` relative to itself. *(QUICK)*

## Decisions

- **One file, two shapes — not two files.** OpenCode 1.19 also calls
  `setup(ctx)` with a partial context (no `ctx.tool`); `setup` must return
  early when `ctx.tool.hook` is absent, otherwise 1.19 crashes the plugin.
  Measured in the sandbox.
- **V2 uses the ESM default export only.** V2 silently ignored a CommonJS
  package root in the sandbox; the generated file is already ESM.
- **AGENTS.md's rule applies: "a guard that is not verified is not claimed".**
  `s1` is not done until a refusal was seen on a real OpenCode 2.x, not only in
  `node:test`.

## Readiness

**ready.** The prototype exists and was validated; the anchors are in each
story's plan.

## First story to run

`story-06-01-dual-shape-guard-plugin` via `/flow-run`.
