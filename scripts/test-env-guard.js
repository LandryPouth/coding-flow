"use strict";

// Preloaded by `npm test` (node --require) before any test file runs.
//
// Git sets GIT_DIR/GIT_WORK_TREE (and friends) in the environment of every
// hook it invokes, so that a hook script's own git commands resolve correctly
// even if the script changes directory. That is right for a hook script; it
// is wrong for this test suite, which spawns `git init`/`git commit` inside
// fresh tmp directories expecting each one to be its own isolated repo. If
// `npm test` runs from inside a git hook (this repo's own `.githooks/pre-push`
// runs it on every push) and those variables are still set, every fixture's
// git commands silently ignore the tmp `cwd` and operate on the real
// repository's GIT_DIR instead — the fixture "commits" land on whatever
// branch that repository has checked out.
//
// Deleting them here, once, before any test file's `execFileSync('git', ...)`
// can run, is cheaper and more reliable than auditing every fixture helper
// across the suite for an explicit `env` override.
for (const name of [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_COMMON_DIR",
  "GIT_CEILING_DIRECTORIES",
]) {
  delete process.env[name];
}

// `init` resolves its platform from the environment (CLAUDECODE=1 means Claude
// Code). Most of the suite exercises the Claude install, and the answer must not
// depend on whether the developer happens to run `npm test` from inside Claude
// Code or from a plain terminal / CI. Pinned here, once; the detection tests
// that need a bare environment delete it from the env they hand the CLI.
process.env.CLAUDECODE = "1";

// OpenCode's install for every project lives in $XDG_CONFIG_HOME/opencode (or
// ~/.config/opencode). `doctor` reads it, and the suite must not depend on — or
// ever write to — the developer's real one. An empty directory nobody creates;
// tests of the global install pass their own HOME / XDG_CONFIG_HOME.
process.env.XDG_CONFIG_HOME = require("path").join(require("os").tmpdir(), "coding-flow-test-no-xdg-config");
