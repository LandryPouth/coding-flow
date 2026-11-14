# Story 13-09 — A directory swap is a write

## Status: planned

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

- [ ] A shell write whose destination is a path P (the destination of
      `mv`/`cp`/`rsync`/`ln`, or P plus the source's basename when the
      destination is an existing directory or ends in `/`) is denied when a
      blocked glob is `P/**` or `<an ancestor of P>/**`. The three commands
      above exit 2; `cp /tmp/x node_modules` is denied when `node_modules/**`
      is blocked.
- [ ] Moving a blocked directory *out* (`mv .coding-flow/runs /tmp/runs`)
      is denied too: it is the first half of the swap and a deletion of the
      proof by another name.
- [ ] Archive and patch writes that can land inside a blocked directory —
      `tar -x … -C <dir>`, `unzip -d <dir>`, `git apply`, `git stash pop`
      — are denied when their target is inside a blocked glob, or logged to
      `guard-unchecked.jsonl` when the target cannot be read.
- [ ] Review 13-03's P2s: `ai-flow verify` still writes its run file with
      the default blocked paths (a test pins it); `security-policy.js`'s
      commit check exempts evidence paths by the same match the doctor uses
      (`checkEvidenceBlocked`), so `.coding-flow/**` and `.coding-flow/runs/*`
      behave alike in both.
- [ ] Existing guard tests stay green, unmodified; the forms already denied
      (Write/Edit, redirects, `cp`/`mv`/`tee`/`sed -i`/`dd`/`install`/`rsync`
      to a file, `node -e`, `python -c`, `ln -s`, `truncate`) still are.
      CHANGELOG `[Unreleased]` → Security.

## Out of Scope

- Case-insensitive filesystems (`.Coding-Flow/runs` on macOS/Windows): a
  DOGFOODING row, its own story.
- Signing run files.
