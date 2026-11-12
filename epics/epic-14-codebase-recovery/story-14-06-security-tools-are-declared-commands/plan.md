# Story 14-06 — Plan

## Implementation Context

- **Execution mode**: STANDARD.
- **Likely files**: `bin/lib/validation-run.js` (entries ~81–140, toolError
  ~259), `bin/lib/evidence.js`, `bin/lib/harness-report.js`,
  `bin/lib/bootstrap.js` (recipes), `bin/lib/recover.js` (report),
  `bin/lib/config.js` (schema), `docs/QUICKSTART.md`.

## Decisions

- **No bundled scanner, no download** (zero runtime dependencies): the
  developer installs what they want; the tool proves what ran.
- **Network failure is `not-examined`** because the field test's only
  dependency audit timed out offline; recording it as a failure would teach
  people to delete the command, as a pass would lie.

- **The network test matches whole lines in each scanner's own error shape**
  (independent review: round 1 P1, round 2 P1/P2). A bare token anywhere let
  the scanned code (`err.code === "ENOTFOUND"` on a flagged line) turn a red
  scan into a warning; reading stderr only then missed pnpm, which prints its
  failure on stdout. Now: the last 5 non-empty lines of **each** stream, stack
  frames (`    at …`) skipped, matched against line-start-anchored shapes —
  Node fetch as npm and pnpm print it (`… request to <url> failed, reason:
  getaddrinfo ENOTFOUND <host>`), Python `requests` (`…ConnectionError: …
  NameResolutionError …`, pip-audit and semgrep), Go (`govulncheck: … dial
  tcp: lookup <host>: no such host`). A semgrep code echo starts with its
  line number (`12┆`) and does not match. Provenance: the npm and pnpm shapes
  were reproduced live by the reviewer (npm 11.4.0, pnpm 10.13.1); the
  govulncheck shape is read from its source (v1.1.4); the pip-audit shape is
  the uncaught `requests` error, not observed live — a version that wraps it
  (`Could not connect to PyPI's vulnerability feed`) reads `fail`, as does
  semgrep's own offline message and any other Go resolver failure (the safe
  direction). Residual: a scanner that prints repository text verbatim at
  the start of a line, after any indentation, in exactly one of these
  shapes, as one of its last 5 lines; accepted.
- **A project registry override can produce not-examined** (independent
  review, round 3, P2): npm and pnpm read the repository's `.npmrc`, so a diff
  that sets `registry=` to an unresolvable host turns an audit into a
  genuine resolver failure — a warning outside strict. Not restricted to
  known hosts: a private registry offline would then read `fail` and teach
  the command's deletion. Accepted because it is visible twice — the
  `.npmrc` change is in the diff, and the bogus host is printed in the reason
  in `verify`, `run` and the PR body. Under `mode: strict` it fails.
- **"strict" is `mode: strict` only**, like the coverage gate
  (`contraryPolicy`): a high-risk diff alone does not make a not-examined
  scanner fail. Making risk escalate it is a policy change for its own story.
- **Not-examined outside strict is a warning-pass everywhere**: `status`,
  `next` and `audit` count the proof as green, as they do for any warning;
  `verify`, `run` and the `ship` PR body name the scanner and the reason.
- **`report` lists failures only**, so a non-strict not-examined (a
  warning-pass) is not in it; `verify`, `run` and the PR body carry it.
- **A command listed in both `commands` and `security`** is judged as
  security; declaring one command twice is not supported.
- **Windows:** cmd.exe reports an unknown command as exit 1 (or 9009), not
  127, so a missing scanner fails there instead of warning — the safe
  direction; not detected.
- **Output over the capture buffer** (256 MB, ENOBUFS) stays a tool error and
  so not-examined, per the spec's "existing toolError cases": the exit code is
  unknown, so neither pass nor fail is observed.
- **`validation.security` is emitted only when declared**, because
  `validation` is hashed into every proof's policy fingerprint: an empty key
  made every existing proof stale (independent review, P2).
- **Exit 126 is not-examined too** (found, not executable): same "looked at
  nothing" as 127.
- **A proof carrying a not-examined scanner is never replayed**: the network
  may be back on the next run, and a replay would keep the warning forever.
- **Recipes read root manifests only**; `npm audit` needs a lockfile, so it
  is suggested on `package-lock.json`/`npm-shrinkwrap.json`, not on a bare
  `package.json`. `pnpm audit` needs `pnpm-lock.yaml` (the workspace file
  alone is not enough), and pnpm suppresses the npm recipe. A declared
  command matches a recipe as whole words (`pnpm audit` is not `npm audit`). `govulncheck` and
  `pip-audit` are suggested on the manifest alone (the developer installs
  them); `gitleaks`/`semgrep` only when on `PATH`, as specified.
- **Shared module** `bin/lib/security-recipes.js`: bootstrap and recover both
  need the recipes; recover adds the declared/undeclared split.

## Acceptance Traceability

- 1–3, 5 → `test/security-commands.test.js`; 4 → `test/bootstrap.test.js`;
  the recover report → `test/recover-scan.test.js`.
