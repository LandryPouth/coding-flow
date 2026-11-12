"use strict";

// Story 14-03 — a fix is proven by a test that was red at base.
//
// `verify --red-at-base` answers one question the ordinary gate cannot: does the
// test protecting this change actually demonstrate it? A green suite says the
// tests passed after the change; it says nothing about whether they would have
// caught the bug before it. So the diff's added or modified test files are run
// twice, in two throwaway worktrees set up identically:
//
//   merge base: the test file from HEAD copied in, the code from the base;
//   HEAD:       the committed fix and test.
//
// The proof holds only when the test fails at the merge base and passes at HEAD.
// Passing in both means the test never demonstrated the finding. Failing in both
// means it cannot run on the fix (or in a clean tree). A base failure that is a
// setup/import error is refused too: a red for the wrong reason is not a red.
//
// CORE, deliberately: no story, no `worktree.js` (a layer), no worktree registry
// — just `git worktree add --detach`, two temp trees under the OS temp dir,
// and a `finally` that removes them on every path.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { fileURLToPath } = require("url");

const { cwd } = require("./context");
const {
  currentDiffBase,
  changedFilesForCoverage,
  getChangedFiles,
  runGitList,
} = require("./diff-scope");
const { readHarnessConfig } = require("./harness-config");
const { normalizePortable, matchesPattern } = require("./util");
const { runValidationCommand } = require("./validation-run");

// What a missing `redAtBase.command` points at. `{files}` is replaced by the
// test paths. Only node's own test runner is read: its TAP output says, per
// failure, whether a test ran (`failureType`) and where (`location`). Jest,
// Vitest and Go were read once and dropped (2026-11-09): each brought setup,
// mock and config files whose change could pass for the fix.
const COMMAND_EXAMPLES = ["node --test --test-reporter=tap {files}"];

// Set by git for its hooks (a `pre-commit` running verify): inherited, they
// would point `worktree add` and the runner at the user's repository and its
// in-progress commit index instead of the throwaway tree.
const REPOSITORY_ENV = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
];

function treeEnvironment(source = process.env) {
  const env = { ...source };

  for (const name of REPOSITORY_ENV) {
    delete env[name];
  }

  return env;
}

// What `worktree.js` links into a daemon-created worktree, for the same reason:
// the two trees must differ only by the code, never by which dependency tree
// happens to be installed. `.env` is included because a suite that reads it must
// see the same values on both sides.
const MANAGED_LINKS = [".env", ".env.local", "node_modules"];

// Data extensions that are never a test file even when a broad `testGlobs`
// pattern (e.g. `**/test/**`) matches them.
const DATA_EXTENSIONS = new Set([
  ".json",
  ".jsonl",
  ".txt",
  ".snap",
  ".yaml",
  ".yml",
  ".csv",
  ".tsv",
  ".xml",
  ".html",
  ".htm",
  ".md",
  ".dat",
  ".bin",
  ".golden",
  ".expected",
  ".fixture",
]);

// What counts as the code under test. Anything added in the diff is refused
// anyway (the base tree cannot contain it); this only decides which *modified*
// files are safe to leave out of the base tree. Node runs JavaScript and
// TypeScript (through a loader); any other modified file is refused.
const CODE_EXTENSIONS = new Set([".js", ".cjs", ".mjs", ".jsx", ".ts", ".tsx", ".mts", ".cts"]);

function isDataFile(file) {
  return DATA_EXTENSIONS.has(path.posix.extname(normalizePortable(file)).toLowerCase());
}

// Only a JS/TS file can be code here, so config means the JS/TS files that set
// up the run rather than the behavior: a `*.config.js`, a dotfile
// (`.eslintrc.js`), a task file, a test setup by name. Left at base, a change
// there would make a false red.
function isConfigFile(file) {
  const base = path.posix.basename(normalizePortable(file));

  return (
    base.startsWith(".") ||
    /\.(?:config|conf|workspace)\.[cm]?[jt]s$/.test(base) ||
    /^(?:Gruntfile|gulpfile)\.[cm]?[jt]s$/.test(base) ||
    TEST_SETUP_NAME.test(base)
  );
}

// `jest.setup.js`, `setup-tests.ts`, `test-setup.mjs`, `global-setup.ts`…: by
// convention they run before every test, whichever runner loads them.
const TEST_SETUP_NAME =
  /^(?:setup[-_.]?(?:jest|vitest|tests?)|(?:jest|vitest|tests?)[-_.]?setup(?:[-_.]?\w+)?|global[-_.]?(?:setup|teardown))\.[cm]?[jt]sx?$/i;

// What launches the run: the command, the scripts `npm test --` would run, the
// `node-options` an `.npmrc` hands them, `.env`/`.env.local`, and
// `NODE_OPTIONS`. A modified file named
// there — a preload (`--require ./setup`, in `NODE_OPTIONS`, quoted, absolute),
// the command's own entry script — runs around every test, so a change there
// is setup, not the fix. Matched by path, with or without its extension; a
// directory names its `index` file. Over-matching only ever refuses.
function launchText(root, command, env) {
  const read = (file) => {
    try {
      return fs.readFileSync(path.join(root, file), "utf8");
    } catch {
      return "";
    }
  };
  let scripts = "";

  try {
    scripts = JSON.stringify(JSON.parse(read("package.json")).scripts || {});
  } catch {
    // An unreadable package.json names nothing.
  }

  return [String(command || ""), scripts, read(".npmrc"), read(".env"), read(".env.local"), (env || process.env).NODE_OPTIONS || ""].join("\n");
}

function namedAtLaunch(text, file) {
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bare = file.replace(/\.[cm]?[jt]sx?$/, "");
  const names = [file, bare, ...(/\/index$/.test(bare) ? [bare.replace(/\/index$/, "")] : [])];

  return names.some((name) =>
    new RegExp(`(?:^|[^\\w.-])(?:\\./)?${escape(name)}(?![\\w-]|\\.\\w|/\\w)`, "m").test(text),
  );
}

// A modified file is code only when git holds a regular file on both sides (a
// symlink or a submodule points at something the diff does not show) and it is
// JavaScript/TypeScript, or an extensionless script whose committed content
// starts with a shebang on both sides. Read from git, never from the disk: an
// executable bit or a symlink target in the checkout says nothing about HEAD.
function isCodeChange(root, change) {
  if (!REGULAR_MODES.has(change.oldMode) || !REGULAR_MODES.has(change.newMode) || isConfigFile(change.file)) {
    return false;
  }

  const extension = path.posix.extname(change.file).toLowerCase();

  if (extension === "") {
    return isScriptBlob(root, change.oldBlob) && isScriptBlob(root, change.newBlob);
  }

  return CODE_EXTENSIONS.has(extension);
}

const REGULAR_MODES = new Set(["100644", "100755"]);

function isScriptBlob(root, blob) {
  try {
    const content = execFileSync("git", ["cat-file", "blob", blob], {
      env: treeEnvironment(),
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });

    return content.subarray(0, 2).toString("utf8") === "#!";
  } catch {
    return false;
  }
}

const PROSE_ROOTS = ["epics", ".specify"];
const PROSE_EXTENSIONS = new Set([".md", ".mdx", ".markdown", ".rst", ".adoc"]);

// Documentation, not behavior or setup. This deliberately does not reuse
// `nonBehaviorGlobs`: that list also covers config, migrations, SQL, generated
// and declaration files, which can change what the test reads or how it runs.
function isNonBehavior(file) {
  const portable = normalizePortable(file);
  const parts = portable.split("/");
  const base = parts[parts.length - 1];

  if (parts[0] === ".coding-flow" && parts.length > 1) {
    return true;
  }

  // The project's own top-level prose. A README.md under `test/fixtures/` is a
  // fixture, and so is anything under `docs/`, which tests do read.
  if (parts.length === 1 && /^(?:README|CHANGELOG|LICENSE|CONTRIBUTING|AGENTS|CLAUDE)(?:\.(?:md|mdx|markdown|rst|adoc))?$/i.test(base)) {
    return true;
  }

  // Prose under the planning roots this tool and Spec Kit write — only prose,
  // and only at the top level.
  return parts.length > 1 && PROSE_ROOTS.includes(parts[0]) && PROSE_EXTENSIONS.has(path.posix.extname(base).toLowerCase());
}

function exampleList() {
  return COMMAND_EXAMPLES.map((example) => `  - ${example}`).join("\n");
}

function missingCommandReason() {
  return (
    "redAtBase.command is not set in .coding-flow/harness.json: --red-at-base needs " +
    "a targeted command, e.g.\n" +
    exampleList()
  );
}

function isDir(candidate) {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function lstatSafe(candidate) {
  try {
    return fs.lstatSync(candidate);
  } catch {
    return null;
  }
}

function findChangedTestFiles(root, config) {
  const isTest = (file) =>
    (Array.isArray(config.testGlobs) ? config.testGlobs : []).some((pattern) => matchesPattern(file, pattern));

  // A deleted test has nothing to run and nothing to prove; the coverage gate
  // already treats a deletion as weakening. Only files that still exist count.
  return changedFilesForCoverage(root)
    .filter((file) => !isDataFile(file) && isTest(file) && fs.existsSync(path.join(root, file)))
    .sort();
}

// Throws on a git error: an empty list would read as "nothing unsupported" and
// let the preflight accept everything. `-z`: a path git would otherwise quote
// (non-ASCII, a tab) is read as it is.
function diffFiles(root, base, filter) {
  return execFileSync("git", ["diff", "-z", "--no-renames", "--name-only", `--diff-filter=${filter}`, base, "HEAD"], {
    env: treeEnvironment(),
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
    .split("\0")
    .filter(Boolean)
    .map(normalizePortable);
}

// Every change between the base and HEAD with git's modes and blobs:
// `{ status, oldMode, newMode, oldBlob, newBlob, file }`. `--no-renames`: a
// rename is its deletion plus its addition, so the old path is classified too
// (a file moved into a test or prose path must not vanish from the check).
function diffChanges(root, base) {
  const fields = execFileSync("git", ["diff", "-z", "--no-renames", "--raw", "--no-abbrev", base, "HEAD"], {
    env: treeEnvironment(),
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  }).split("\0");
  const changes = [];

  for (let index = 0; index < fields.length; index += 1) {
    const header = fields[index].match(/^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])\d*$/);

    if (!header) {
      continue;
    }

    const [, oldMode, newMode, oldBlob, newBlob, status] = header;
    index += 1;
    changes.push({ status, oldMode, newMode, oldBlob, newBlob, file: normalizePortable(fields[index]) });
  }

  return changes;
}

// The base tree is the merge base plus the HEAD test files. A file added,
// removed or renamed in the diff cannot be there as HEAD has it, and a changed
// file that is not plain code (fixture, data, build or config, a test setup, a
// module the command preloads, a symlink) can make the test fail for a reason
// that is not the finding. Both are refused rather than guessed at; prose is
// ignored. `code` is what is left: the modified code files that are the fix.
function classifyChanges(root, base, tests, command, env) {
  const testSet = new Set(tests.map(normalizePortable));
  const launch = launchText(root, command, env);
  const unsupported = [];
  const code = [];

  for (const change of diffChanges(root, base)) {
    if (testSet.has(change.file) && change.status !== "T" && REGULAR_MODES.has(change.newMode)) {
      continue;
    }

    // Only prose the trees copy from HEAD (added or modified, so never a type
    // change such as a symlink becoming a file) is let through.
    if (isNonBehavior(change.file) && ["A", "M"].includes(change.status) && REGULAR_MODES.has(change.newMode)) {
      continue;
    }

    if (change.status === "M" && !namedAtLaunch(launch, change.file) && isCodeChange(root, change)) {
      code.push(change.file);
    } else {
      unsupported.push(change.file);
    }
  }

  return { unsupported: [...new Set(unsupported)].sort(), code };
}

function existsAtHead(root, file) {
  try {
    execFileSync("git", ["cat-file", "-e", `HEAD:${file}`], { env: treeEnvironment(), cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// A test the trail runs must be exactly what HEAD holds: the HEAD worktree is
// built from HEAD, so an uncommitted test would be either absent from one side
// or different from the other, and neither outcome says anything about the fix.
function uncommittedTestFiles(root, files) {
  const dirty = new Set([
    ...getChangedFiles(root),
    ...runGitList(["ls-files", "--others", "--exclude-standard"], root),
  ]);

  return files.filter((file) => dirty.has(file) || !existsAtHead(root, file));
}

// The red side is built from HEAD; the validation commands ran in the working
// tree. An uncommitted code, fixture or config change makes those two different
// trees, so the proof would claim more than it measured.
function uncommittedOtherFiles(root, tests) {
  const testSet = new Set(tests.map(normalizePortable));
  const dirty = new Set([
    ...getChangedFiles(root),
    ...runGitList(["ls-files", "--others", "--exclude-standard"], root),
  ]);

  return [...dirty].filter((file) => !testSet.has(file) && !isNonBehavior(file)).sort();
}

// The user's post-checkout hooks (LFS, husky) are not part of the proof and
// must not run twice per verify: hooks point at a path that does not exist.
function makeWorktree(root, destination, ref) {
  const noHooks = path.join(path.dirname(destination), "no-hooks");

  execFileSync("git", ["-c", `core.hooksPath=${noHooks}`, "worktree", "add", "--detach", destination, ref], {
    env: treeEnvironment(),
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function linkManaged(root, destination) {
  for (const name of MANAGED_LINKS) {
    const source = path.join(root, name);
    const target = path.join(destination, name);

    if (!fs.existsSync(source) || fs.existsSync(target) || lstatSafe(target)) {
      continue;
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    const directory = isDir(source);

    if (process.platform === "win32" && directory) {
      fs.symlinkSync(source, target, "junction");
    } else {
      fs.symlinkSync(path.relative(path.dirname(target), source), target, directory ? "dir" : "file");
    }
  }
}

function removeManaged(destination) {
  for (const name of MANAGED_LINKS) {
    const candidate = path.join(destination, name);
    const stat = lstatSafe(candidate);

    if (stat && stat.isSymbolicLink()) {
      fs.unlinkSync(candidate);
    }
  }
}

// The admin entry (`.git/worktrees/<name>`) of one of OUR trees, and only when
// its `gitdir` points back at that tree. A repository-wide `worktree prune`
// would also drop the entry of a user's worktree whose folder is momentarily
// missing (an unmounted drive), which `worktree repair` cannot bring back.
function ownAdminEntry(destination) {
  try {
    const pointer = fs.readFileSync(path.join(destination, ".git"), "utf8").match(/^gitdir: (.+)$/m);
    const admin = pointer && path.resolve(destination, pointer[1].trim());
    const back = admin && fs.readFileSync(path.join(admin, "gitdir"), "utf8").trim();

    // git writes the real path (macOS: /private/var for the /var temp dir).
    return back && realpathSafe(back) === realpathSafe(path.join(destination, ".git")) ? admin : null;
  } catch {
    return null;
  }
}

function removeWorktree(root, destination) {
  const admin = ownAdminEntry(destination);

  try {
    removeManaged(destination);
  } catch {
    // A link we cannot remove must not stop the worktree removal below.
  }

  try {
    // A concurrent `worktree lock` must not turn into a leaked admin entry.
    execFileSync("git", ["worktree", "unlock", destination], { env: treeEnvironment(), cwd: root, stdio: "ignore" });
  } catch {
    // Not locked (the normal case).
  }

  try {
    // The second `--force` also removes a worktree locked after the unlock.
    execFileSync("git", ["worktree", "remove", "--force", "--force", destination], {
      env: treeEnvironment(),
      cwd: root,
      stdio: "ignore",
    });
  } catch {
    // Already gone, or git refused: drop our own admin entry below.
  }

  if (admin && fs.existsSync(admin)) {
    fs.rmSync(admin, { recursive: true, force: true });
  }
}

function cleanup(root, dirs) {
  for (const destination of [dirs.base, dirs.head]) {
    removeWorktree(root, destination);
  }

  try {
    fs.rmSync(dirs.root, { recursive: true, force: true });
  } catch {
    // Best effort: a leftover temp directory is not a leftover worktree.
  }
}

function shellQuote(value) {
  // A path beginning with `-` is an option to the runner, not a file. `./`
  // keeps it a path on every shell we support.
  const text = String(value).startsWith("-") ? `./${value}` : String(value);

  if (process.platform === "win32") {
    return `"${text.replace(/"/g, '\\"')}"`;
  }

  return /^[A-Za-z0-9_./@%+=:,-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`;
}

// `{files}` -> the test paths, quoted for the shell.
function expandCommand(command, files) {
  return String(command).replace(/\{files\}/g, () => files.map(shellQuote).join(" "));
}

function outputTail(result) {
  return [result.stdoutTail || "", result.stderrTail || ""]
    .filter(Boolean)
    .join("\n")
    .trim()
    .split(/\r?\n/)
    .slice(-12)
    .join("\n");
}

// What to put in the reason: the runner's failure lines when it named any (the
// missing module, the assertion), the tail otherwise. A tail of a TAP run is
// often just the counters, which explains nothing.
function outputDetail(result) {
  const named = Array.isArray(result.failureLines) ? result.failureLines.filter(Boolean) : [];

  return (named.length > 0 ? named.slice(-8).join("\n") : outputTail(result)).trim();
}

// A red only counts when the base output shows a test FROM THE DIFF that
// started and failed. Anything else — a file that never loaded, a failed hook,
// a red from a test outside the diff, output that is not node's TAP — is
// refused: an unknown failure must never become a proof. Read from the output,
// not the command, so a wrapped command (`npm test --`) is read the same way.
// Each shape was observed from the real runner (node 18 and 22). Another
// runner's TAP (Vitest's `--reporter=tap`) has no `failureType`, so it is
// refused too.
//
// `context.files` are the diff's test files (repository-relative);
// `context.treeRoots` the base tree's paths, to read an absolute location.
const TAP_RUNNER = { name: "node --test (TAP)", detect: /^TAP version \d+/m };

// A location node printed (absolute, made relative to the tree) names one of
// the diff's test files only when it is that file: neither
// `legacy/test/math.test.js` nor a `test/math.test.js` the diff's
// `pkg/test/math.test.js` requires is this diff's test.
function isDiffFile(reported, files) {
  const portable = normalizePortable(reported.replace(/^\.\//, ""));

  return files.some((file) => {
    const diffFile = normalizePortable(file);

    return portable === diffFile;
  });
}

// An absolute path the runner printed, made relative to the tree it ran in
// (its real path too: macOS prints /private/var for /var).
function treeRelative(reported, treeRoots = []) {
  const portable = normalizePortable(reported);

  for (const root of treeRoots) {
    const prefix = `${normalizePortable(root)}/`;

    if (portable.startsWith(prefix)) {
      return portable.slice(prefix.length);
    }
  }

  return portable;
}

// node's TAP, line by line: each `not ok` header and the YAML keys at its own
// indentation (a multi-line `error: |-` is deeper and never read as a key).
function tapFailures(text) {
  const failures = [];
  let current = null;

  for (const line of text.split("\n")) {
    const header = !current || !current.inYaml ? line.match(/^(\s*)not ok \d+ (.*)$/) : null;

    if (header) {
      current = { indent: header[1], title: header[2], keys: {}, inYaml: false };
      failures.push(current);
    } else if (current && line === `${current.indent}  ---`) {
      current.inYaml = true;
    } else if (current && current.inYaml && line === `${current.indent}  ...`) {
      current = { ...current, inYaml: false };
      failures[failures.length - 1] = current;
      current = null;
    } else if (current && current.inYaml) {
      const key = line.match(new RegExp(`^${current.indent}  (\\w+): (.*)$`));

      if (key) {
        current.keys[key[1]] = key[2];
      }
    }
  }

  // A `# TODO` or `# SKIP` failure never sets the exit code: whatever made
  // the run red, it was not that test.
  return failures.filter((failure) => !/(?<!\\)# (?:TODO|SKIP)\b/i.test(failure.title));
}

// Every failure must be a test that ran (`testCodeFailure`) or a parent that
// only reports its children; anything else — a file-level failure (it threw
// while loading, with or without isolation), a failed hook, a block with no
// failure type — means some test never started.
function readTap(text, context) {
  const failures = tapFailures(text);
  let ran = false;

  // Another runner's TAP (Vitest's `--reporter=tap`) never carries node's
  // `failureType`: not read, rather than misnamed as a file that never loaded.
  if (failures.length > 0 && failures.every(({ keys }) => keys.failureType === undefined)) {
    return "unknown";
  }

  for (const { keys } of failures) {
    const type = (keys.failureType || "").replace(/'/g, "");

    if (type === "subtestsFailed" || type === "cancelledByParent") {
      continue;
    }

    if (type !== "testCodeFailure" || keys.exitCode !== undefined || !keys.location) {
      return "never-started";
    }

    const quoted = keys.location.replace(/^'|'$/g, "").replace(/:\d+:\d+$/, "");
    // node 18 prints an ESM file's location as a file:// URL.
    const location = quoted.startsWith("file://") ? fileURLToPath(quoted) : quoted;

    ran = ran || isDiffFile(treeRelative(location, context.treeRoots), context.files);
  }

  return ran ? "ran" : "unknown";
}

function runnerOutput(result) {
  if (typeof result.output === "string") {
    return result.output;
  }

  return [result.stdoutTail || "", result.stderrTail || ""].join("\n");
}

// `"ran"`, `"never-started"`, or `"unknown"` (not node's TAP, or no failed
// test from the diff). A run that mixes a test failure with a file that never
// loaded is `"never-started"`: the exit code is shared, so the red cannot be
// told apart.
function readBaseFailure(result, context = { files: [], treeRoots: [] }) {
  // Colour codes (FORCE_COLOR in CI) would defeat the line anchors.
  const text = runnerOutput(result)
    .replace(/\r\n/g, "\n")
    .replace(/\x1b\[[0-9;]*m/g, "");

  if (!TAP_RUNNER.detect.test(text)) {
    return { verdict: "unknown" };
  }

  return { runner: TAP_RUNNER.name, verdict: readTap(text, context) };
}

function redAtBaseResult(started, fields = {}) {
  return {
    base: fields.base || null,
    files: fields.files || [],
    baseExit: fields.baseExit === undefined ? null : fields.baseExit,
    headExit: fields.headExit === undefined ? null : fields.headExit,
    ok: fields.ok === true,
    reason: fields.reason || "",
    durationMs: Date.now() - started,
    ...(fields.baseTail ? { baseTail: fields.baseTail } : {}),
    ...(fields.headTail ? { headTail: fields.headTail } : {}),
  };
}

// Resolve what to run before touching the worktrees: a refusal here must be
// cheap and must not leave a tree behind. Returns `{ reason }` or a target.
function resolveRedAtBaseTargets(root, config, env) {
  const mergeBase = currentDiffBase(root).mergeBase;

  if (!mergeBase) {
    return {
      reason: "no merge base: --red-at-base compares the merge base with HEAD, and this checkout has neither.",
    };
  }

  const files = findChangedTestFiles(root, config);

  if (files.length === 0) {
    return {
      base: mergeBase,
      reason: "nothing to be red: a fix needs a test that demonstrates it (no added or modified test file in the diff).",
    };
  }

  const uncommitted = uncommittedTestFiles(root, files);

  if (uncommitted.length > 0) {
    return {
      base: mergeBase,
      files,
      reason:
        `the test file(s) are not committed at HEAD: ${uncommitted.join(", ")}. ` +
        "Commit the test and the fix, then run --red-at-base.",
    };
  }

  const dirty = uncommittedOtherFiles(root, files);

  if (dirty.length > 0) {
    return {
      base: mergeBase,
      files,
      reason:
        "the working tree has uncommitted non-test changes: " +
        `${dirty.join(", ")}. The red side is built from HEAD while the commands ran ` +
        "in the working tree; commit them, then run --red-at-base.",
    };
  }

  const { unsupported, code } = classifyChanges(root, mergeBase, files, (config.redAtBase || {}).command, env);

  if (unsupported.length > 0) {
    return {
      base: mergeBase,
      files,
      reason:
        "cannot run in a clean tree: the diff adds/removes non-test files or changes files that are not " +
        `plain JavaScript/TypeScript code: ${unsupported.join(", ")}. The base tree only carries the merge ` +
        "base plus the HEAD test files, so red-at-base could not tell a setup difference from the " +
        "finding. Keep the fix to code and tests, or verify without --red-at-base.",
    };
  }

  if (code.length === 0) {
    return {
      base: mergeBase,
      files,
      reason:
        "nothing to be red against: the diff changes no code, only tests (and prose). A red at the " +
        "merge base would come from the test or its environment, not from a fix.",
    };
  }

  return { base: mergeBase, files };
}

// The scratch directory is created (and therefore known to the caller's
// `finally`) before the first git command can throw. A failed HEAD worktree
// must not leave the base one registered.
//
// Under the OS temp dir, not the git dir: test discovery commonly skips every
// path containing `/.git/`, and a tool that walks parent directories for its
// config would climb into the user's checkout. The pid in the name lets a
// later run sweep a tree whose owner died.
const RUN_PREFIX = "coding-flow-red-at-base-";
// Written by the run that created the directory: the sweep only ever touches a
// directory carrying it, so a user's folder that happens to share the prefix
// is never a candidate.
const RUN_MARKER = ".coding-flow-red-at-base";

function createRedAtBaseDirs() {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), `${RUN_PREFIX}${process.pid}-`));
  fs.writeFileSync(path.join(runDir, RUN_MARKER), `${process.pid}\n`);

  return { root: runDir, base: path.join(runDir, "base"), head: path.join(runDir, "head") };
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function realpathSafe(candidate) {
  try {
    return fs.realpathSync(candidate);
  } catch {
    return null;
  }
}

// A linked worktree this module created: `base` or `head`, directly inside a
// marked, prefix-named run directory directly inside the OS temp dir, whose
// owning process is gone. Anything else — the main worktree, a user's worktree
// under a folder that shares the prefix — is not ours to remove.
function orphanedRunDir(worktree, tempRoot) {
  if (!["base", "head"].includes(path.basename(worktree))) {
    return null;
  }

  const runDir = path.dirname(worktree);
  const match = path.basename(runDir).match(new RegExp(`^${RUN_PREFIX}(\\d+)-`));

  if (!match || realpathSafe(path.dirname(runDir)) !== tempRoot) {
    return null;
  }

  if (!fs.existsSync(path.join(runDir, RUN_MARKER)) || processAlive(Number(match[1]))) {
    return null;
  }

  return runDir;
}

// A run killed by a signal while its command was blocking never reaches its
// `finally`. The next run removes the worktrees such a run left in this repo,
// then the marker and the (now empty) run directory — never recursively.
function sweepOrphanedRuns(root) {
  let listing = "";

  try {
    listing = execFileSync("git", ["worktree", "list", "--porcelain"], {
      env: treeEnvironment(),
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return;
  }

  const tempRoot = realpathSafe(os.tmpdir());
  // The first entry is always the main worktree, never a candidate.
  const worktrees = listing
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
    .slice(1);
  const runs = new Set(worktrees.map((worktree) => orphanedRunDir(worktree, tempRoot)).filter(Boolean));

  for (const runDir of runs) {
    removeWorktree(root, path.join(runDir, "base"));
    removeWorktree(root, path.join(runDir, "head"));

    try {
      fs.unlinkSync(path.join(runDir, RUN_MARKER));
      fs.rmdirSync(runDir);
    } catch {
      // Something else is in there: leave the directory, not the registration.
    }
  }

}

// A tracked symlink in the base tree must not redirect the HEAD test file
// outside the throwaway worktree. Replace any symlink (or non-directory) on the
// ancestor path with a real directory; the copied test then lands in the tree.
function materializeParent(root, destination) {
  const relative = path.relative(root, destination);

  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`test path escapes the worktree: ${destination}`);
  }

  let current = root;

  for (const part of relative.split(path.sep).slice(0, -1)) {
    current = path.join(current, part);
    const stat = lstatSafe(current);

    if (stat && stat.isSymbolicLink()) {
      fs.unlinkSync(current);
      fs.mkdirSync(current);
    } else if (stat && !stat.isDirectory()) {
      fs.rmSync(current, { force: true });
      fs.mkdirSync(current);
    } else if (!stat) {
      fs.mkdirSync(current);
    }
  }
}

function copyHeadFile(dirs, file) {
  const source = path.join(dirs.head, file);
  const destination = path.join(dirs.base, file);

  materializeParent(dirs.base, destination);

  const stat = lstatSafe(destination);

  if (stat) {
    if (stat.isDirectory()) {
      fs.rmSync(destination, { recursive: true, force: true });
    } else {
      // Unlink first: a symlink or a hard link must not redirect this write.
      fs.unlinkSync(destination);
    }
  }

  fs.copyFileSync(source, destination);
}

// Both trees are built from the same repository and linked to the same
// dependencies; the only difference is the code between the merge base and HEAD.
function populateRedAtBaseTrees(root, dirs, base, files) {
  makeWorktree(root, dirs.base, base);
  makeWorktree(root, dirs.head, "HEAD");
  linkManaged(root, dirs.base);
  linkManaged(root, dirs.head);

  // The same setup on both sides: only the code change differs. The HEAD
  // version of each test file is what runs at the base too, so the question is
  // "does this test catch the old behavior?", not "does this file exist?".
  for (const file of files) {
    copyHeadFile(dirs, file);
  }

  // Prose the preflight lets through (a root README, a story file) comes from
  // HEAD too, so it can never be the difference a test reads.
  const prose = [...diffFiles(root, base, "A"), ...diffFiles(root, base, "M")].filter(isNonBehavior);

  for (const file of prose) {
    copyHeadFile(dirs, file);
  }

  commitCopies(dirs.base, [...files, ...prose]);
}

// The copies are committed in the base tree, so its `git status`/`git diff`
// is as clean as the HEAD tree's: a test that checks the tree is clean must
// not be red at base for that alone. The tree's own index and a detached,
// unreferenced commit; the user's index and refs are never touched. A commit
// ends with `maintenance run --auto` on the shared repository (a `gc` that
// packs refs, expires reflogs and prunes worktrees): switched off here.
function commitCopies(tree, files) {
  const settings = [
    `core.hooksPath=${path.join(path.dirname(tree), "no-hooks")}`,
    "gc.auto=0",
    "maintenance.auto=false",
  ].flatMap((setting) => ["-c", setting]);
  const git = (args) =>
    execFileSync("git", [...settings, ...args], {
      env: treeEnvironment(),
      cwd: tree,
      stdio: ["ignore", "pipe", "pipe"],
    });

  git(["add", "--force", "--", ...files]);
  git([
    "-c", "user.name=coding-flow red-at-base",
    "-c", "user.email=red-at-base@coding-flow.invalid",
    "-c", "commit.gpgsign=false",
    "commit", "--quiet", "--no-verify", "--allow-empty", "-m", "red-at-base: HEAD test files",
  ]);
}

function evaluateRedAtBase(shape, baseResult, headResult, context) {
  if (baseResult.toolError || headResult.toolError) {
    return {
      ...shape,
      reason: `the targeted command could not be observed: ${baseResult.toolError || headResult.toolError}`,
    };
  }

  if (headResult.exitCode !== 0) {
    const baseDetail = outputDetail(baseResult);
    const headDetail = outputDetail(headResult);
    const why =
      baseResult.exitCode === 0
        ? "the test passes at the merge base but fails on the fix: this change broke it."
        : "the test fails on the fix too, or cannot run in a clean tree.";

    return {
      ...shape,
      reason:
        why +
        (baseDetail ? `\n--- base ---\n${baseDetail}` : "") +
        (headDetail ? `\n--- HEAD ---\n${headDetail}` : ""),
    };
  }

  if (baseResult.exitCode === 0) {
    return {
      ...shape,
      reason: "the test does not demonstrate the finding: it passes at the merge base too.",
    };
  }

  // The command runs through a shell: a runner killed by a signal usually
  // shows as the shell's 128+n exit code, not as a signal of its own.
  const killedBy =
    baseResult.signal ||
    (baseResult.exitCode > 128 && baseResult.exitCode < 160 ? `signal ${baseResult.exitCode - 128}` : null);

  if (baseResult.timedOut || killedBy) {
    return {
      ...shape,
      reason:
        "the test did not finish at the merge base (" +
        (baseResult.timedOut ? "timed out" : `killed by ${killedBy}`) +
        "): an unfinished run is not a red.",
    };
  }

  const read = readBaseFailure(baseResult, context);
  const detail = outputDetail(baseResult);

  if (read.verdict === "never-started") {
    return {
      ...shape,
      reason:
        `the test cannot run in a clean tree: ${read.runner} reports a file that never reached its ` +
        "tests at the merge base (a missing module or export, a syntax error, a failed hook), " +
        "not a test that failed." +
        (detail ? `\n--- base ---\n${detail}` : ""),
    };
  }

  if (read.verdict === "unknown") {
    return {
      ...shape,
      reason:
        "the base output does not show a test from the diff that ran and failed, so the red cannot be proven. " +
        "red-at-base reads node's test runner in TAP only: `node --test --test-reporter=tap {files}`." +
        (detail ? `\n--- base ---\n${detail}` : ""),
    };
  }

  return {
    ...shape,
    ok: true,
    reason: "the test failed at the merge base and passed at HEAD.",
  };
}

// Why `redAtBase.command` cannot be run at all, or null.
function commandRefusal(command) {
  if (!command) {
    return missingCommandReason();
  }

  // In-process isolation prints nothing for a file that throws while loading,
  // so "nothing that never started" could not be read from the output.
  if (/--experimental-test-isolation(?:=|\s+)none\b|--test-isolation(?:=|\s+)none\b/.test(command)) {
    return (
      "redAtBase.command runs the tests without isolation (test-isolation=none): a file that fails " +
      `to load prints nothing then, so a red cannot be proven. Drop the flag, e.g.\n${exampleList()}`
    );
  }

  if (!/\{files\}/.test(command)) {
    return `redAtBase.command has no {files} placeholder, so it cannot target the diff's tests, e.g.\n${exampleList()}`;
  }

  return null;
}

function runRedAtBase({
  root = cwd,
  config = readHarnessConfig(root).config,
  runCommand = runValidationCommand,
  env,
} = {}) {
  const started = Date.now();
  const settings = config.redAtBase || {};
  const command = typeof settings.command === "string" ? settings.command.trim() : "";
  const timeoutMs = Number.isFinite(settings.timeoutMs) ? settings.timeoutMs : null;

  const refusal = commandRefusal(command);

  if (refusal) {
    return redAtBaseResult(started, { reason: refusal });
  }

  let target;

  try {
    target = resolveRedAtBaseTargets(root, config, env);
  } catch (error) {
    // An invalid --base exits through `fail()` inside currentDiffBase; this
    // catches the other target-resolution errors (e.g. a malformed config).
    return redAtBaseResult(started, { reason: `red-at-base could not resolve its target: ${error.message || error}` });
  }

  if (target.reason) {
    return redAtBaseResult(started, target);
  }

  let dirs = null;

  try {
    sweepOrphanedRuns(root);
    dirs = createRedAtBaseDirs();
    populateRedAtBaseTrees(root, dirs, target.base, target.files);
    const expanded = expandCommand(command, target.files);
    // The whole output, not the 4 KB tail: a file that never loaded can sit
    // far above the last test's failure. Read here, never stored.
    const options = {
      keepOutput: true,
      ...(timeoutMs ? { timeoutMs } : {}),
      env: treeEnvironment(env || process.env),
    };
    const baseResult = runCommand(expanded, { cwd: dirs.base, ...options });
    const headResult = runCommand(expanded, { cwd: dirs.head, ...options });
    const shape = {
      base: target.base,
      files: target.files,
      baseExit: baseResult.exitCode,
      headExit: headResult.exitCode,
      baseTail: outputTail(baseResult),
      headTail: outputTail(headResult),
    };

    const context = {
      files: target.files,
      // A stack prints the tree's real path (macOS: /private/var for /var).
      treeRoots: [...new Set([dirs.base, fs.realpathSync(dirs.base)])],
    };

    return redAtBaseResult(started, evaluateRedAtBase(shape, baseResult, headResult, context));
  } catch (error) {
    return redAtBaseResult(started, {
      base: target.base,
      files: target.files,
      reason: `red-at-base could not complete: ${error.message || error}`,
    });
  } finally {
    if (dirs) {
      cleanup(root, dirs);
    }
  }
}

module.exports = {
  COMMAND_EXAMPLES,
  missingCommandReason,
  expandCommand,
  findChangedTestFiles,
  runRedAtBase,
};
