# Story 05-04 — `mode: strict` fails closed

## User Value

A project that wants a hard boundary (a team repo, a client codebase, an
unattended agent) can get one with one setting: anything the guard could not
check is refused, on every host.

## Requirements

- `harness.json` `mode` already accepts `fast | standard | strict`
  (`harness.js` ~1105). In `strict`:
  - `unchecked` → treated as deny by the Claude hook (exit 2, same JSON
    shape) and by the OpenCode plugin (throw), with a reason that starts
    "not checked, refused in strict mode:".
  - The OpenCode plugin, when neither the local module nor the spawn fallback
    can produce a decision, throws instead of letting the write through.
    (The plugin reads `mode` itself from `.coding-flow/harness.json` at load —
    it cannot ask a guard it failed to load.)
- In `fast`/`standard`: unchanged from 05-02.
- `ai-flow doctor` prints the effective guard posture in one line:
  `guard: standard (unchecked writes are allowed and logged)` or
  `guard: strict (unchecked writes are refused)`.
- RULES.md template / README: one paragraph on when to choose strict.

## Acceptance Criteria

- [x] Given `mode: strict` and `F=.env; echo > $F`, when the Claude hook runs,
      then exit 2 and a deny payload.
- [x] Given `mode: strict` and an OpenCode plugin whose `BINARY` does not
      exist and whose fallback cannot run (fake `npx` failing on PATH), when a
      `write` to `src/a.js` arrives, then the plugin throws.
- [x] Given `mode: standard`, the same two cases allow (and log).
- [x] Given `mode: strict` and an ordinary session (Read/Grep/Write
      `src/a.js`), then nothing is refused.
- [x] `doctor` shows the posture line for both modes.

## Edge Cases

- **Lock-out**: strict must never refuse writes to `.coding-flow/harness.json`
  through the normal Write tool *because of strictness alone* (the user must
  be able to switch back). Blocked-path rules still apply as configured.
- **Unreadable harness.json** in the plugin: default to `standard`, log it.

## Status: done

## Result

`loadPolicy` returns `mode` (only an explicit `strict` counts). `strictOutcome` turns `unchecked` into a deny in `guardCommand` and `evaluate`, except a write-tool call on `.coding-flow/harness.json`. The plugin reads `mode` itself on each call (a switch back needs no restart), treats a spawn that could not run or gave no decision as `unchecked`, and throws on it in strict. `doctor` adds `guardMode`/`guardPosture` to its report.

Deviation: the plugin reads `harness.json` per call, not once at load. Not done: the manual check on a real OpenCode 2.x with a missing BINARY (the test loads the plugin the way OpenCode does, with a missing binary and a failing fallback).
