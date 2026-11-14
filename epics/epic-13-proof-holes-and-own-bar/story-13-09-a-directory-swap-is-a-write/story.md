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

- Write forms the guard does not read yet — a follow-up story under the same
  rule, and a DOGFOODING row: git plumbing (`update-index`, `checkout-index`),
  `git clone` into a blocked path, `scp`, `busybox` applets, `unrar`/`jar`/`pax`.
  An extraction inside the project that misses every blocked directory stays
  `unchecked`, so strict mode refuses it.
- Case-insensitive filesystems (`.Coding-Flow/runs` on macOS/Windows): a
  DOGFOODING row, its own story.
- Signing run files.

## Decisions

- **The guard is not a complete shell model** (coordinator, re-review of
  13-09). The rule: a write form that may land a blocked path is REFUSED when
  the guard knows it does, else LOGGED `unchecked` — never a silent allow. The
  four re-review P1s are closed by that rule; the long tail of other tools goes
  to a follow-up story (Out of Scope).
- **`X/**` names X itself, for every write kind.** `blockedPathHit` also matches
  the directory a `X/**` entry blocks: an ancestor glob already matched P, and P
  equal to X now does.
- **A whole tree is judged on what it holds.** `shellWrites(…, { trees: true })`
  — the guard's call — adds a `tree` entry for a recursive copy (`cp -r/-R/-a`,
  `rsync`: DIR itself under `-T` or when DIR is not a directory, DIR when the
  source's contents are copied — `X/.`, rsync's `X/`, a glob — else DIR/<name>)
  and for each `git checkout`/`restore` pathspec. A tree is refused when it is or
  holds a blocked directory (a literal `X/**`). The per-file list without the
  option is unchanged: its tests pin it entry for entry.
- **A destination is judged as itself.** A move (`mv`, `git mv`), a link (`ln`,
  `cp -s`) or a recursive copy also gives a `tree` entry for its destination
  itself, existing or not, spelled with a trailing `/` or not — unless `-t`
  names it, or it is `.`/`..`: `rm -rf .coding-flow && mv /tmp/cf .coding-flow/`
  lands on `.coding-flow` (GNU mv/cp onto a missing `dst/` create dst). Cost:
  `mv x .coding-flow/` is refused even while `.coding-flow` exists (third review).
- **The project root and its ancestors: unchecked over path-text matching**
  (third review). A tree landing on the root or an ancestor (`..`, `/`) is
  unchecked when its source is a glob or variable, or when any earlier segment
  of the same command ran first (`&&`, `;`, a pipe, an outer segment before
  `bash -c`) — it may have made, filled or swapped the source under any name.
  Otherwise the source is read on disk: refused when it holds a literal blocked
  path at the project's place (`X/.coding-flow/runs`, `X/<project>/…` for an
  ancestor). A missing source in a one-segment command stays allowed, not
  unchecked as the coordinator's decision asked: `guard-shell.test.js` pins
  `cp -r /tmp/x/. .` as allowed, and `/tmp/x` is missing on a fresh machine; the
  copy fails there, nothing lands. `git restore .` / `git checkout <ref> -- .`
  have no source (committed content): allowed. An extraction onto the root or an
  ancestor, with `tar -P` or `--to-command`, is unchecked wherever it lands.
- **Moving out is judged at directory level.** `mv`/`git mv` sources are a
  `move` entry, refused when the source is a blocked directory or holds one.
  Moving one file out is a deletion, not judged.
- **Archives:** `tar`/`bsdtar`/`gtar` (`-x`, `--extract` and its prefixes,
  every `-C`/`--directory`/`--dir=`, `--one-top-level=`; `-O`/`--to-stdout`
  write nothing), `unzip` (`-d` read inside a cluster: `-od`, `-qod`, `-dDIR`),
  `7z x|e -oDIR`, `cpio -i|-p`, `python -m zipfile|tarfile -e` give `extract`
  entries, judged like a tree; inside the project but outside every blocked
  directory, unchecked (the contents cannot be read).
- **Patches are read, not guessed.** `git apply`/`git am`: paths from the
  repository's top (`host.gitRoot`), `-p1`, both sides of `---`/`+++` (a pair,
  not a removed `-- x` in a hunk), `rename|copy from|to`, `diff --git`, C-quoted
  names decoded; `:/X` and `:(top)X` pathspecs read from the top, other magic
  unchecked. `patch`: from the cwd, `-p0`/`-p1` (clustered too: `-Np1`), `-i
  FILE` or `< FILE`. A context diff (`***************` hunks) is unchecked.
  Another `-p`, `--directory`, `--no-prefix`, `--unsafe-paths`, `patch -d` →
  unchecked; a missing, oversized (> 4 MiB) or piped patch → unchecked.
- **Unchecked, not modelled:** `git stash pop|apply` (a DOGFOODING row: strict
  mode refuses a routine command), brace lists in a copy (`cp -r X{.bak,}`),
  `find -exec`/`xargs` handing paths to a writer, a verb from a substitution.
- **Commit check:** a file is exempt when it matches an `EVIDENCE_BLOCKED_PATHS`
  entry, whatever blocked entry covers it — the doctor's equivalence, applied to
  the file instead of the pattern.
- Expectations of this story's own red tests moved after a review: `tar -C
  /tmp` became a sibling directory (the test project lives under the temp dir,
  so `/tmp` is its ancestor). After the first review:
  `unzip -d .coding-flow` and `git apply < forge.diff` were `unchecked`; both
  are now refused (the target is known).
