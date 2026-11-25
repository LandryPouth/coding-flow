# Rules and limits

Every rule that governs Coding Flow, with its default, its cap or threshold, how
to change it, and where it is defined. Part 1 is what the shipped code does
today. Part 2 is what epics 18–29 plan and is not built yet.

Generated from the sources on 2026-11-13 (commit `e00ff82`). Part 1 is read from
`bin/lib/` and the shipped skills, not from other docs. Part 2 is read from the
epic and story files. Any PR that changes a default, a threshold or a planned
value updates this page in the same PR. "not set" means no value exists in the
sources: there is no default to look up.

Since story 26-06 the keys `ai-flow rules` prints come from one registry,
`bin/lib/rules-registry.js`: the config readers take their defaults from it, and
`test/rules-registry.test.js` fails, naming the key, when a default there and
the Default cell of its row below disagree. `ai-flow rules [<key>] [--json]`
prints each one's value in force in a project and where it came from
(`default`, `project`, `auto: <reason>`, `fixed`).

Paths are relative to the repository root. `file:line` points at the code.
Story references point at the story's `spec.md` unless another file is named.

---

## Part 1 — In force today (shipped code)

### Configuration files and where they live

| Rule | Default | Max / threshold | Change with | Source |
|---|---|---|---|---|
| Project config file | `.coding-flow/config.json`, written once by `init`, never overwritten by upgrades. A missing or corrupt file is read as the defaults | — | edit the file; `upgrade --with-skills/--no-skills`, `--minimal/--full`, `--target` change their own keys | `bin/lib/config.js:39-41`, `:88-94`, `:164-188` |
| `storage` | `local` | `local` or `github` (`github` is reserved, not implemented) | `init --storage` | `config.js:16`, `:46` |
| `branchPerEpic` (one epic = one branch, never main) | `true` | Advisory: `status` warns when you are on `main`, `master` or origin's default branch. Nothing is refused | `init --no-branch-per-epic`, or the key | `config.js:47`, `:154-155`; `bin/lib/policy.js:43-56`; `bin/lib/status.js:461` |
| `autoMergeEpic` | `false` | — | key; per run `ship --auto-merge` / `--no-auto-merge` | `config.js:53`; `bin/lib/ship.js:651` |
| `protectBranches` (story 29-08) | `true` | GitHub only, classic branch protection: `init` and `ship` require, on the default branch and `baseBranch`, the check runs reported both on the branch's latest commit and on every one of the last 5 pull requests into it (a push-only check, or one that runs only on some pull requests — forks only, a `paths:` filter on one workflow — is never required; a recent pull request that ran no checks at all → nothing sent for that branch, exit 2: an unprotected branch says "a recent pull request ran no checks (a `paths:` filter?) — requiring checks would block such pull requests forever", a branch already protected is left as is, nothing sent: "left as is (requires …) — a recent pull request ran no checks; requiring more would block such pull requests" (with no required check: "left as is (no required check; its other rules kept) — …"); GitHub refusing the added checks on an existing protection says "left as is — GitHub refused adding required check(s) …"; no pull request yet → nothing sent); only adds checks, never removes a rule; no CI, no `gh` or no admin rights → nothing sent, the reason printed. A ruleset-governed branch is left alone; one whose ruleset has no required status checks rule → exit 2, "add a required status checks rule to the ruleset protecting <branch>" | key; `init --no-protect`; `ai-flow protect` by hand | `bin/lib/protect.js` |
| `skills` (plugin or project copy) | `project` (also the fallback for configs written before the key existed) | `plugin` or `project` | `upgrade --with-skills` / `--no-skills` | `config.js:23`, `:57` |
| `install` | `full` | `full` or `minimal`. You can only move from minimal to full | `init --minimal`, then `--full` | `config.js:31`, `:60`, `:221-229` |
| `target` / `alsoTargets` | `claude` / `[]` | `claude`, `codex`, `gemini`, `opencode`, `antigravity`. An invalid value is read as `unrecognized` | `init --target` | `config.js:36`, `:64-67`, `:101-110` |
| `validation.commands` | `[]`. When empty, verify uses plan.md's `## Commands`, then the package.json scripts | — | key | `config.js:68-82` |
| `validation.quality` | `[]`. Runs like a command: a red quality check blocks | — | key | `config.js:73-82` |
| `validation.security` | `[]` (absent from the file until declared) | A scanner that cannot run is `not examined`. That is a warning, or a failure in `strict` mode | key | `config.js:139-141`; `bin/lib/evidence.js:386-394` |
| `validation.freshCommands` | `[]` | — | key | `config.js:136` |
| `todo.headings` (what `ai-flow todo` reads in an epic `index.md`) | `Maintainer to-do`, `Maintainer cleanup on delivery` | Headings match at any level, case-insensitive, when the heading starts with the configured text followed by the end, a space, `(`, `:`, `—`, `–` or `-` (`## À faire côté utilisateur (epics 39 et 40)` matches; `## Maintainer to-dos` does not); the same rule finds `## Needs you (round 2)`. Only unchecked `- [ ]` items under them are listed (a plain `- ` bullet is not a to-do), blockquoted ones included. A value that is not a list of non-empty strings falls back to the defaults. `[]` counts as unchecked; nested items are listed. `todo` also lists each story's `## Needs you` items (top-level list items not `[x]`, their sub-items as options, and prose paragraphs), `Owner: human` stories — at the start of a line, a one-line reason allowed (`Owner: human — touches money`, not `human-in-the-loop`), in a blockquote, or `owner: human` in front matter — both only while the story is not finished (done, verified, stale), and `[~]` items under `## Acceptance Criteria` (finished stories included). Code and HTML comments are skipped: a fence opens at any indent, even with closing backticks on the same line (safe side), and an unclosed one runs to the end of the file; an indented block counts as code outside a list; `<!-- … -->` may span lines (a marker inside a `code span` or on a fence's opening line is text). A heading inside a blockquote is quoted text, not a section. Unknown flags and extra arguments are refused. Read-only | `config.json` (bethl: `["À faire côté utilisateur"]`) | `bin/lib/todo.js` |
| `validation.fix` | `[]` (absent from the file until declared) | Fixers run before every check and may rewrite files; the files they changed are listed as `fixedFiles` and left uncommitted. A red fixer is a red verify. `land`'s re-verify skips them, and so do red-at-base and the mutation probe: they run the checks only, so a base that is dirty only by lint reads red at base. Fixers alone, with no check, are a red verify, and do not run. A file a fixer touched is the story's diff, exactly like a hand edit, in every signal; verify warns (`fixerStrengthened`, no verdict change) when a test file the gate counted as strengthened was a fixer's rewrite; a fixer's reformat alone is `neutral`, like the same edit by hand (story 19-08). Fixers run before verify reads anything (risk, fresh-test requirement, commands, coverage), so one tree gets one verdict. Under `.coding-flow/` a JSON or JSONL file whose parsed value is unchanged is no write (a formatter re-indenting the run files) and is listed as `reformatted`; the guard's logs may only grow or be the guard's own trim, and are listed as `guardLogs`. Any other change there — a new, removed or rewritten file, read even where it is gitignored — or any change to a story file (`epics/`, `specs/`, `.specify/`, the story in scope), reformat included, is a red verify that names the remedy (add `.coding-flow/` and the story roots to the formatter's ignore file) — for that run: the next verify finds nothing to fix and judges those files as they now are. `fixedFiles` paths are relative to the project root; a write beside a project below the repository top reads `../…`. Outside git `fixedFiles` is null and that rule cannot apply. With fixers declared, a proof is reused only while the story roots and `.coding-flow/` (minus `runs/` and the guard logs) are unmoved. Limit: on Windows with `core.autocrlf=true` a fixer's line-ending-only change is not seen. Limit: a fixer is a command like any other, and a write outside the work tree is neither stopped nor listed. A `## Fixers` block in `plan.md` is refused unattended like plan commands | key | `bin/lib/validation-run.js` (`resolveValidationCommands`); `bin/lib/evidence.js` (`runFixers`) |
| `validation.timeoutMs` (global) and `{ command, timeoutMs }` (per command) | `600000` ms (10 min) per command when not set — one default, read by the runner and by `land`'s lock sizing | none. A non-positive value is dropped | key | `config.js` (`readConfig`); `bin/lib/validation-run.js` (`commandTimeoutDefault`); `bin/lib/rules-registry.js` |
| `docs.check.include` / `docs.check.exclude` / `docs.check.ignorePaths` | 3 globs (`docs/**/*.md`, `README.md`, `RULES.md`) / `[]` / `[]` | Each a list of non-empty strings; an empty or invalid list reads as unset. `**/` may match no folder (`docs/**/*.md` reads `docs/<page>.md`). Explicit paths on the command line replace include and exclude | key | `bin/lib/docs-check.js` (`docsCheckSettings`) |
| Harness policy file | `.coding-flow/harness.json`, created by `init`. A missing file means the defaults apply. An array key you set **replaces** the default list; nothing is merged | — | edit the file | `bin/lib/harness-config.js:32-34`, `:314-369`, `:371-382` |
| `mode` | `standard` | Only the exact string `strict` tightens anything. A typo or an unreadable file reads as `standard` | key | `harness-config.js:238`; `bin/lib/guard.js:144-146` |
| `requireTestChange` (coverage gate on/off) | `true` | — | key | `harness-config.js:242`; `bin/lib/coverage-gate.js:350-352` |
| `minPatchCoverage` | `80` % of the added lines that coverage measured | number; anything else falls back to 80 | key | `harness-config.js:248`; `coverage-gate.js:182` |
| `coverageReports` | 6 paths (`coverage/lcov.info`, …) | — | key | `harness-config.js:16-23` |
| `coverageFloor.high` (rung a high-risk story must reach) | `auto`: `evidence`, or `verified` under `mode: strict`. Written as `auto` to a new `harness.json` (story 26-08); an absent, `auto` or unknown value reads the same | rungs: `verified` > `evidence` > `exempted` > `not-required` | key | `bin/lib/coverage.js` (`resolveCoverageFloor`) |
| `coverageFloor.medium` | `evidence` (written to a new file) | same rungs | key | `coverage.js` (`resolveCoverageFloor`) |
| `coverageFloor.low` | `not-required` (written to a new file) | same rungs | key | `coverage.js` (`resolveCoverageFloor`) |
| `failOnContrarySignals` | `false` (written to a new file) | When `true`, a high-risk story fails on contrary signals. Read at the diff base too (HEAD in working-tree scope): `true` in either wins | key | `coverage-gate.js:640`, `:662-677` |
| `freshTestsFor` (risk levels where a fully cached run is not proof) | `[]` | — | key | `harness-config.js:251`; `evidence.js:397-405` |
| `functionSize.max` | `80` lines. Also a CRAP threshold of 30, fixed | — | key | `harness-config.js` (`DEFAULT_FUNCTION_SIZE`); `bin/lib/complexity.js` |
| `functionSize.enforce` | `false` | `true` turns the warning into a failure | key | `harness-config.js` (`DEFAULT_FUNCTION_SIZE`) |
| `redAtBase.command` | `null` (`--red-at-base` then fails with an example) | — | key | `harness-config.js` (`defaultHarnessConfig`); `bin/lib/red-at-base.js` |
| `redAtBase.timeoutMs` | `null`, which means the command default (10 min) | — | key | `bin/lib/red-at-base.js` |
| `mutation` | absent (off). `{ command, maxMutants: 20, link: [], timeoutMs: 1800000 }`; `command` takes `{files}`; JS/TS only | runs only on a `high` risk diff (the higher of the base's and the tree's risk keys; a base with no readable `harness.json` counts as the defaults) or under `--claim refactor`; survivors fail verify only where contrary signals do (strict, or `failOnContrarySignals` on high risk, each read at the stricter of the base and the tree) | key; a survivor is excused by a `## Mutation Exemption` naming `file:line` | `bin/lib/mutation.js`; `scripts/mutation-probe.js` |
| `highRiskPaths` | 24 globs | — | key | `harness-config.js` (`defaultHighRiskPaths`) |
| `highRiskTerms` | 17 terms | — | key | `harness-config.js` (`defaultHarnessConfig`) |
| `testGlobs` | 13 globs | — | key | `harness-config.js` (`defaultTestGlobs`) |
| `nonBehaviorGlobs` | 27 globs | — | key | `harness-config.js` (`defaultNonBehaviorGlobs`) |
| `policyGlobs` | 15 globs | Read at the diff base (`policyGlobsAtBase`); `.coding-flow/harness.json` and `.coding-flow/config.json` always count (`OWN_POLICY_FILES`); under `--claim refactor` the defaults and the test-runner configs always apply, plus the tree's list (`claimPolicyGlobs`) | key | `harness-config.js` (`defaultPolicyGlobs`); `policy-drift.js`; `claim.js` |
| `ignoredPaths` | `[]` | — | key | `harness-config.js` (`defaultHarnessConfig`) |
| `blockedPaths` | 10 globs | The guard also refuses shell writes to `.coding-flow/harness.json` (`shellBlockedPaths`) | key; `doctor` warns when it lacks the evidence paths | `harness-config.js` (`defaultHarnessConfig`); `bin/lib/doctor.js` |
| `sensitiveGlobs` | 5 globs | — | key | `harness-config.js` (`defaultHarnessConfig`) |
| `requiredChecks` | 4 checks | Names the harness contract lists and `harness check` prints; nothing runs them. A high-risk story adds `security-check`, `server-side-validation`, `rollback-evidence` (`evidence.js`) | key | `harness-config.js` (`defaultHarnessConfig`) |
| `secretPatterns`, `secretScanAllowlist` | 6 (5 exact, 1 heuristic) / 12 entries. Not printed by `ai-flow rules` (no secret-looking key is) | `exact` patterns apply everywhere. The allowlist only relaxes `heuristic` ones | key | `harness-config.js` (`defaultSecretPatterns`, `defaultSecretScanAllowlist`) |
| `destructiveCommands` | `deny` | `deny`, `warn` (allowed, said on stderr and kept in `guard-warnings.jsonl`) or `off`. Any other value, or an unreadable file, reads as `deny` | key — the human's edit: the guard refuses an agent write that loosens it | `bin/lib/guard.js` (`destructivePolicy`) |
| `allowDestructive` | `[]` | Exact commands, word by word (`git clean -fdX` does not allow `git clean -fdx`, and `rm -rf node_modules` does not allow `rm -rf node_modules ~`); a last word `*` allows any later words after an operand, `~` included — `rm -rf node_modules *` allows `rm -rf node_modules ~`: the human's choice (`git clean -fdX -- build *`); an entry whose words before `*` are only the verb (with git, its subcommand) and flags — `*`, `rm *`, `rm -rf *`, `git clean *`, `git clean -fdX *` — is ignored, and the refusal names it. Read on the command without its wrappers (`sudo`, `env`) or git's global options | key — the human's edit | `bin/lib/guard.js` (`allowedByPolicy`) |
| `worktrees.primaryLocked` | `false` | `true`: a branch change (`checkout`, `switch`, `rebase`, `merge`) in the primary checkout is refused; in a linked worktree it is not. The primary checkout's own policy counts too | key — the human's edit | `bin/lib/guard.js` (`settle`) |
| User global config `~/.config/coding-flow/config.json` | **does not exist yet** (planned, Part 2) | — | — | 19-03, 21-02, 24-02 |

### Proof and verify

| Rule | Default | Max / threshold | Change with | Source |
|---|---|---|---|---|
| Per-command timeout | 600 000 ms (10 min), the registry's `validation.timeoutMs`. A timed-out command exits 124 | — | `validation.timeoutMs` / per-command `timeoutMs` | `validation-run.js` (`commandTimeoutDefault`, `runValidationCommand`) |
| Output buffer per command | 256 MB. Past it the result is a tool error, not a red | — | env `CODING_FLOW_MAX_OUTPUT_BYTES` | `validation-run.js:168-171`, `:289-291` |
| Output kept in evidence | last 4 000 chars per stream | — | not configurable | `validation-run.js:280` |
| Failure lines quoted | 12 lines, 500 chars each | — | not configurable | `bin/lib/util.js:431-432` |
| plan.md commands are not run when nobody watches | Refused when `CI` is set to anything other than empty, `0` or `false`, or when stdin and stdout are not both a TTY. A line that only calls one of the project's own package.json scripts (`npm test`) is allowed | — | declare the commands in `config.json`; or the user runs `verify --allow-plan-commands` from their own terminal. `AI_FLOW_FORCE_TTY=1` is honoured only with `NODE_ENV=test` | `validation-run.js:236-263`; `evidence.js:371-373`, `:443` |
| Agent cannot grant itself plan commands | The guard refuses a Bash call that carries `verify --allow-plan-commands` or `AI_FLOW_FORCE_TTY=`, including through nested `bash -c` | nested `bash -c` is checked up to 3 levels deep | — | `guard.js:542-569` |
| Destructive commands wait for the human | **What it claims:** the guard refuses the destructive forms an agent writes by habit and marks unchecked what it cannot read; a form built to evade it (unusual quoting, generated code, interpreter strings such as `python -c`, a two-step git alias, a script file written then run) is out of its reach — against an adversarial agent the protection is the sandbox and permissions (design-decisions entry 10). Refused by default: `git reset --hard`; `git checkout`/`git restore` of a modified path; `git clean -f`; `git push --force`/`-f`/`--force-with-lease`/`+refspec`; `git branch -D`, `git branch -f <name>`/`-M`/`-C`, `git worktree remove --force`, `git stash drop`/`clear`; `rm -r`; `prisma migrate reset`, `prisma db push --force-reset`/`--accept-data-loss`, `dropdb`, `DROP DATABASE` in `psql -c`; `docker system prune`, `docker volume rm`/`prune`; a download piped to a shell. Read through `cd`, `git -C`, `bash -c`, `eval`, `"$(…)"` and backticks, `xargs`, `parallel`, `find -exec`, `npx`/`pnpm`/`yarn`, and wrappers (`sudo`, `env`, `setsid`, `flock`, `taskset`…). The refusal names what it destroys and the safe command | `bash -c` and `eval` followed 4 levels deep. A destructive command named after a command the guard does not read (`firejail rm -rf x`) is unchecked; after an inert one (`echo`, `grep`, `which`, `man`) it is text. A command substitution that does not close is unchecked; a `case` pattern's `)` inside `"$(…)"` ends it early. An expansion where a flag may sit (`git reset $MODE`) is unchecked. Past 4 nested scripts the call is unchecked. A long option is read by prefix (`--har`). `git -c alias.…` is unchecked; an alias in the config is resolved (`git config --get alias.<sub>`; a `!` alias read as a script; a lookup that fails or a chain past 5 is unchecked). A git lookup waits 2 s; after one timeout, the later git checks of the same decision are unchecked without waiting. git not on the guard's PATH, or an answer over 64 MB, makes the check unchecked. Not read: a heredoc fed to `psql`, `npm run <script>`, `npx rimraf`, `rsync --delete`, `python -c "shutil.rmtree(…)"`, `git push --delete`/`--mirror`, `git pull`, `git update-ref -d`, `git reflog expire`, `git gc --prune=now`, `git filter-branch`, `git rm -rf`, `find -delete` (outside the policy file), `mysql -e`, `docker compose down -v`, PowerShell | `destructiveCommands`, `allowDestructive` | `bin/lib/destructive.js`; `guard.js` (`judgeDestructive`) |
| Destructive-command backstops | A line is allowed only when every construct in it is modelled. Unchecked: a here-string `<<<`, `$'…'`, `$IFS`/`IFS=`, `~+`/`~-`/`~user`, an extended glob `@(…)`, arithmetic on anything but literals (`$((x+1))`, `[[ … -eq … ]]`), `expand_aliases`, `case`/`coproc`/`select`/`let`, a quote or substitution that does not close, a verb built by an expansion or a glob (`$X`, `rm$IFS-rf`, `/bin/r?`), brace expansion outside the path operands of `rm`/`mv`/`cp`/`mkdir`/`touch` or an inert command. A word with a space handed to a command that is not inert, which reads as a destructive command (`ssh host 'git reset --hard'`), is unchecked; so is the policy file's path handed to a command the guard does not read (`python3 -c …`). Inert: `echo printf grep egrep fgrep rg which whereis type man help cat head tail ls wc uniq cut stat file cmp md5sum sha1sum sha256sum test [ true false basename dirname realpath readlink du jq` (`rg --pre`, `man -P` excepted); git's and gh's message, body, title, grep and format options are text | standard mode allows an unchecked call and logs it; strict refuses it | — | `bin/lib/destructive.js` (`unmodelledSyntax`, `readHandedText`) |
| The policy file from a shell | A shell write, move, removal of, or link to `.coding-flow/harness.json` (this checkout's, or the primary checkout's from a linked worktree), or of a directory holding it, is refused (the guard cannot read what it changes): globs are matched (braces and the common POSIX classes modelled; a pattern it cannot model counts as matching), `cp /dev/null`, `git mv`, `find … -delete` and `find -exec cp /dev/null {}` included. Unchecked: an expansion that may name it, paths handed by `xargs` to a remover or copier, `find -exec` of a command the guard does not read. An unreadable policy file keeps the primary checkout locked. Not read: `git stash` taking an uncommitted edit of it away (recoverable with `git stash pop`; commit a tightening). On a case-insensitive file system `HARNESS.json` is the same file. A NotebookEdit of it is refused; a write tool may edit it unless the edit loosens the destructive policy | — | — | `guard.js` (`policyLoosening`, `touchesPolicyFile`) |
| `--clean-env` | off. When on, drops every env var whose name matches SECRET, TOKEN, PASSWORD, PASSWD, PRIVATE, CREDENTIAL, API_KEY or ACCESS_KEY. `PATH`, `HOME` and `CI` are always kept | — | `verify --clean-env` | `validation-run.js:209-226` |
| Story risk from prose | A high-risk term, or one of `api`, `crud`, `form`, `persistence`, `integration`, `config`, `settings`, gives `medium`. Otherwise `low` | prose **caps at medium** | `highRiskTerms` | `bin/lib/risk.js:22-55` |
| Diff risk | `high` when a changed path matches `highRiskPaths` or a structural git signal (`git worktree remove`, `branch -D`, `reset --hard`, `merge`). Otherwise `low` | only the diff can reach `high` | `highRiskPaths` | `risk.js:66-71`, `:173-197`, `:91` |
| Combined risk | the higher of story and diff | — | — | `risk.js:204-220` |
| Coverage gate applies | at medium and high risk only. Low risk is skipped | — | `requireTestChange` | `coverage-gate.js:373-374` |
| Coverage rungs | `verified` (measured ≥ `minPatchCoverage`), `evidence` (a test file strengthened: it adds test code the diff did not remove from a test file. `neutral` means provably nothing new — across all test files of the diff, every identifier, number and operator added is found among those removed: a rename (an unstaged `mv` still also reports the old name removed, as before), a reformat by hand or by prettier or gofmt (measured: prettier 3 and `gofmt -s` output in the tests, gofmt on 68 Go standard-library test files with none strengthened), a re-split line, a test case moved between files. Compared as tokens: whitespace, brackets, commas, semicolons, `var`/`let`/`const`, `function`/`=>` and comments (`//`, `#`, `/* */` across lines) ignored; strings unescaped and quote-free, a string that is an identifier equal to it (`{'a': 1}` is `{ a: 1 }`); numbers canonical (`.5` is `0.5`, `0XAB` is `0xab`); operators one per character (`x=-1` is `x = -1`); template text a string, `${…}` code. Strings alone never strengthen: a renamed title, a docstring, a changed message are neutral — and so is an assertion whose only change is its expected string (an accepted false red). Neutral files are named and never earn the rung. Any other added identifier, number or operator strengthens, in any framework — a copied test case or an added line of junk included: the review and measured coverage are the backstop. Known limits, which strengthen (the rule before 19-08): black's string-prefix changes, a `*args` line read as a comment, `eslint --fix` rules that rewrite code (dot notation, `eqeqeq`), an apostrophe in JSX text, a quote, `//` or `#` inside a regex literal (prettier on this repository's own tests strengthens 2 files this way). An untracked test file over 1 MB or holding a NUL byte is not read and never strengthens. Weakening — skips, `.only`, assertions removed (framework markers on raw lines), files deleted, the unstaged, staged and branch diffs summed — is read exactly as before; a file strengthens only where the gate passed before this story, and only one of that run's own changed test files), `exempted` (`## Test Exemption` or `--test-exemption`), `not-required`, `missing` (blocked) | floors per `coverageFloor` | `coverageFloor`, `--test-exemption` | `coverage.js:516-553` |
| Contrary signals (deleted tests, open criteria, criteria drift, policy changed) | warnings | fail the run under `mode: strict`, or with `failOnContrarySignals` on a high-risk story. `mode`, `failOnContrarySignals` and the risk inputs (`highRiskPaths`, `testGlobs`, `ignoredPaths`) are read at the diff base — HEAD in working-tree scope — and in the tree; the stricter wins, so a diff cannot lower them. `assertions-removed` always stays a warning | `mode`, `failOnContrarySignals` | `coverage-gate.js:614-619`, `:662-677`, `:719` |
| Stale proof | A green proof is stale once the tree token or the policy fingerprint changes. The token ignores `.coding-flow/`, `epics/`, `specs/` and `.specify/` | — | — | `bin/lib/identity.js:84-91`; `bin/lib/audit.js:298-313` |
| Proof reuse (verify skips the run) | Only when all of these match a green proof of the same story: tree token, commands and their timeouts, coverage floor, contrary policy, policy fingerprint, merge base, claim, untracked files digest and story text. Never when the proof has a `not-examined` scanner, a skipped coverage check, or lacks a red-at-base result you asked for | Untracked file content is hashed up to 5 MB per file. Past that, size and mtime are used | `verify --no-cache` | `evidence.js:202-353` |
| Status derivation | 1) an explicit `## Status` wins; 2) green verify → `verified`, or `stale` if the proof is stale; red → `blocked`; 3) prose fallback: `blocked`, `done` (says "pass" and "validation"), or `in-progress` | Result notes over 160 chars count as `in-progress` | `## Status: <x>` in tasks.md / story.md | `bin/lib/storage/local.js:88-140` |
| Review required for a story | when its combined risk is `high` | — | — | `status.js:125-130` |

### Guard

| Rule | Default | Max / threshold | Change with | Source |
|---|---|---|---|---|
| Hook matcher | `Write\|Edit\|MultiEdit\|NotebookEdit\|Bash` | — | `.claude/settings.json` (a matcher Coding Flow never shipped is left alone on upgrade) | `bin/lib/settings.js:25-35` |
| Hook timeout | 60 s. When it expires the write goes through: the hook does not block | — | `.claude/settings.json` | `settings.js:37-41` |
| Unchecked call (the guard cannot judge it) | `standard`: logged and allowed | `strict`: refused, except a Write/Edit to `harness.json` itself | `mode` | `guard.js:720-739` |
| git probe inside the guard | 2 000 ms. Past it the call is `unchecked` | — | not configurable | `guard.js:197`, `:213` |
| Heuristic secret patterns on shell commands | not applied. Only `exact` formats are checked on a command line | — | — | `guard.js:533-536` |
| `denials.jsonl`, `guard-unchecked.jsonl`, `guard-warnings.jsonl` | trimmed to the last 200 lines once the file passes 256 KB | — | not configurable | `guard.js:645`, `:666-667` |
| doctor warning on unchecked calls | entries from the last 7 days, excluding shell-reading limits | — | — | `doctor.js:389-410` |
| OpenCode plugin | 60 s per guard call; log capped at 256 KB | — | — | `bin/lib/opencode.js:123`, `:185` |
| Codex sandbox probe | 20 s | — | — | `bin/lib/codex-probe.js:31` |

### Intensity and context budgets

| Rule | Default | Max / threshold | Change with | Source |
|---|---|---|---|---|
| Intensity choice | the lightest mode that covers the change; a mode the user names wins | — | name the mode | `skills/flow-run/SKILL.md:121-124` |
| STRICT triggers | the change alters an authorization decision, changes a persistence schema or migration, moves money, credentials or secrets, or creates a new externally reachable trust boundary | — | — | `flow-run/SKILL.md:126-132` |
| QUICK / FAST budget | 1–3 targeted searches | about 5 files read before deciding the change is still small | — | `flow-run/SKILL.md:149-150` |
| Stop and scout (outside STRICT) | — | edit points still unclear after about 5 searches or 8 files | — | `flow-run/SKILL.md:195-196`, `:253`, `:261` |
| Scout pre-step budget | — | about 8 searches, 12 files, one screen of output, no edits | — | `flow-run/SKILL.md:191-195` |
| STRICT review | `/flow-review` is required, with Deep on security, tests and architecture | — | — | `flow-run/SKILL.md:177-178`, `:233-237` |
| SKILL.md length | — | 500 lines (enforced by test) | — | `test/ceremony.test.js:184-193` |
| Skill description length | — | 1 024 chars; two descriptions with similarity ≥ 0.75 are an error, ≥ 0.50 a warning | — | `scripts/skill-evals.js:41-47` |
| `skills/` and `templates/.claude/skills/` | must be byte-identical | — | edit both | `test/ceremony.test.js:175-182` |

### Worktrees, locks and land

| Rule | Default | Max / threshold | Change with | Source |
|---|---|---|---|---|
| Worktree placement | sibling directory `../<repo>-worktrees/<name>` | names may only contain letters, digits, `.`, `_`, `/` and `-`; no `..`, and no leading `-` | — | `bin/lib/worktree.js:81-91` |
| Placement state lock (`withFileLock`) | wait 5 000 ms, retry every 20 ms, a lock older than 30 000 ms is taken over | — | per call only (code) | `bin/lib/placement-store.js:43-45`, `:79-128` |
| Land lock | wait max(10 min, W + 2 min); stale after max(15 min, W + 5 min), where W is the sum of the land re-verify commands' timeouts (10 min each by default) | — | `validation.timeoutMs` (it scales W) | `worktree.js:726-761`, `:963-972` |
| Autoland | lands only when: the chain is isolated in a worktree, the command runs from the chain's recorded location, the chain is finished, and the chain root re-verifies green | — | — | `bin/lib/worktree-plan.js:342-420` |
| Autoland preview | none: `--dry-run` is refused. Use `worktree land <name> --dry-run` | — | — | `bin/ai-flow.js:949-950` |

### Review and ship

| Rule | Default | Max / threshold | Change with | Source |
|---|---|---|---|---|
| Review capture | `--reviewer self`. Each dimension (`architecture`, `tests`, `security`, `quality`, `e2e`) defaults to `skipped`. Finding counts default to 0 | `--verdict pass` is refused while P0 + P1 > 0, and right after a `fail` without `--round <failed round + 1>` (a failed review is cleared by a new review round, not by verify), unless `--accept "<reason>"` is given. A STRICT story whose review follows a fail is `confirming` in `status` until two passing rounds in a row. Every capture records `round` (previous + 1; a capture from before rounds counts as round 1); an accept records what it covered (`acceptedFor`), and only one for the round skips the STRICT confirming round. A story renamed or moved starts its rounds again (history is keyed by path); review evidence in a worktree's gitignored `.coding-flow/runs/` does not come back with the land (until 18-02) | flags | `bin/lib/review.js` (`reviewCapture`, `resolveRound`, `unacceptedRisks`); `status.js` (`computeReviewStatus`) |
| Clean rounds a STRICT story needs after a failed review, `review.strictCleanRounds` (19-09) | `2` rounds, passing in a row; a fail in between restarts the count | — | not configurable | `status.js` (`computeReviewStatus`, from the registry) |
| Review freshness | `stale` when the tree token moved since the capture | — | — | `status.js` (`computeReviewStatus`) |
| Ship refusals | refuses when you are on the base branch, when there is no `origin`, or when there are no commits above the base | — | — | `ship.js:644-669` |
| Ship base | origin's default branch, else `main` | — | `--base` | `ship.js:98-110` |
| Ship commit scope | only the story's files | — | `--all`, `--no-commit` | `ship.js:370-396`; `bin/lib/commands.js:186-187` |
| Auto-merge eligibility | every story of the epic has a captured green verify (a written `done` does not count); the PR has no conflict; no earlier sibling story's PR is still open; the repository allows auto-merge (`allow_auto_merge`, read before any protection is written); the base has required status checks (ship protects it first when it can, otherwise opens the PR without auto-merge and says why — GitHub would merge at once; a base whose protection cannot be read: "Auto-merge: not armed — \"<base>\"'s protection could not be read (…)"; a base missing on GitHub: push it first; a ruleset with no required status checks rule: add one). `ship --dry-run` names the protection write only when the real run would make one. Merges through GitHub `--auto`, so required checks still apply | — | `autoMergeEpic`, `--auto-merge` | `ship.js:513-596` |
| Branch protection limits (story 29-08) | Checks are read from check runs only: a project whose CI reports legacy commit statuses (`repos/…/statuses`, some external CI) is told it "needs CI first". A required check that no longer runs (renamed or removed job) is never flagged or removed — `protect` only adds, so every pull request waits on it until it is removed by hand. A private repository on GitHub Free has no branch protection: `protect`, `init`, `ship` and `doctor` (`auto_merge_plan_limit`) say "branch protection is not available on this plan" and auto-merge stays off — merge on green by hand. Only the default branch and `baseBranch` are protected and checked by `doctor`: `ship --base develop` with no `baseBranch` set still protects `develop` before arming auto-merge, but `doctor` never checks it — set `baseBranch`, or run `ai-flow protect --branch develop` | last 5 pull requests read | — | `bin/lib/protect.js` |
| Merge method | `merge` | `merge`, `squash` or `rebase` | `--merge-method` | `ship.js:798-803` |

### Planning limits and doctor checks

| Rule | Default | Max / threshold | Change with | Source |
|---|---|---|---|---|
| Stories per epic (skill) | 2–5 for a normal epic | cap around 5–7 | — | `skills/flow-plan/SKILL.md:42-44` |
| Stories per epic (doctor), `epic.maxStories` | `7` stories | warning `epic_too_large` above it | not configurable | `doctor.js` (`EPIC_STORY_SOFT_LIMIT`, from the registry) |
| Duplicate numbering | `duplicate_epic_number`, `duplicate_story_number` | any duplicate | — | `doctor.js:342-376` |
| `## Stories` entry form | `N. [story-…](story-…/spec.md) — outcome *(MODE)*`, `story.md` for a single-file story; warning `story_entry_not_linked` per entry that is not that link or whose target is missing; `doctor --fix` rewrites the entry, keeping its text | — | — | `flow-plan/SKILL.md:106-116`; `bin/lib/story-links.js`; `doctor.js:385-418` |
| Dependency tree grammar | `├──` / `└──`, one label per line, 4-character indent per level, or flat chains `s1 ── s2`. The tree is read only inside `## Backbone` | **one parent per story: `┴` or `┤` is refused** | — | `flow-plan/SKILL.md:68-95`; `bin/lib/backbone.js:108-140`, `:190-193` |
| Generated directory hint | warning `generated_not_ignored` | more than 20 changed files under `generated/`, `__generated__/` or `gen/` in the last verify | `ignoredPaths` | `doctor.js:198-240` |
| Recovery scan | history of 2 000 commits; 15 hotspots; "large file" = over 500 lines | — | `recover scan --history-limit N` | `bin/lib/recover.js:28-30`, `:979-987` |
| `ai-flow rules` | prints every registered key with its value in force and its source; `doctor` ends by pointing to it | — | `rules <key>`, `--json` | `bin/lib/rules.js`, `bin/lib/rules-registry.js` |
| `ai-flow docs check` | Read-only, never runs a command a doc shows. Reports, with file and line: a backticked path that does not exist (tried from the root and from the doc's folder; `path#anchor`, `path#L10`, `path:12` and a trailing `/` are read as the path. A rename git recorded is suggested; a path git recorded deleted — a file, or a folder through the files it held — says `deleted in <sha>` and gets no suggestion; a moved folder suggests its new place; otherwise the one same-named file elsewhere, or a one-in-seven-characters typo (a swap counts one) in the name among the folder's entries, or in the folder among the path's namesakes; a lone same-named folder is suggested only under a parent of the same name. Route segments `[locale]`, `[...slug]`, `(group)` are folder names and judged); an `npm run` / `pnpm run` / `pnpm --filter <pkg> run` script absent from the package it runs in: the package of `-w` / `--workspace` (before or after `run`), `--filter`, `--prefix` / `-C` / `--dir`, or the folder a `cd` / `pushd` moved to (a trailing `/` ignored) on that line or an earlier line of the same code block (a `cd` inside `( … )` ends at the parenthesis, `popd` returns, a `#` comment is not read), else the doc's nearest `package.json`; in a workspace (`pnpm-workspace.yaml` or `workspaces`), a `--filter` or `-w` naming no package is reported (pnpm's `--filter <name>` also matches the one `@scope/<name>`); a relative link whose file is missing; a `#anchor` absent from the target page's headings (GitHub slugs, `-1` for a repeat) or HTML `id`/`name`. Exit 0 when clean, 1 when anything is reported, 2 when the check could not run as asked (usage, unreadable base, no doc under the paths given). `--changed <base>` reads only the docs naming a path changed since base (committed, staged, unstaged or new); a doc's own `#anchor` is not a mention. `doctor` warns `docs_stale` with the count and never fails on it | Never judged (skipped, not reported): code blocks (fenced at any indent, `~~~`, indented outside a list), HTML comments, front matter; spans with a placeholder (`<…>`, `…`, `...`, an upper-case word `N`/`NN`/`X`/`XX`/`YYYY`/`MM`/`DD` between `/ . - _`, or a lowercase `x`/`y`/`n` after a dash: `epic-x`, while `x-name.js` is judged), a glob (`*`, `?`, `{…}`, or a bracket that is not a whole segment, like `[id].tsx`, when that literal path is missing), a URL, a space, a flag, `~`/`$`/`/`/`@`/`#` first, or no `/` (bare names); a path whose first segment exists neither at the root nor in the doc's folder (another project's example), unless git recorded that path or folder renamed or deleted; `../` that leaves the repository; a path that resolves under another root of the repository (a template, a fixture, a package: `docs/<page>.md` when `templates/docs/<page>.md` exists); a path git ignores (generated output); a path with no rename or deletion recorded by git that the project's tracked code or config names in full (`.js`, `.ts`, `.py`, `.json`, `.yml`, `.toml`, `Dockerfile`…; never `.coding-flow/**`, notes, changelogs or untracked files); a script call that runs in every package (`-r`, `--recursive`, `--workspaces`), after a `cd` out of the repository, to a variable or to a folder the repository does not have (`cd my-app` after a scaffold), or whose package cannot be told (a `--filter` name two `@scope/` packages share); scripts in prose (only code spans and shell or unlabelled code blocks are read). Limits: a code span or an HTML comment spanning two lines is read line by line; a code or test string naming an old path hides it unless git recorded the rename or deletion; a `# … from the root` comment does not reset a `cd`; outside git, the folder the check runs in is walked breadth-first, `docs/` first (never `/`, at most 20 000 files, with a warning on stderr when the limit is hit); a path git recorded moved or deleted is judged even when its first segment is gone, so prose saying a folder no longer exists (`there is no web/types/ any more`) is reported; `--changed` reads a doc only when it names a changed path, so a changed doc whose new link points nowhere is not read | `docs.check.*` keys; explicit paths; `--changed`; `--json` | `bin/lib/docs-check.js`, `bin/lib/docs-markdown.js` |
| Bootstrap workspace scan | — | 50 workspace members | — | `bin/lib/bootstrap.js:209` |
| `status` open recovery findings shown | — | 5 | — | `status.js:314` |
| `report` | — | 40 denials, 15 failures, 12 tail lines | — | `bin/lib/report.js:26-28` |

### Environment variables the tool reads

| Variable | Effect | Source |
|---|---|---|
| `CI` | any value other than empty, `0` or `false` counts as unattended (plan.md commands are refused) | `validation-run.js:252-256` |
| `AI_FLOW_FORCE_TTY=1` | treated as attended, but **only** when `NODE_ENV=test`. The guard refuses an agent setting it | `validation-run.js:258`; `guard.js:542-554` |
| `CODING_FLOW_MAX_OUTPUT_BYTES` | output buffer per validation command (default 256 MB) | `validation-run.js:169` |
| `CODING_FLOW_DEBUG` | prints stack traces | `bin/ai-flow.js:23` |
| `CLAUDE_CONFIG_DIR`, `CLAUDE_PLUGIN_ROOT` | where the Claude plugin is looked for | `bin/lib/claude-plugin.js:28`, `:94` |
| `CLAUDECODE`, `OPENCODE`, `CLAUDE_PID`, `OPENCODE_PID` | host detection at `init` | `bin/lib/detect.js:63`, `:94-109` |
| `XDG_CONFIG_HOME` | OpenCode global config directory | `bin/lib/opencode-config.js:91` |
| `SPECIFY_FEATURE_DIRECTORY` | pins the Spec Kit feature directory | `bin/lib/speckit.js:114` |

---

## Part 2 — Planned (not shipped yet)

None of these exists in `bin/lib/` at `e00ff82`, and no story of epics 18–25 is
marked done. Defaults confirmed by the maintainer on 2026-11-12 and 2026-11-13
are recorded in `docs/plans/autonomous-factory.md` (*Maintainer to-do*),
`epics/epic-20-the-epic-runs-itself/index.md` (*Readiness*) and
`docs/design-decisions.md` entry 15.

### Configuration files (planned)

| Rule | Default | Max / threshold | Change with | Delivered by / source |
|---|---|---|---|---|
| User global config `~/.config/coding-flow/config.json` | holds machine settings (`run.maxAgents`, `verify.maxConcurrent`) and the vault path. A machine setting written in the project's `config.json` is ignored, with a doctor warning | — | edit the file | 19-03 (`spec.md:20-26`), 21-02 (`spec.md:19-20`), 24-02 (`spec.md:25-35`, `:80-82`) |
| `.coding-flow/autonomy.md` | absent topic → built-in levels: `ask` for product or business rules, money, production and push, destructive migrations, permissions, external services or cost, personal data; `decide-and-note` for deviations from the plan; `decide` for process | levels `decide`, `decide-and-note`, `ask` | edit the table | 22-01 (`spec.md:12-22`) |
| `vault.alias` | the project directory name | — | `config.json` | 21-02 (`spec.md:49`) |

### Driven runs (planned)

| Rule | Default | Max / threshold | Change with | Delivered by / source |
|---|---|---|---|---|
| Driver | `claude` added to `RUN_DRIVERS` (today only `none`) | — | `run --driver claude` | 20-01 (`spec.md:14-15`); today `bin/lib/run.js:40` |
| Preflight (the whole batch is refused) | requires: `claude` on PATH; a headless guard self-test (cached 24 h per `claude` version and guard fingerprint); harness `mode: strict` or equivalent; validation commands from `config.json`; budget and turn caps set | — | — | 20-01 (`spec.md:16-30`); `epics/epic-20-the-epic-runs-itself/index.md:98-101` |
| Budget caps `run.budgetUsd.story`, `run.budgetUsd.run`, `run.maxTurns.story` | **not set: required, no default spend** | the run stops before a story it cannot afford (estimate: max of the story cap and the mean cost so far) | `config.json` | 20-01 (`spec.md:28-29`), 20-06 (`spec.md:22-23`); epic 20 `index.md:110-112` |
| `run.allowedTools` | `Read,Edit,Write,Glob,Grep,Bash`. `Agent` and `Task` are always disallowed | a list containing `Agent` or `Task` is refused | `config.json` | 20-01 (`spec.md:36`, `:40-45`) |
| `run.attempts` (implementation attempts per story) | 2 | then the story is `blocked` | `config.json` | 20-03 (`spec.md:14`) |
| `run.processTimeoutMin` (wall clock per agent process) | 50 min (raised from 45 on 2026-11-12) | on expiry the process group is killed and the attempt counts | `config.json` | 20-03 (`spec.md:19-21`) |
| `run.stallMin` (no file change, no tool output) | 10 min | treated as a timeout | `config.json` | 20-03 (`spec.md:22-23`) |
| Usage-limit pause | uses no attempt. Backoff 5 → 60 min when the limit gives no reset time | `run.pauseMaxHours` 6, after which the run ends as `paused` (never `blocked`) | `config.json` | 20-03 (`spec.md:26-34`) |
| `run.stopAfterBlocked` | 3 consecutive blocked stories | stops the run | `config.json` | 20-06 (`spec.md:24`) |
| Fix passes after review | 1 | — | — | 20-04 (`spec.md:22-27`); epic 20 `index.md:102-106` |
| `run.reviewStandard` | `true`: STANDARD stories get one generalist reviewer; QUICK and FAST none | — | `config.json` (`false` saves the spend) | 20-04 |
| Driven agent cannot write `## Status: done` | refused by the guard; the CLI writes it | — | — | epic 20 `index.md:92-97`; 20-04 (`spec.md:30-31`) |
| Story ownership | `Owner: human` | only `agent` stories that are ready run | `Owner:` line | 20-05 (`spec.md:6`); epic 20 `index.md:107-109` |
| Story lock liveness | heartbeat every 60 s | a dead pid with no heartbeat for 10 min is stale and taken over | — | 20-02 (`spec.md:14-22`) |
| `worktree.copyFiles` | not set (list of git-ignored env files copied into a new worktree, never committed) | — | `config.json` | 20-02 (`spec.md:23-27`); every `add` from 24-01 (`spec.md:18-19`) |
| `worktree.setup` | not set (ordered project commands run in a new worktree). A failing setup leaves the story unstarted and uses no attempt | — | `config.json`; `--no-setup` skips it for one call | 20-02 (`spec.md:28-34`); 24-01 (`spec.md:20-21`) |
| `validation.retry` (retry a failed command on the same tree) | 1 when `AI_FLOW_DRIVEN` is set, 0 otherwise | only the failed command, and only if the tree and untracked digest are unchanged | `config.json` | 19-02 (`spec.md:15-19`) |
| Protected tests in driven runs | a write, delete or rename of a `testGlobs` file that exists at the diff base is denied | exemption: `## Test Exemption` naming the exact path | story text | 19-07 (`spec.md:12-25`) |
| Ticked criterion without proof | surfaced (warning) | fails under `mode: strict`, `failOnContrarySignals`, or a driven run | `mode` | 18-06 (`spec.md:22-29`) |
| `validation.fix` (fixers before checks) | not set | a fixer that exits non-zero is a red | `config.json` | 19-05 (`spec.md:12-24`) |
| `validation.tiers` + `tiersByRisk` | low and medium → `fast` + `unit`; high/STRICT → `fast` + `unit` + `integration`; `e2e` only when the story asks. `validation.commands` means `unit` | — | `config.json`, `harness.json` | 19-06 (`spec.md:14-19`) |
| Detached verify | returns within 2 s; jobs pruned after 7 days | `--wait --timeout-min N` (no default) | flags | 19-04 (`spec.md:12-31`) |
| Failing test names stored | — | 200, plus a count of the rest | — | 19-01 (`spec.md:49-50`) |
| `report` recent events | last 20 events | — | `--raw` | 18-01 (`spec.md:29-30`) |
| `run.budgetUsd.watcher` | not set: spends from the required run budget | the run budget | `config.json`; `run.watcher: false` skips it | 23-05 (`story.md:12-16`) |
| Watcher output | — | ≤ 3 proposals per pass | — | 23-01 (`spec.md:18-26`) |
| Shadow gates `shadowMinRuns` | 20 runs before "ready to review"; existing gates default to `blocking` | — | `harness.json` | 23-03 (`spec.md:12-19`) |
| Experiment window `success.minRuns` | not set (required: a proposal without it is refused) | — | proposal | 23-01 (`spec.md:24-26`), 23-04 (`spec.md:18`) |
| Promotion ladder | a finding category seen in ≥ 3 distinct stories | a proposal cites ≥ 3 findings | — | 22-03 (`spec.md:12-21`) |
| Cross-project pattern | the same cause seen in ≥ 2 projects within 60 days | — | — | 21-03 (`spec.md:14-17`) |
| Escape and rework window | 14 days after a story lands | — | — | 21-06 (`spec.md:6`, `:13`, `:18`) |

### Parallelism and machine (planned)

| Rule | Default | Max / threshold | Change with | Delivered by / source |
|---|---|---|---|---|
| `run.maxParallel` (chains of one epic at once) | 2 (until 24-02 ships, chains run one at a time) | **capped at 2**; above that the run is refused unless `run.allowMoreParallel: true`. `1` opts out | project `config.json` | 24-02 (`spec.md:22-24`); epic 24 `index.md:42`, `:134-135` |
| `run.maxAgents` (agent processes on the machine) | `auto` = 4, or 2 under WSL (`/proc/version`) or below 16 GB of RAM | **no cap, no allow flag**: any positive integer the user sets is used as is | user global config only | 24-02 (`spec.md:25-43`, `plan.md` decision of 2026-11-13); `docs/design-decisions.md:570-572` |
| Agent slot files | `$XDG_CACHE_HOME/coding-flow/agents/` (fallback `~/.cache/…`). A dead pid's slot is taken over. One slot per process; a freed slot goes to finishing work first | — | — | 24-02 (`spec.md:36-46`) |
| `run.serialPaths` | migration directories, schema files, lockfiles, generated clients | a shared serial path makes the second chain or epic wait | project `config.json` | 24-02 (`spec.md:55-58`), 24-07 (`spec.md:23-27`) |
| Runs per repository | — | 2 `run --epic` at once; a third is refused | — | 24-07 (`spec.md:28-30`) |
| `run.waitMinutes` (wait on a serial path held by another epic) | 0, which means refuse at once | — | `config.json` | 24-07 (`spec.md:24-26`) |
| `verify.maxConcurrent` (heavy verifies at once) | `auto` = 1 under WSL or below 16 GB, else 2 | no cap: a value the user sets is used; the memory gate still applies | user global config only | 19-03 (`spec.md:20-26`) |
| `verify.minFreeMemoryMb` | 3072 | below it the verify waits, polling every 15 s and printing one line per minute | user global config; a project `harness.json` may only raise it | 19-03 (`spec.md:27-30`) |
| `verify.maxWaitMinutes` | 30 | past it the result is a `machine busy` tool error (not a red, and it uses no attempt) | user global config | 19-03 (`spec.md:31-32`); 20-03 (`spec.md:24-25`) |
| Verify queue opt-out | — | — | `verify --no-queue` | 19-03 (`spec.md:34`) |
| `land.waitMinutes` (wait for a clean primary) | 30 | — | `config.json`; `land --wait` | 24-01 (`spec.md:26-28`) |
| Stopping served processes | SIGTERM, then SIGKILL after 10 s. On Windows, a failed remove is retried with backoff for up to 10 s | — | — | 24-01 (`spec.md:22-25`, `:43-45`) |
| `locks` | `local` | `refs`: heartbeat every 5 min; stale after `locks.staleMinutes` (60) | `config.json` | 24-03 (`spec.md:12-22`) |
| `land` | `local` | `pr` | `config.json` | 24-04 (`spec.md:13`) |
| `branch.pattern` | not set | — | `config.json` | 24-01 (`spec.md:32-35`) |

### Reference machine profiles

The `auto` values are the maintainer's two machines. On any other machine, set
your own values in `~/.config/coding-flow/config.json`: `run.maxAgents` and
`verify.maxConcurrent` take any positive integer (24-02, 19-03).

| Machine | Detected as | `run.maxAgents` | `verify.maxConcurrent` |
|---|---|---|---|
| WSL2 laptop: 32 GB host, WSL limited to 14 GB, 8 vCPU | WSL (`/proc/version`), or < 16 GB | 2 | 1 |
| Native Linux or Windows, ≥ 16 GB | neither | 4 (never more than CPUs − 2) | 2 |

### Reviews and roles (planned)

| Rule | Default | Max / threshold | Change with | Delivered by / source |
|---|---|---|---|---|
| Findings output | JSON through `claude --json-schema` (severity, file, line, scenario, fix) | invalid twice → tool error, never a pass | — | 20-04 |
| `review.lenses` (STRICT) | `["spec", "security", "tests"]`, one process each, merged by file and line | each lens takes an agent slot | `config.json` | 20-04 |
| `review.skeptics` (per P0/P1) | 2 | dropped only if every skeptic refutes; kept as `refuted` | `config.json` | 20-04 |
| `run.roles.<role>.model` / `.effort` / `.fallbackModel` | inherit the user's default model | — | `config.json`; roles: implementer, reviewer, skeptic, crossing, walker, epicReview, critic, report, closer | 20-01 |
| Completeness critic | one read-only process after the epic review | an unproven ticked criterion reopens its story `blocked` | role `critic` | 20-07 |
| Open risks | carried in the run state, handed to stories sharing files or identifiers | listed open in `REPORT.md` until a story closes them | — | 26-01 |

Reference role profile (the maintainer's): implementer, reviewer, crossing,
epic review and closer on the strongest model at high effort; skeptic,
walker, critic and report on a lighter model.

### Around the run (planned)

| Rule | Default | Max / threshold | Change with | Delivered by / source |
|---|---|---|---|---|
| `notify.command` | not set (nothing runs) | 10 s timeout; failure never stops the run | user global config only; a project value is ignored | 26-02 |
| `notify.events` | `needs-you`, `blocked`, `paused`, `run.end`, `epic.landed` | — | user global config | 26-02 |
| `## Human to-do` items | `- [ ] (before: deploy\|next-story\|later) …`; no `when` = `later` (doctor warns) | secret-looking value: doctor error, printed masked | written by `flow-plan`/`flow-run`/`flow-review`; ticked by the maintainer or `ai-flow todo done <id>` | 26-07 |
| `next` We need you block | printed above the recommendation when anything waits on a human; `deploy` first, then `next-story` and `Needs you`, then `+ N later` | 5 lines plus the count; reads every epic of the checkout, landed ones included | `next --json` → `needsYou` | 26-07 |
| `todo.uncapturedPatterns` | EN + FR human-action phrases ("the maintainer must", "before (the) deploy", "à faire par l'utilisateur", "avant le déploiement", …) | warning only (`verify`, `doctor`), never a failure | `config.json` | 26-07 |
| Ship/land repeat | open `before: deploy` items: `Before you deploy` section in the PR body; printed by land, autoland and closure | never blocks | — | 26-07 |
| `docs/ideas.md` ledger | `- [<status>] <what> — why: … — source: <kind>:<ref> — size: story\|epic — id: <id>`; status `proposed`, `planned → <epic>`, `parked`, `killed: <reason>` | no line without `source:`; `killed` needs a reason and never returns | `ai-flow idea plan\|park\|kill <id>` | 28-01 |
| `next` Ideas block | only when no tier yields a command, below We need you | 3 lines | `next --json` → `ideas`; order changed by `ai-flow ideas rank` (28-02) | 28-01 |
| `ideas.markers` | not set (no code scan) | outside tests and generated code | `config.json` (bethl: `À venir`, `not yet produced`, `Pas encore produit`) | 28-01 |
| `/flow-plan --ideas` | opt-in, never automatic | ≤ 3 new ideas per pass, ~8 searches / ~12 files; each with `repo-observed:<existing path>` or `user-stated:<date>` | skill section | 28-02 |
| Closer allowed paths | `epics/<epic>/`, `docs/`, `CHANGELOG.md` | anything else is reverted and listed | — | 26-04 |
| `run --watch` refresh | 2 s | — | `--once`, `--json` | 26-05 |

Notify examples: `notify-send "Coding Flow" "$(jq -r .summary)"` on Linux;
from WSL, a PowerShell toast through `powershell.exe -c`; a phone push with
`curl -d @- ntfy.sh/<topic>`.

### Holds, failures and notifications (planned)

Design: [`docs/plans/orchestration.md`](plans/orchestration.md).

| Rule | Default | Max / threshold | Change with | Delivered by / source |
|---|---|---|---|---|
| Hold reasons | `waiting`, `paused`, `failed`, `needs-decision`, `parked`, `skipped`, `error`, `stopped` (run) | every hold has an owner and a next command | — | 27-01 |
| `Hold:` line | written by the CLI with `## Status: blocked` | a driven agent writing it is denied by the guard | — | 27-01 |
| Transient errors | retried up to 3 times, backoff 30 s → 5 min | no attempt spent | — | 27-02 |
| Fallback model on `overloaded` | light roles only (skeptic, walker, critic, report) | never for implementer or reviewer | `run.roles.<role>.fallbackModel` | 27-02 |
| Circuit breaker | trips on 2 stories failing on the same command or test, 2 `environment` failures, or a failing `run.healthCheck` | no new story starts; run `stopped: environment` | `run.healthCheck` (project command) | 27-02 |
| Guard denials per story | 1 tolerated (attempt spent) | 2nd → `failed: security` | — | 27-02 |
| `Coding-Flow-Run` commit trailer | on every driven commit | resume trusts git over the state file | — | 27-03 |
| Scheduling | critical path first (most dependents), then story order | — | — | 27-04 |
| `run.syncBase` | `between-stories` | conflict or red → `parked: base-sync` | `at-land` | 27-04 |
| `run --plan` / `--stop` / `--abort` | preview, graceful stop, kill; all resumable | — | — | 27-05 |
| `decide.afterHours` | unset (never) | never for irreversible topics | `config.json` + `autonomy.md` per topic | 27-06 |
| `notify.remindAfterHours` | 4 | one reminder per urgent event | user config | 27-07 |
| `notify.batchMinutes` | 30 | info events only | user config | 27-07 |
| `notify.digest` | unset | `daily` or `run-end` | user config | 27-07 |
| `notify.quiet` | unset | holds all but urgent | user config, e.g. `"22:00-08:00"` | 27-07 |

### Browser (planned)

| Rule | Default | Max / threshold | Change with | Delivered by / source |
|---|---|---|---|---|
| `validation.tiers.browser` | `{ command, serve, healthUrl, checklist }`. Without a command, the tier is a checklist: an item is ticked with an `observed YYYY-MM-DD` line | an `open` item fails only under strict or driven modes | `config.json` | 19-06 (`spec.md:22-25`), 25-01 (`spec.md:12-15`) |
| `validation.tiers.browser.startTimeoutSec` (`healthUrl` must return 2xx) | 120 s | past it the result is a tool error, not a red | `config.json` | 25-01 (`spec.md:14-15`) |
| `serve.ports` | not set | uses the next free port in the range | `config.json` | 25-01 (`spec.md:13-14`), 24-07 (`spec.md:41-43`) |
| Checklist walker | a fresh `claude -p` with browser tools only; takes an agent slot | a `not confirmed` item costs one attempt (20-03) | `testAccounts` (env var names only, never values) | 25-02 (`spec.md:12-28`) |

### What the agent cannot fake (planned)

| Rule | Default | Max / threshold | Change with | Delivered by / source |
|---|---|---|---|---|
| Scan rules | 4 rules, each a defect (`placeholder.not_implemented`, `import.phantom_dependency`, `import.broken_relative_path`, `test.only`) | only lines the diff added; style stays the linter's job | `config.json` `scan.rules.<id>: off`, `scan.exclude` | 29-01 |
| Scan suppression | none | `ai-flow-scan-ignore <rule> -- <reason>` on the line or above; no reason, no suppression; copied into evidence | in the code | 29-01 |
| Changed test must be collected | contrary signal `test-not-run` | jest, vitest, node:test list modes; other runners `not examined` | add the file to a validation command, or `## Test Exemption` | 29-02 |
| Removed test title | contrary signal `test-removed` | a moved or renamed test keeps its title | `## Test Exemption` naming the title, with a reason | 29-02 |
| `validation.reports` | not set (exit code alone) | when set: report written during the run, ≥ 1 test, 0 failures | `config.json` | 29-02 |
| `destructiveCommands` | `deny` | `deny`, `warn`, `off`; exact commands in `allowDestructive` (`*` for a prefix) | `.coding-flow/harness.json` (the agent cannot write it) | 29-03 |
| `worktrees.primaryLocked` | `false` | `true`: no branch change in the primary checkout | `.coding-flow/harness.json` (bethl: `true`) | 29-03 |
| Criteria verdict | `READY`, `READY WITH GAPS`, `INCONCLUSIVE`, `BLOCKED` | `outside verify:` rows are `declared`, a gap, never `proven` | `## Acceptance Traceability` | 18-06 (amended 2026-11-14) |

---

## Inconsistencies found

Found while writing this page. Items 3–8 were resolved in the plans the same
day (2026-11-13); items 1, 2 and 9 were resolved in code by story 26-06; item 10 by story 26-08.

1. *Resolved (26-06): `templates/RULES.md` states no budget and points to `/flow-run`; a test fails if it ever states one the skill does not.* **Context budgets: old installed `RULES.md` vs the current skill.**
   `RULES.md` installed by earlier versions (for example bethl's) states QUICK
   "stop after 3 searches or 5 files" and FAST "5 searches or 8 files". The
   current `templates/RULES.md` no longer carries budgets. `skills/flow-run/SKILL.md:149-150`
   says QUICK/FAST use 1–3 searches and about 5 files, and `:195-196` says to
   stop and scout after about 5 searches or 8 files outside STRICT. Projects
   that have not upgraded carry the old numbers.
2. *Resolved (26-06): the skill now says an epic is warned above 7 by `doctor`, and doctor reads 7 from the registry.* **Epic size.** `skills/flow-plan/SKILL.md:42` says "cap it around 5–7", but
   `doctor` warns only above 7 (`bin/lib/doctor.js:47`). Consistent in
   effect (7 is the cap), but the skill should say "warned above 7".
3. *Resolved.* Heavy verifies per machine are `verify.maxConcurrent`
   everywhere (19-03, 24-02, epic 24 risks).
4. *Resolved.* Epic 24's out-of-scope line now caps chains only; agents are
   the user's machine setting.
5. *Resolved.* The factory plan and entry 15 say "4, or 2 under WSL or below
   16 GB" and that the user's value is uncapped.
6. *Resolved.* The watcher (23-05) spends from `run.budgetUsd.watcher` when
   set, else from the required run budget; no undeclared default.
7. *Resolved.* All browser keys live under `validation.tiers.browser`
   (`command`, `serve`, `healthUrl`, `startTimeoutSec`, `checklist`).
8. *Resolved.* `verify.minFreeMemoryMb` and `verify.maxWaitMinutes` move to
   the user's global config with `maxConcurrent`; a project may only raise
   the memory floor.
9. *Resolved (26-06): one default, `validation.timeoutMs` in the registry, read by the runner (`commandTimeoutDefault`) and by `land`'s lock sizing.* **The 10-minute default is defined twice.** It lives in
   `bin/lib/validation-run.js:206` (`DEFAULT_COMMAND_TIMEOUT_MS`) and again in
   `bin/lib/worktree.js:744` (`PER_COMMAND_TIMEOUT_MS`). The comment at
   `worktree.js:729` still says the default is in `harness.js`. Changing one
   without the other mis-sizes the land lock.
10. *Resolved by story 26-08: `init` and `harness init` write both keys, at their defaults, to a new `harness.json`; an existing file is not rewritten, and the policy fingerprint leaves a key out while it holds its default, so no recorded proof goes stale.* **Policy that is read but never written.** `coverageFloor` and
    `failOnContrarySignals` are honoured (`coverage.js:572`,
    `coverage-gate.js:640`) but are not in `defaultHarnessConfig()`. A project
    reading its own `harness.json` cannot see that they exist or what their
    defaults are.
