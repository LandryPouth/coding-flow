# Story 27-02 — Failures are classified and a broken machine stops the run

## User Value

An attempt is spent only on what an attempt can fix, and two failures that
point at the machine stop the run with a diagnosis instead of burning the
next three stories (orchestration.md §2).

## Requirements

- Classifier over process exit, error subtype, verify result (19-01 test
  names, 19-02 noise) and guard log: `code`, `flaky`, `transient`,
  `usage-limit`, `overloaded`, `timeout`, `guard-denial`, `review`,
  `spec`, `environment`, `budget`. Event `failure.classified`.
- Responses per class as in the design table: attempts only for `code`,
  `timeout`, `guard-denial`; `transient` retried up to 3 times with backoff;
  `overloaded` uses `run.roles.<role>.fallbackModel` for light roles only.
- Circuit breaker: two stories failing on the same command or test name,
  two `environment` failures, or `run.healthCheck` (the project's command,
  run before each story) failing → no new story starts, running phases
  finish, one read-only diagnosis process, run `stopped: environment`.
  Caught stories are `error`, attempts kept.
- A second `guard-denial` in one story → `failed: security`, no retry.

## Acceptance Criteria

- [ ] Given a transient API error, then the phase is retried without
      spending an attempt.
- [ ] Given two stories failing on the same test name, then no new story
      starts and the run ends `stopped: environment` with a diagnosis.
- [ ] Given `run.healthCheck` failing before a story, then the breaker trips.
- [ ] Given two guard denials in one story, then it is `failed: security`.
- [ ] Given `overloaded` on the implementer, then no fallback model is used
      and the phase waits; on the walker, then the fallback is used.
