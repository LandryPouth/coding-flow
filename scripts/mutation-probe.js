#!/usr/bin/env node
"use strict";

// story-15-04: the diff-scoped mutation probe of the Uncle Bob study
// (docs/plans/uncle-bob-gauntlet.md, experiment 1), committed so 15-05 starts
// from it instead of from a description. It mutates the lines a diff added,
// one operator swap at a time, and runs a targeted test command per mutant in
// a throwaway worktree: a mutant the command still passes on is a line no test
// pins down.
//
// Usage:
//   node scripts/mutation-probe.js --base <rev> [--head <rev>] [--at <rev>]
//     --command "<shell command, {files} = the test files>"
//     [--repo <dir>] [--paths <pathspec>]... [--tests <file>]...
//     [--max <n>] [--seed <text>] [--timeout <s per mutant>]
//     [--link <path>]... [--link-from <dir>] [--json <file> [--force]] [--dry-run]
//
// - Sites are the added lines of `git diff <base> <head>` in JS/TS files;
//   test files, `__mocks__/`, `.d.ts` and stories are not sites. `--at`
//   (default `--head`) is the tree the mutants run on: a site whose line no
//   longer exists there, verbatim, is dropped. Paths are from the repository root.
// - `{files}` in the command becomes the test files the diff touched (or the
//   `--tests` given), as they exist at `--at`.
// - `--link node_modules` symlinks `<link-from>/node_modules` into the
//   worktree. A link must name a path inside the worktree other than `.git`,
//   through no symlink, not nested in another link, and holding no site or
//   test file. A linked
//   directory is the real one: a runner may write its caches there, and a
//   workspace package reached through it is `<link-from>`'s copy, not `--at`'s.
// - The repository's working tree is never written, and no other worktree of
//   it is touched: the mutants live in a detached worktree under the system
//   temp directory (made with hooks off, git's location variables cleared),
//   removed at the end, on Ctrl-C (exit 130), SIGTERM (143) or SIGHUP (129).
//   A SIGKILL leaves it, and the command's process group, behind: the next
//   run removes both once the run that made them is gone (the group only
//   while its leader still works inside that worktree, read from /proc: on a
//   system without it, macOS for one, a left group is not killed).
// - `--base`, `--head` and `--at` must name commits; git only ever sees their
//   hashes. `--json` does not overwrite a file without `--force`.
//
// Known limits, printed rather than hidden: strings, templates (nested ones
// too), comments and regex literals are skipped by a line scanner, not a
// parser — a regex is recognised by what precedes its `/` (so one right after
// `)` is read as a division, as is one that does not close on its line), and
// JSX text between tags is read as code; equivalent mutants exist and
// only a human can tell them; a mutant that does not compile is reported
// apart (`compile`), never as killed, but only when the runner prints a TS
// error or a `SyntaxError:` line the passing baseline did not; a timeout is
// counted apart too, as a slow run is as likely as a hung one; while cleanup
// runs, a second Ctrl-C does not interrupt it.

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");

const SOURCE = /\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/;
// Not a site: anything under a test directory, helpers included.
const TEST = /(?:^|\/)(?:__tests__|test|tests)\/|\.(?:spec|test|integration-spec|e2e-spec)\.[a-z]+$/;
// What `{files}` receives: test files by name only, so a helper is never run as one.
const TEST_FILE = /\.(?:spec|test|integration-spec|e2e-spec)\.[a-z]+$/;
const NOT_SITES = /(?:^|\/)__mocks__\/|\.d\.[cm]?ts$|\.stories\.[jt]sx?$/;
const OUTPUT_LIMIT = 16 * 1024 * 1024;
// Set by a git hook or `rebase --exec`, they would point every git command, and
// the command under test, at the user's repository instead of the worktree.
const GIT_LOCATION = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR", "GIT_NAMESPACE", "GIT_PREFIX", "GIT_CEILING_DIRECTORIES"];
const EXIT_ON = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
const STALE = /^mutation-probe-(\d+)-/;

// Each operator: where it matches in the masked line, and what replaces it.
// Relational swaps require surrounding spaces, so TS generics (`Array<T>`)
// and arrows (`=>`) are never sites; `!` before `=` is not a negation, and
// `obj.true` or `$true` is not a literal.
const OPERATORS = [
  { name: "=== → !==", pattern: /===/g, replace: "!==" },
  { name: "!== → ===", pattern: /!==/g, replace: "===" },
  { name: "&& → ||", pattern: /&&(?!=)/g, replace: "||" },
  { name: "|| → &&", pattern: /\|\|(?!=)/g, replace: "&&" },
  { name: "< → <=", pattern: /(?<= )<(?= )/g, replace: "<=" },
  { name: "<= → <", pattern: /(?<= )<=(?= )/g, replace: "<" },
  { name: "> → >=", pattern: /(?<= )>(?= )/g, replace: ">=" },
  { name: ">= → >", pattern: /(?<= )>=(?= )/g, replace: ">" },
  { name: "true → false", pattern: /(?<![.$\w])true(?![$\w])/g, replace: "false" },
  { name: "false → true", pattern: /(?<![.$\w])false(?![$\w])/g, replace: "true" },
  // After an identifier, `)` or `]`, a `!` is TypeScript's non-null assertion.
  { name: "drop !", pattern: /(?<![\w$)\]])!(?=[A-Za-z_$(!])/g, replace: "" },
];

const REGEX_AFTER = "(,=:[!&|?{};+-*%<>~^";
const REGEX_AFTER_WORD = /(?:^|[^\w$.])(?:return|typeof|case|in|of|delete|void|throw|new|yield|await|else|do)$/;

// Whether a `/` here opens a regex literal rather than a division: it does
// after an operator, a punctuator, a keyword, or at the start of the line.
function regexMayStart(out) {
  const before = out.trimEnd();
  return before === "" || REGEX_AFTER.includes(before[before.length - 1]) || REGEX_AFTER_WORD.test(before);
}

// The index just past a regex literal opening at `from` (flags included), or
// -1 when it does not close on this line.
function regexEnd(line, from) {
  let inClass = false;
  for (let i = from + 1; i < line.length; i += 1) {
    if (line[i] === "\\") {
      i += 1;
    } else if (line[i] === "[" || line[i] === "]") {
      inClass = line[i] === "[";
    } else if (line[i] === "/" && !inClass) {
      let end = i + 1;
      while (/[a-z]/i.test(line[end] || "")) {
        end += 1;
      }
      return end;
    }
  }
  return -1;
}

// The line with string contents, comments and regex literals blanked, one
// character for one, so a column in the result is a column in the source.
// `state.stack` carries what is open at the end of the previous line: quotes,
// templates, and the brace depth of each `${…}` inside a template.
function maskLine(line, state = {}) {
  const stack = [...(state.stack || [])];
  const top = () => stack[stack.length - 1];
  let block = Boolean(state.inBlock);
  let continued = false;
  let out = "";
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const mode = top();
    if (block) {
      block = !(ch === "*" && line[i + 1] === "/");
      out += block ? " " : "  ";
      i += block ? 0 : 1;
    } else if (typeof mode === "string") {
      if (ch === "\\") {
        continued = i === line.length - 1;
        out += continued ? " " : "  ";
        i += 1;
      } else if (ch === mode) {
        stack.pop();
        out += ch;
      } else if (mode === "`" && ch === "$" && line[i + 1] === "{") {
        stack.push(0);
        out += "${";
        i += 1;
      } else {
        out += " ";
      }
    } else if (ch === "/" && line[i + 1] === "/") {
      out += " ".repeat(line.length - i);
      break;
    } else if (ch === "/" && line[i + 1] === "*") {
      block = true;
      out += "  ";
      i += 1;
    } else if (ch === "'" || ch === '"' || ch === "`") {
      stack.push(ch);
      out += ch;
    } else if (ch === "/" && regexMayStart(out) && regexEnd(line, i) !== -1) {
      const end = regexEnd(line, i);
      out += " ".repeat(end - i);
      i = end - 1;
    } else {
      if (typeof mode === "number" && (ch === "{" || ch === "}")) {
        // The `}` closing a `${…}` hands back to its template.
        if (ch === "}" && mode === 0) {
          stack.pop();
        } else {
          stack[stack.length - 1] += ch === "{" ? 1 : -1;
        }
      }
      out += ch;
    }
  }
  // A '…' or "…" string ends with its line, unless the line ends in `\`.
  if ((top() === "'" || top() === '"') && !continued) {
    stack.pop();
  }
  return { masked: out, stack, inBlock: block };
}

// Every mutation site in a file's lines, restricted to `lineNumbers` (1-based).
function findSites(file, lines, lineNumbers) {
  const wanted = new Set(lineNumbers);
  const sites = [];
  let state = {};
  lines.forEach((line, index) => {
    const result = maskLine(line, state);
    state = result;
    if (!wanted.has(index + 1) || /^\s*\*/.test(line)) {
      return;
    }
    for (const op of OPERATORS) {
      for (const match of result.masked.matchAll(op.pattern)) {
        sites.push({ file, line: index + 1, column: match.index, match: match[0], operator: op.name, replace: op.replace });
      }
    }
  });
  return sites;
}

// The text with the site's operator swapped, or null when the text at that
// column is not the operator the site was found on (a checkout filter, CRLF).
function applySite(text, site) {
  const lines = text.split("\n");
  const line = lines[site.line - 1];
  if (line === undefined || line.slice(site.column, site.column + site.match.length) !== site.match) {
    return null;
  }
  lines[site.line - 1] = line.slice(0, site.column) + site.replace + line.slice(site.column + site.match.length);
  return lines.join("\n");
}

// The same order for the same seed, whatever order the sites were found in.
function sample(sites, max, seed) {
  const key = (s) => crypto.createHash("sha256").update(seed + "\0" + s.file + ":" + s.line + ":" + s.column + ":" + s.operator).digest("hex");
  return sites
    .map((site) => ({ site, key: key(site) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, max)
    .map((entry) => entry.site);
}

// A path as git prints it: C-quoted (`"b/caf\303\251.js"`) when it holds a
// quote, a backslash or a control character, even with core.quotePath off.
function unquotePath(text) {
  if (!text.startsWith('"')) {
    return text;
  }
  const bytes = [];
  const escapes = { n: 10, t: 9, r: 13, '"': 34, "\\": 92, a: 7, b: 8, f: 12, v: 11 };
  for (let i = 1; i < text.length - 1; i += 1) {
    if (text[i] !== "\\") {
      bytes.push(...Buffer.from(text[i]));
    } else if (/[0-7]/.test(text[i + 1])) {
      bytes.push(parseInt(text.slice(i + 1, i + 4), 8));
      i += 3;
    } else {
      bytes.push(escapes[text[i + 1]]);
      i += 1;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

// `git diff -U0` (prefixes `a/`, `b/`) → { file: [{ line, text }] } for the added
// lines. `+++` is a header only before the first hunk of a file: inside one it
// is an added line that starts with `++`.
function addedLines(diff) {
  const files = {};
  let file = null;
  let inHunk = false;
  let next = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      file = null;
    } else if (!inHunk && line.startsWith("+++ ")) {
      // git appends a TAB to a name holding a space: `+++ b/my lib.js\t`.
      const name = unquotePath(line.slice(4).replace(/\t$/, ""));
      file = name === "/dev/null" ? null : name.slice(2);
      if (file) {
        files[file] = files[file] || [];
      }
    } else if (line.startsWith("@@")) {
      inHunk = true;
      next = Number(/\+(\d+)/.exec(line)[1]);
    } else if (inHunk && file && line.startsWith("+")) {
      files[file].push({ line: next, text: line.slice(1) });
      next += 1;
    } else if (inHunk && line.startsWith(" ")) {
      // A context line (diff.interHunkContext merges hunks even under -U0).
      next += 1;
    }
  }
  return files;
}

// An added line's number in the `--at` tree: the verbatim match nearest to
// where the diff put it, or null when it is gone.
function relocate(lines, added) {
  let best = null;
  lines.forEach((text, index) => {
    if (text === added.text && added.text.trim() !== "") {
      const distance = Math.abs(index + 1 - added.line);
      if (best === null || distance < best.distance) {
        best = { line: index + 1, distance };
      }
    }
  });
  return best === null ? null : best.line;
}

function cleanEnv() {
  const env = { ...process.env };
  GIT_LOCATION.forEach((name) => delete env[name]);
  // `git -c core.worktree=…` in a hook travels in these: it would follow every git call.
  Object.keys(env).filter((name) => /^GIT_CONFIG_(?:PARAMETERS|COUNT|KEY_\d+|VALUE_\d+)$/.test(name)).forEach((name) => delete env[name]);
  // Inherited from an enclosing `node --test`, it makes a nested `node --test`
  // report to that parent and exit 0 whatever its tests did.
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function git(cwd, args) {
  return execFileSync("git", ["-c", "core.quotePath=false", ...args], { cwd, env: cleanEnv(), encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function parseArgs(argv) {
  const opts = { paths: [], tests: [], link: [], max: 30, head: "HEAD", repo: process.cwd(), dryRun: false };
  const many = { "--paths": "paths", "--tests": "tests", "--link": "link" };
  const one = { "--base": "base", "--head": "head", "--at": "at", "--command": "command", "--repo": "repo", "--seed": "seed", "--json": "json", "--link-from": "linkFrom", "--max": "max", "--timeout": "timeout" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run" || arg === "--force") {
      opts[arg === "--dry-run" ? "dryRun" : "force"] = true;
      continue;
    }
    if (!many[arg] && !one[arg]) {
      throw new Error("unknown argument: " + arg);
    }
    const value = argv[(i += 1)];
    if (value === undefined) {
      throw new Error(arg + " needs a value");
    }
    if (many[arg]) {
      opts[many[arg]].push(value);
    } else {
      opts[one[arg]] = value;
    }
  }
  if (!opts.base || (!opts.command && !opts.dryRun)) {
    throw new Error("--base and --command are required (--command may be left out with --dry-run)");
  }
  for (const flag of ["base", "head", "at"]) {
    if (typeof opts[flag] === "string" && opts[flag].startsWith("-")) {
      throw new Error("--" + flag + " " + JSON.stringify(opts[flag]) + " is not a revision");
    }
  }
  // lstat, not exists: a dangling symlink would be followed by the write.
  const present = (file) => {
    try {
      fs.lstatSync(file);
      return true;
    } catch {
      return false;
    }
  };
  if (opts.json && present(opts.json) && !opts.force) {
    throw new Error("--json " + opts.json + " exists: pass --force to overwrite it");
  }
  opts.max = Number(opts.max);
  if (!Number.isInteger(opts.max) || opts.max < 1) {
    throw new Error("--max must be a positive integer");
  }
  // Past 2^31-1 ms, setTimeout fires at once: every mutant would read as a timeout kill.
  if (opts.timeout !== undefined && !(Number(opts.timeout) > 0 && Number(opts.timeout) * 1000 <= 2 ** 31 - 1)) {
    throw new Error("--timeout must be a number of seconds between 0 and 2147483");
  }
  opts.repo = path.resolve(opts.repo);
  opts.at = opts.at || opts.head;
  opts.seed = opts.seed || opts.base + ".." + opts.head;
  opts.linkFrom = path.resolve(opts.linkFrom || opts.repo);
  return opts;
}

function quote(file) {
  return "'" + file.replace(/'/g, "'\\''") + "'";
}

// Runs in its own process group, so a timeout or an interrupt stops every
// process the command started, not only `sh`; `stop` is set by the signal handlers.
function runCommand(command, cwd, timeoutMs, stop) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn("sh", ["-c", command], { cwd, env: cleanEnv(), detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const running = stop.tmp ? path.join(stop.tmp, "running") : null;
    if (running) {
      // Read by the next run if this one is SIGKILLed: the group to stop.
      fs.writeFileSync(running, String(child.pid));
    }
    // A command that could not start (a fork failure under load) is no kill.
    child.on("error", (error) => {
      resolve({ status: "error", compileLines: [], durationMs: Date.now() - started, tail: String(error.message) });
    });
    const killGroup = () => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // already gone
      }
    };
    // The last OUTPUT_LIMIT bytes, kept as chunks: no copy of the whole on every one.
    const chunks = [];
    let kept = 0;
    const collect = (chunk) => {
      chunks.push(chunk);
      kept += chunk.length;
      while (kept - chunks[0].length >= OUTPUT_LIMIT) {
        kept -= chunks.shift().length;
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => {
        timedOut = true;
        killGroup();
      }, timeoutMs)
      : null;
    stop.kill = killGroup;
    // What the command left running in the background would hold the pipes
    // open and overlap the next mutant: it goes when `sh` does.
    child.on("exit", killGroup);
    child.on("close", (code) => {
      clearTimeout(timer);
      stop.kill = null;
      if (running) {
        fs.writeFileSync(running, "");
      }
      const output = Buffer.concat(chunks).toString("utf8");
      const status = stop.interrupted ? "interrupted" : timedOut ? "timeout" : code === 0 ? "pass" : "fail";
      // The lines that say a type or syntax error: a mutant failing on one was
      // stopped before any test could catch it.
      const compileLines = output.split("\n").filter((line) => /\bTS\d{4}\b|^\s*SyntaxError:/.test(line)).map((line) => line.trim());
      resolve({ status, compileLines, durationMs: Date.now() - started, tail: output.split("\n").slice(-15).join("\n") });
    });
  });
}

// The sites of the diff's added source lines, as they stand at `--at`, and
// the test files that `{files}` becomes.
function collectSites(opts) {
  const diffArgs = ["diff", "-U0", "--no-color", "--no-renames", "--no-ext-diff", "--no-textconv", "--inter-hunk-context=0", "--src-prefix=a/", "--dst-prefix=b/"];
  const added = addedLines(git(opts.repo, [...diffArgs, opts.base, opts.head, "--", ...opts.paths]));
  const atFiles = new Set(git(opts.repo, ["ls-tree", "-r", "-z", "--full-tree", "--name-only", opts.at]).split("\0"));
  const sources = Object.keys(added).filter((f) => SOURCE.test(f) && !TEST.test(f) && !NOT_SITES.test(f) && atFiles.has(f));
  // `--paths` narrows the sites, not the tests that guard them.
  const changed = git(opts.repo, ["diff", "--name-only", "-z", "--no-renames", opts.base, opts.head]).split("\0");
  const tests = opts.tests.length > 0 ? opts.tests : changed.filter((f) => SOURCE.test(f) && TEST_FILE.test(f) && atFiles.has(f));

  let sites = [];
  let dropped = 0;
  for (const file of sources) {
    const lines = git(opts.repo, ["show", opts.at + ":" + file]).split("\n");
    const numbers = added[file].map((entry) => (opts.at === opts.head ? entry.line : relocate(lines, entry)));
    dropped += numbers.filter((line) => line === null).length;
    sites = sites.concat(findSites(file, lines, numbers.filter((line) => line !== null)));
  }
  const addedCount = sources.reduce((sum, f) => sum + added[f].length, 0);
  return { sources, tests, sites, dropped, addedCount };
}

// The links, normalised, or an error: each names a path inside the worktree,
// none sits in another (once `a` is a symlink, removing `a/b` would delete
// the real one), and none holds a site or test file (its mutants would be
// written into the real file).
function checkLinks(links, files) {
  const normal = links.map((link) => {
    const relative = path.posix.normalize(String(link).split(path.sep).join("/")).replace(/\/+$/, "");
    if (relative === "" || relative === "." || relative === ".." || relative.startsWith("../") || path.isAbsolute(link)) {
      throw new Error("--link " + JSON.stringify(link) + " does not name a path inside the worktree");
    }
    if (relative.split("/").some((part) => part.toLowerCase() === ".git")) {
      // The worktree's `.git` file is what keeps the command off the user's index and refs.
      throw new Error("--link " + JSON.stringify(link) + " would hand the command the repository's own .git");
    }
    return relative;
  });
  const within = (inner, outer) => inner === outer || inner.startsWith(outer + "/");
  normal.forEach((link, i) => {
    if (normal.some((other, j) => j !== i && within(link, other))) {
      throw new Error("--link " + JSON.stringify(link) + " overlaps another --link");
    }
    const held = files.find((file) => within(file, link));
    if (held) {
      throw new Error("--link " + JSON.stringify(link) + " holds " + held + ": its mutants would be written into the real file");
    }
  });
  return normal;
}

// A link's place in the tree, refused when a symlink on the way (a tracked
// one) would lead out of it.
function linkTarget(tree, link) {
  let at = tree;
  for (const part of link.split("/").slice(0, -1)) {
    at = path.join(at, part);
    if (fs.existsSync(at) && fs.lstatSync(at).isSymbolicLink()) {
      throw new Error("--link " + JSON.stringify(link) + " goes through a symlink in the worktree");
    }
  }
  return path.join(tree, link);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// The process group a SIGKILLed run left, killed only while its leader still
// works inside that run's directory: a recorded pid may since belong to anyone.
function killLeftGroup(tmp) {
  try {
    const pgid = Number(fs.readFileSync(path.join(tmp, "running"), "utf8"));
    const cwd = fs.readlinkSync("/proc/" + pgid + "/cwd");
    if (pgid > 0 && (cwd + "/").startsWith(tmp + "/")) {
      process.kill(-pgid, "SIGKILL");
    }
  } catch {
    // no group left, or none that can be tied to this directory
  }
}

// Worktrees an earlier run left (it was SIGKILLed), recognised by their place
// under the temp directory and a dead run pid; their process group goes too.
// Nothing else of the repository is touched.
function removeStale(repo, log) {
  const listing = git(repo, ["worktree", "list", "--porcelain"]);
  for (const line of listing.split("\n")) {
    const tree = line.startsWith("worktree ") ? line.slice(9) : null;
    const tmp = tree && path.dirname(tree);
    const match = tmp && path.dirname(tmp) === fs.realpathSync(os.tmpdir()) && path.basename(tree) === "tree" ? STALE.exec(path.basename(tmp)) : null;
    if (!match || alive(Number(match[1]))) {
      continue;
    }
    killLeftGroup(tmp);
    try {
      git(repo, ["worktree", "remove", "--force", tree]);
      fs.rmSync(tmp, { recursive: true, force: true });
      log("Removed a worktree left by an earlier run (pid " + match[1] + "): " + tree);
    } catch (error) {
      log("Warning: could not remove " + tree + ", left by an earlier run (" + error.message.split("\n")[0] + ")");
    }
  }
}

// Deregisters the probe's worktree, never another: a failed `worktree
// remove` falls back to deleting its own admin directory, and only when that
// directory is where git keeps worktrees.
function removeWorktree(opts, tree, admin, log) {
  try {
    git(opts.repo, ["worktree", "remove", "--force", tree]);
    return;
  } catch (error) {
    log("Warning: git worktree remove failed (" + error.message.split("\n")[0] + ")");
  }
  const common = fs.realpathSync(path.resolve(opts.repo, git(opts.repo, ["rev-parse", "--git-common-dir"]).trim()));
  if (admin && path.dirname(fs.realpathSync(admin)) === path.join(common, "worktrees")) {
    fs.rmSync(admin, { recursive: true, force: true });
  } else {
    log("Warning: left " + tree + " registered: its admin directory is not under " + path.join(common, "worktrees"));
  }
}

// A detached worktree of `--at` under the system temp directory, with the
// `--link` paths symlinked in, removed once `fn` settles. Only this worktree
// is deregistered: never a `git worktree prune`, which would drop the
// repository's other stale worktrees too. A cleanup failure is reported, and
// never replaces the result.
async function withWorktree(opts, stop, files, log, fn) {
  const links = checkLinks(opts.link, files);
  const tmpRoot = fs.realpathSync(os.tmpdir());
  if ((tmpRoot + "/").startsWith(fs.realpathSync(opts.repo) + "/")) {
    throw new Error("the temp directory " + tmpRoot + " is inside the repository: set TMPDIR elsewhere");
  }
  removeStale(opts.repo, log);
  const tmp = fs.mkdtempSync(path.join(tmpRoot, "mutation-probe-" + process.pid + "-"));
  const tree = path.join(tmp, "tree");
  let admin = null;
  stop.tmp = tmp;
  try {
    git(opts.repo, ["-c", "core.hooksPath=/dev/null", "worktree", "add", "--detach", "--quiet", tree, opts.at]);
    admin = git(tree, ["rev-parse", "--absolute-git-dir"]).trim();
    for (const link of links) {
      const target = linkTarget(tree, link);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.rmSync(target, { recursive: true, force: true });
      fs.symlinkSync(path.join(opts.linkFrom, link), target);
    }
    return await fn(tree);
  } finally {
    stop.tmp = null;
    try {
      if (admin !== null) {
        removeWorktree(opts, tree, admin, log);
      }
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (error) {
      log("Warning: could not remove " + tmp + " (" + error.message + ")");
    }
  }
}

// One run per site, the file restored after each whatever happened. An
// interrupt stops the loop; the interrupted mutant is not counted. `noise` is
// what the passing baseline already printed: a TS code there decides nothing.
async function runMutants(chosen, command, tree, timeoutMs, stop, log, noise = new Set()) {
  const mutants = [];
  const realTree = fs.realpathSync(tree);
  for (const site of chosen) {
    const file = path.join(tree, site.file);
    if (!fs.realpathSync(file).startsWith(realTree + path.sep)) {
      throw new Error("refusing to mutate " + site.file + ": it resolves outside the worktree");
    }
    const original = fs.readFileSync(file, "utf8");
    const before = original.split("\n")[site.line - 1] || "";
    const mutated = applySite(original, site);
    if (mutated === null) {
      mutants.push({ file: site.file, line: site.line, operator: site.operator, status: "not applied", before: before.trim() });
      log("  not applied " + site.file + ":" + site.line + "  " + site.operator);
      continue;
    }
    fs.writeFileSync(file, mutated);
    let run;
    try {
      run = await runCommand(command, tree, timeoutMs, stop);
    } finally {
      fs.writeFileSync(file, original);
    }
    if (run.status === "interrupted") {
      break;
    }
    const compiled = !run.compileLines.some((line) => !noise.has(line));
    const status = run.status === "pass" ? "survived" : run.status === "fail" ? (compiled ? "killed" : "compile") : run.status;
    const after = mutated.split("\n")[site.line - 1].trim();
    mutants.push({ file: site.file, line: site.line, operator: site.operator, status, durationMs: run.durationMs, before: before.trim(), after });
    log("  " + status.padEnd(8) + " " + site.file + ":" + site.line + "  " + site.operator + "  (" + (run.durationMs / 1000).toFixed(1) + "s)");
    if (status === "survived") {
      log("           - " + before.trim() + "\n           + " + after);
    }
  }
  return mutants;
}

// The rate is killed over killed + survived: a mutant that did not compile,
// timed out (a slow run as often as a hung one), could not start or was not
// applied says nothing about the tests, and is counted apart.
function summarize(report, log) {
  const count = (s) => report.mutants.filter((m) => m.status === s).length;
  report.killed = count("killed");
  report.survived = count("survived");
  report.timeout = count("timeout");
  report.compile = count("compile");
  report.notApplied = count("not applied");
  report.errored = count("error");
  const decided = report.killed + report.survived;
  const ran = report.mutants.length - report.notApplied;
  // Rounded down, so a survivor never reads as 100 %.
  const rate = decided ? Math.floor((report.killed / decided) * 100) : 0;
  const perMutant = ran ? (report.durationMs / ran / 1000).toFixed(1) : 0;
  log("Killed " + report.killed + "/" + decided + " (" + (decided ? rate + " %" : "no rate") + "); apart: " + report.timeout + " timed out, "
    + report.compile + " did not compile, " + report.errored + " did not start, " + report.notApplied + " not applied; "
    + (report.durationMs / 1000).toFixed(0) + "s, " + perMutant + "s per mutant.");
  log("Limits: strings, templates and comments skipped heuristically; equivalent mutants are a human call; a compile failure is recognised only by a TS error or a SyntaxError line.");
}

// Ctrl-C, SIGTERM and SIGHUP stop the current command's process group and
// end the run, so the worktree is removed before the process exits.
async function withSignals(stop, fn) {
  const onSignal = (signal) => {
    stop.interrupted = stop.interrupted || signal;
    if (stop.kill) {
      stop.kill();
    }
  };
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  signals.forEach((signal) => process.on(signal, onSignal));
  try {
    return await fn();
  } finally {
    signals.forEach((signal) => process.removeListener(signal, onSignal));
  }
}

async function probe(opts, log = console.log) {
  const repo = git(opts.repo, ["rev-parse", "--show-toplevel"]).trim();
  // git only ever sees a hash: a revision can never be read as an option.
  const commit = (flag, rev) => {
    try {
      return git(repo, ["rev-parse", "--verify", "--quiet", "--end-of-options", rev + "^{commit}"]).trim();
    } catch {
      throw new Error("--" + flag + " " + JSON.stringify(rev) + " is not a commit");
    }
  };
  const names = { base: opts.base, head: opts.head, at: opts.at };
  opts = { ...opts, repo, base: commit("base", opts.base), head: commit("head", opts.head), at: commit("at", opts.at) };
  const { sources, tests, sites, dropped, addedCount } = collectSites(opts);
  const chosen = sample(sites, opts.max, opts.seed);
  log("Diff " + names.base + ".." + names.head + ": " + addedCount + " added source line(s) in " + sources.length + " file(s)"
    + (dropped ? ", " + dropped + " gone at " + names.at : "") + "; " + sites.length + " site(s), " + chosen.length + " sampled (seed \"" + opts.seed + "\").");
  log("Test files: " + (tests.length ? tests.join(" ") : "(none)"));
  const report = { ...names, seed: opts.seed, addedLines: addedCount, sites: sites.length, tests, mutants: [] };

  if (opts.command && opts.command.includes("{files}") && tests.length === 0) {
    // An empty `{files}` runs the whole suite: never what a targeted probe meant.
    report.error = "no test file for {files}: the diff touched none, and no --tests was given";
    log(report.error);
    return report;
  }
  if (opts.dryRun) {
    chosen.forEach((site) => log("  " + site.file + ":" + site.line + "  " + site.operator));
    report.mutants = chosen.map((site) => ({ ...site, status: "not run" }));
    return report;
  }

  const stop = { interrupted: false, kill: null, tmp: null };
  return withSignals(stop, () => withWorktree(opts, stop, [...sources, ...tests], log, async (tree) => {
    const command = opts.command.split("{files}").join(tests.map(quote).join(" "));
    // `--timeout` bounds each mutant; the baseline is what measures the default.
    const baseline = await runCommand(command, tree, undefined, stop);
    log("Baseline: " + baseline.status + " in " + (baseline.durationMs / 1000).toFixed(1) + "s");
    report.baselineMs = baseline.durationMs;
    if (baseline.status !== "pass") {
      log(baseline.tail);
      report.error = stop.interrupted ? "interrupted" : "the unmutated tree does not pass the command";
      report.interrupted = stop.interrupted;
      return report;
    }
    const timeoutMs = opts.timeout ? Number(opts.timeout) * 1000 : Math.max(60000, baseline.durationMs * 3);
    const started = Date.now();
    report.mutants = await runMutants(chosen, command, tree, timeoutMs, stop, log, new Set(baseline.compileLines));
    report.durationMs = Date.now() - started;
    report.interrupted = stop.interrupted;
    if (stop.interrupted) {
      report.error = "interrupted";
      log("Interrupted after " + report.mutants.length + " mutant(s); the worktree is removed.");
    }
    summarize(report, log);
    return report;
  }));
}

module.exports = { maskLine, findSites, applySite, sample, addedLines, unquotePath, relocate, parseArgs, removeWorktree, runCommand, runMutants, summarize, probe };

async function main() {
  // A closed pipe (`| head`) must not end the run before its worktree is removed.
  process.stdout.on("error", () => {});
  process.stderr.on("error", () => {});
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error("mutation-probe: " + error.message);
    process.exit(2);
  }
  let report;
  try {
    report = await probe(opts);
  } catch (error) {
    console.error("mutation-probe: " + error.message);
    process.exit(2);
  }
  if (opts.json) {
    fs.writeFileSync(opts.json, JSON.stringify(report, null, 2) + "\n");
  }
  process.exit(report.interrupted ? EXIT_ON[report.interrupted] : report.error ? 1 : 0);
}

if (require.main === module) {
  main();
}
