# Story 34-02 — `next` answers in seconds

## User Value

On a repository with ~190 stories (bethl), `ai-flow next` answers in a few
seconds instead of minutes, so the maintainer and the agents actually use it.

## Implementation Context

- Measured 2026-11-25: `ai-flow next` on bethl did not answer within 110 s;
  31-04's dry runs put the status model at ~80 s, almost all in per-story
  `currentTreeToken`-style git reads. A CPU profile of `next` on bethl is the
  first task (`node --cpu-prof`), recorded in the Result with the top frames.
- Likely files: `bin/lib/status.js` (`buildStatusModel`), `bin/lib/identity.js`,
  `bin/lib/evidence.js`, `bin/lib/next.js`. Likely fix: compute repository-wide
  git facts once per run (one `git ls-files -s`/`git status` and one `git log`
  pass) and share them across stories instead of spawning git per story; no
  persistent cache file unless the profile proves it is needed (design
  decisions refuse a daemon).
- Execution mode STANDARD. Scout: yes (profile first). Avoid: changing what any
  state means — only how fast it is computed.

## Acceptance Criteria

- [ ] Given a read-only clone of bethl, when `ai-flow next` runs, then it
      answers in under 5 s on the maintainer's machine (time recorded in the
      Result, before and after, with the profile's top frames).
- [ ] Given the same clone, when `ai-flow status --json` and `ai-flow next
      --all --json` run before and after the change, then their outputs are
      identical (diffed in a test fixture or recorded in the Result).
- [ ] Given a generated repository with 200 stories in a throwaway directory,
      when `next` runs, then the number of git processes it spawns does not
      grow with the number of stories (asserted by counting spawns through a
      test hook or a wrapped `git` on PATH).
- [ ] Given this repository, when `npm test` runs, then every existing status,
      next and archive test passes unchanged.

## Commands

```bash
npm test
```

## Result
