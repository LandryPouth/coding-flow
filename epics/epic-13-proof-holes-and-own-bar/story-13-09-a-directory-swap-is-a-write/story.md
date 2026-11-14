# Story 13-09 — A directory swap is a write

## Status: in-progress

Found by the independent review of story 13-03 on `develop` (2026-11-14,
P1). The guard matches a blocked glob `X/**` against the path a shell
command writes to, but never against `X` itself. So an agent can rewrite the
proof end to end by swapping the whole directory, and nothing is denied or
logged as unchecked:

- `mv .coding-flow/runs /tmp/runs && sed -i s/failed/passed/ /tmp/runs/*.json && mv /tmp/runs .coding-flow/`
- `cp -R /tmp/runs .coding-flow/`, `cp -r /tmp/r2/ .coding-flow/runs`

Run files carry content hashes, not signatures, so a forged file reads as
proof. The same gap holds for every `X/**` entry (`cp /tmp/x node_modules`).

*(STRICT — the guard's denial logic, `bin/lib/guard.js` and
`bin/lib/shell-writes.js`; behavioural tests feeding payloads to
`ai-flow guard` on throwaway repositories.)*

## Acceptance Criteria

- [x] A shell write whose destination is a path P (the destination of
      `mv`/`cp`/`rsync`/`ln`, or P plus the source's basename when the
      destination is an existing directory or ends in `/`) is denied when a
      blocked glob is `P/**` or `<an ancestor of P>/**`. The three commands
      above exit 2; `cp /tmp/x node_modules` is denied when `node_modules/**`
      is blocked.
- [x] Moving a blocked directory *out* (`mv .coding-flow/runs /tmp/runs`)
      is denied too: it is the first half of the swap and a deletion of the
      proof by another name.
- [x] Archive and patch writes that can land inside a blocked directory —
      `tar -x … -C <dir>`, `unzip -d <dir>`, `git apply`, `git stash pop`
      — are denied when their target is inside a blocked glob, or logged to
      `guard-unchecked.jsonl` when the target cannot be read.
- [x] Review 13-03's P2s: `ai-flow verify` still writes its run file with
      the default blocked paths (a test pins it); `security-policy.js`'s
      commit check exempts evidence paths by the same match the doctor uses
      (`checkEvidenceBlocked`), so `.coding-flow/**` and `.coding-flow/runs/*`
      behave alike in both.
- [x] Existing guard tests stay green, unmodified; the forms already denied
      (Write/Edit, redirects, `cp`/`mv`/`tee`/`sed -i`/`dd`/`install`/`rsync`
      to a file, `node -e`, `python -c`, `ln -s`, `truncate`) still are.
      CHANGELOG `[Unreleased]` → Security.

## Out of Scope

- Case-insensitive filesystems (`.Coding-Flow/runs` on macOS/Windows): a
  DOGFOODING row, its own story.
- Signing run files.

## Decisions

- **`X/**` names X itself, for every write kind.** `blockedPathHit` also matches
  the directory a `X/**` entry blocks, so the destination rule needs no special
  case: an ancestor glob already matched P before, and P equal to X now does.
- **Moving out is judged at directory level only.** `mv` sources are a new
  `move` entry, denied when the source *is* a blocked directory or holds one (a
  literal `X/**` prefix: `mv .coding-flow /tmp/cf`). Moving one file out from
  under it stays allowed — a deletion, which the guard does not judge
  (`rm .coding-flow/runs/x.json` is not denied either). A source already read as
  a write (`mv a ./`) is judged as that write, so `shellWrites` output for the
  existing forms is unchanged.
- **Archives: deny into a blocked directory, unchecked elsewhere in the
  project.** `tar` (`-x`/`--extract`/`--get` or the bare `xf` word, `-C`/
  `--directory`) and `unzip` (`-d`; listing flags `-l -p -t -v -z -Z` are reads)
  give an `extract` entry. Its contents cannot be read, so an extraction inside
  the project that misses every blocked directory is a shell limit, logged to
  `guard-unchecked.jsonl`; outside the project it is allowed.
- **Patches are read, not guessed.** `git apply` reads each patch through the
  guard host (≤ 4 MiB) and judges the `+++ b/…`, `rename|copy to …` and
  `diff --git … b/…` paths, relative to the cwd with the `b/` prefix assumed
  (`-p2` or `--directory` are not modelled). `--check/--stat/--numstat/--summary`
  without `--apply` write nothing. A missing, oversized or stdin patch, and
  `git stash pop|apply`, are unchecked: strict mode refuses them.
- **Commit check:** a file is exempt when it matches an `EVIDENCE_BLOCKED_PATHS`
  entry, whatever blocked entry covers it — the doctor's equivalence, applied to
  the file instead of the pattern.
