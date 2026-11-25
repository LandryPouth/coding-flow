"use strict";

// FROZEN: 29-03 destructive reader exactly as shipped at 3c90919 (story 29-04, plan.md
// R4 re-scope). The guard decides with the strictest of this reader and
// destructive.js, so no reader added later can weaken a decision 29-03 made. Do not
// edit: a fix belongs in destructive.js, which can only add refusals. It reads the
// line with shell-writes-29-03.js, frozen too; both are pinned by a hash.

// Story 29-03 — commands that throw away work or history wait for the human.
//
// Pure: a command line in, the destructive commands it runs out. It reads the
// line with `shell-writes.js`' segment splitter and verb reader (wrappers such as
// `sudo`, `env`, `nohup` stepped over), follows `bash -c`, `eval`, `xargs` and
// `find -exec`, and tracks `cd` / `git -C` so a finding knows the directory it
// runs in. What only the disk can settle — is this path modified, is this the
// primary checkout — is returned as a `check` for the guard to answer.
//
// A finding: { rule, words, command, destroys, alternative, cwd, check? }.
// `touched`: every path a command removes, moves or overwrites, as
// `{ cwd, paths, mode: "remove" | "write" }`, and every `find … -delete` as
// `{ cwd, find: { starts, tests } }` — the guard checks none reaches its own
// policy file.
// `words` is the command as read (wrappers and git's global options removed),
// matched against `allowDestructive`. `unchecked` lists what a destructive check
// depended on but could not read (an expansion where a flag may sit).

const path = require("path");
const { splitSegments, commandOf, verbAt, tokenize, heredocWord, SHELLS } = require("./shell-writes-29-03");

const EXPANDS = /[$`]/;
const ASK = "stop and ask the human";
const MAX_DEPTH = 4;

const EXPANSION = "a destructive-command check depends on shell expansion";
const UNKNOWN_CWD = "a destructive-command check depends on a working directory set by shell expansion";
const TOO_DEEP = `a destructive-command check stops at ${MAX_DEPTH} nested scripts`;
const CLI_ALIAS = "git runs an alias defined on its own command line";
const HIDDEN_VERB = "a destructive command may be run by a command the guard does not read";
const UNREAD_SUBSTITUTION = "a command substitution the guard cannot read";
const UNMODELLED = "the command uses shell syntax the guard does not model";
const HANDED_TEXT = "a command is handed text the guard reads as a destructive command";

// Short options glued in one word (`-fdx`) and long options (`--force=…`), up to `--`.
// `has(letter, name)` reads a long option as git and GNU tools do: any prefix
// (`--har` is `--hard`). An exemption reads `long` exactly instead, so `--dry`
// is never taken for `--dry-run`.
function optionsOf(args) {
  const end = args.indexOf("--");
  const head = end === -1 ? args : args.slice(0, end);
  const short = new Set();
  const long = new Set();
  for (const arg of head) {
    if (/^--[^-]/.test(arg)) {
      long.add(arg.slice(2).split("=")[0]);
    } else if (/^-[A-Za-z]+$/.test(arg)) {
      for (const letter of arg.slice(1)) {
        short.add(letter);
      }
    }
  }
  const abbrev = (name) => [...long].some((given) => name.startsWith(given));
  return { short, long, abbrev, has: (letter, name) => short.has(letter) || (name !== undefined && abbrev(name)) };
}

// The operands, skipping the value of each option in `valueOptions`, and every
// word after `--`.
function operandsOf(args, valueOptions = new Set()) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") {
      return out.concat(args.slice(i + 1));
    }
    if (valueOptions.has(arg)) {
      i += 1;
    } else if (!arg.startsWith("-") || arg === "-") {
      out.push(arg);
    }
  }
  return out;
}

const resolveIn = (cwd, word, home) => {
  if (EXPANDS.test(word) || /^~[^/]/.test(word)) {
    return null;
  }
  const expanded = word === "~" ? home : word.startsWith("~/") ? path.join(home, word.slice(2)) : word;
  if (path.isAbsolute(expanded)) {
    return path.resolve(expanded);
  }
  return cwd === null ? null : path.resolve(cwd, expanded);
};

function cdTarget(cwd, args, home) {
  const operand = args.find((arg) => !arg.startsWith("-") || arg === "-");
  if (operand === undefined) {
    return home;
  }
  return operand === "-" ? null : resolveIn(cwd, operand, home);
}

// --- git --------------------------------------------------------------------------

const GIT_VALUE_GLOBALS = new Set(["-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env"]);
const GUARDED_GIT = new Set(["reset", "checkout", "switch", "restore", "rebase", "merge", "clean", "push", "branch", "worktree", "stash"]);
const RESUMING = new Set(["--abort", "--continue", "--quit", "--skip", "--edit-todo", "--show-current-patch"]);

const BRANCH_CHANGE = {
  rule: "branch change in the primary checkout",
  destroys: "the branch the primary checkout is on, which other sessions work from",
  alternative: "`ai-flow worktree add --story <dir>` and work in that worktree",
  check: { kind: "primary" },
};

function discards(paths) {
  return {
    rule: "discarding uncommitted changes",
    destroys: "the uncommitted changes in the paths it restores",
    alternative: "`git stash push -u -m \"<why>\"` first, so they can come back",
    check: { kind: "dirty", paths },
  };
}

// `checkout -f` / `switch -f`: every uncommitted change in the repository goes.
const DISCARDS_ALL = { ...discards([":/"]), rule: "forced checkout" };

function readCheckout(rest, exists) {
  const options = optionsOf(rest);
  if (options.short.has("p") || options.long.has("patch") || options.long.has("help")) {
    return null;
  }
  const end = rest.indexOf("--");
  if (end !== -1) {
    const paths = rest.slice(end + 1);
    return paths.length ? discards(paths) : null;
  }
  const forced = options.has("f", "force") ? [DISCARDS_ALL] : [];
  if (rest.some((arg) => /^-[A-Za-z]*[bB]$/.test(arg)) || options.abbrev("orphan") || options.abbrev("detach")) {
    return [...forced, BRANCH_CHANGE];
  }
  const operands = operandsOf(rest, new Set(["-b", "-B", "--orphan", "--conflict"]));
  const paths = operands.filter((operand) => operand === "." || exists(operand));
  if (paths.length && (paths.length === operands.length || paths[0] !== operands[0])) {
    return discards(paths);
  }
  return operands.length ? [...forced, BRANCH_CHANGE] : forced;
}

function readRestore(rest) {
  const options = optionsOf(rest);
  const staged = options.short.has("S") || options.long.has("staged");
  const worktree = options.has("W", "worktree");
  if ((staged && !worktree) || options.short.has("p") || options.long.has("patch")) {
    return null;
  }
  const paths = operandsOf(rest, new Set(["-s", "--source"]));
  return paths.length ? discards(paths) : null;
}

const PUSH_VALUE_OPTIONS = new Set(["-o", "--push-option", "--repo", "--receive-pack", "--exec"]);

function readClean(rest) {
  const options = optionsOf(rest);
  if (!options.has("f", "force") || options.short.has("n") || options.long.has("dry-run")) {
    return null;
  }
  const what = options.has("X") ? "the ignored files (build output, local configuration)" : options.has("x") ? "untracked files, ignored ones included" : "untracked files";
  return {
    rule: "git clean",
    destroys: `${what}${options.has("d") ? " and directories" : ""} — never committed, so git cannot bring them back`,
    alternative: "`git clean -n` with the same flags to list them, then the human decides",
    check: { kind: "clean", flags: ["d", "x", "X"].filter((letter) => options.short.has(letter)), paths: operandsOf(rest, new Set(["-e", "--exclude"])) },
  };
}

function readGitSub(sub, rest, exists) {
  const options = optionsOf(rest);
  switch (sub) {
    case "reset":
      return options.abbrev("hard")
        ? {
            rule: "git reset --hard",
            destroys: "every uncommitted change to tracked files, and the commits it moves the branch away from",
            alternative: "`git stash push -u -m \"<why>\"` keeps the changes; the human resets",
            check: { kind: "changes" },
          }
        : null;
    case "checkout":
      return readCheckout(rest, exists);
    case "switch":
      if (options.long.has("help")) {
        return null;
      }
      return options.has("f", "force") || options.abbrev("discard-changes") ? [DISCARDS_ALL, BRANCH_CHANGE] : BRANCH_CHANGE;
    case "restore":
      return readRestore(rest);
    case "rebase":
    case "merge":
      return rest.some((arg) => RESUMING.has(arg)) || options.long.has("help") ? null : BRANCH_CHANGE;
    case "clean":
      return readClean(rest);
    case "push": {
      const forced = options.short.has("f") || ["force", "force-with-lease"].some((name) => options.abbrev(name));
      const plus = operandsOf(rest, PUSH_VALUE_OPTIONS).some((operand) => operand.startsWith("+"));
      return forced || plus
        ? { rule: "forced push", destroys: "the commits on the remote branch that yours does not have", alternative: ASK }
        : null;
    }
    case "branch":
      if (options.short.has("D") || (options.has("d", "delete") && options.has("f", "force"))) {
        return { rule: "forced branch delete", destroys: "the branch's commits that no other branch holds", alternative: "`git branch -d <name>`, which refuses an unmerged branch" };
      }
      // `branch -f main HEAD~3` moves an existing branch; `-M`/`-C` overwrite the one they name.
      return (options.has("f", "force") && operandsOf(rest).length > 0) || options.short.has("M") || options.short.has("C")
        ? { rule: "forced branch move", destroys: "the commits only the branch's old position held", alternative: "`git branch <new-name> <start>`, which refuses a branch that exists" }
        : null;
    case "worktree":
      return rest[0] === "remove" && optionsOf(rest.slice(1)).has("f", "force")
        ? { rule: "forced worktree removal", destroys: "the worktree's uncommitted and untracked files", alternative: "`git worktree remove <path>`, which refuses a worktree with changes" }
        : null;
    case "stash":
      return rest[0] === "drop" || rest[0] === "clear"
        ? { rule: `git stash ${rest[0]}`, destroys: "the stashed changes", alternative: "keep the stash (`git stash list` shows it); dropping it is the human's call" }
        : null;
    default:
      return null;
  }
}

// git's own commands: an alias never shadows one, so only another word is looked up.
const GIT_BUILTINS = new Set(["add", "am", "annotate", "apply", "archive", "bisect", "blame", "branch", "bundle", "cat-file", "check-ignore", "checkout", "checkout-index", "cherry", "cherry-pick", "clean", "clone", "commit", "commit-tree", "config", "count-objects", "describe", "diff", "diff-files", "diff-index", "diff-tree", "difftool", "fetch", "filter-branch", "for-each-ref", "format-patch", "fsck", "gc", "grep", "hash-object", "help", "init", "log", "ls-files", "ls-remote", "ls-tree", "maintenance", "merge", "merge-base", "mergetool", "mv", "notes", "prune", "pull", "push", "range-diff", "rebase", "reflog", "remote", "repack", "replace", "rerere", "reset", "restore", "rev-list", "rev-parse", "revert", "rm", "shortlog", "show", "show-branch", "show-ref", "sparse-checkout", "stash", "status", "submodule", "switch", "symbolic-ref", "tag", "update-index", "update-ref", "var", "verify-commit", "verify-tag", "version", "whatchanged", "worktree", "write-tree"]);
const MAX_ALIASES = 5;
const ALIAS_UNREAD = "a git alias the guard could not resolve";

// `git co`, `git rh`, `git nuke` with `alias.co=checkout`, `alias.rh=reset --hard`,
// `alias.nuke=!rm -rf build` in the config: the expansion is read in its place (a
// `!` value as a shell script). False when `sub` is no alias. A lookup that fails,
// a directory set by expansion, or a chain past ${MAX_ALIASES} is unchecked.
function readGitAlias(out, sub, rest, dir, ctx) {
  const depth = ctx.aliases || 0;
  const found = dir === null || depth >= MAX_ALIASES ? { issue: ALIAS_UNREAD } : ctx.host.gitAlias(dir, sub);
  if (found.issue) {
    out.unchecked.push({ reason: ALIAS_UNREAD, command: ["git", sub, ...rest].join(" ") });
    return true;
  }
  if (found.value === null || found.value === undefined) {
    return false;
  }
  const value = found.value.trim();
  const next = { ...ctx, aliases: depth + 1 };
  if (value.startsWith("!")) {
    // git runs it from the work tree's top; unknown, the directory is null.
    readScript(out, [value.slice(1), ...rest].join(" "), ctx.host.gitTop(dir), next);
  } else {
    readGit(out, [...tokenize(value), ...rest], dir, next);
  }
  return true;
}

function readGit(out, args, cwd, ctx) {
  let dir = cwd;
  let i = 0;
  while (i < args.length && args[i].startsWith("-")) {
    if (args[i] === "-c" && /^alias\./i.test(args[i + 1] || "")) {
      out.unchecked.push({ reason: CLI_ALIAS, command: ["git", ...args].join(" ") });
    }
    if (args[i] === "-C") {
      dir = args[i + 1] === undefined ? dir : resolveIn(dir, args[i + 1], ctx.home);
      i += 2;
    } else {
      i += GIT_VALUE_GLOBALS.has(args[i]) ? 2 : 1;
    }
  }
  const sub = args[i];
  if (sub === undefined) {
    return;
  }
  const rest = args.slice(i + 1);
  const words = ["git", sub, ...rest];
  if (!GIT_BUILTINS.has(sub) && !EXPANDS.test(sub) && readGitAlias(out, sub, rest, dir, ctx)) {
    return;
  }
  if (sub === "submodule" && rest.includes("foreach")) {
    // `git submodule foreach [--recursive] [-q] cmd…`: cmd runs in a shell in each
    // submodule. Only foreach's own leading options are skipped; the command keeps its flags.
    let at = rest.indexOf("foreach") + 1;
    while (["--recursive", "-q", "--quiet"].includes(rest[at])) {
      at += 1;
    }
    readScript(out, rest.slice(at).join(" "), null, ctx);
    return;
  }
  if (sub === "bisect" && rest[0] === "run" && rest[1] !== undefined) {
    const command = commandFromWords(rest.slice(1));
    if (command) {
      readCommand(out, command, dir, ctx);
    }
    return;
  }
  if (sub === "rm") {
    readRemoval(out, rest, dir);
  } else if (sub === "mv") {
    readMove(out, rest, dir);
  }
  if (EXPANDS.test(sub)) {
    out.unchecked.push({ reason: EXPANSION, command: words.join(" ") });
    return;
  }
  if (!GUARDED_GIT.has(sub)) {
    return;
  }
  const exists = (word) => {
    const at = resolveIn(dir, word, ctx.home);
    return at !== null && ctx.host.exists(at);
  };
  const found = [].concat(readGitSub(sub, rest, exists) || []);
  if (found.length) {
    found.forEach((entry) => add(out, entry, words, dir));
  } else if (rest.some((arg) => EXPANDS.test(arg))) {
    out.unchecked.push({ reason: EXPANSION, command: words.join(" ") });
  }
}

// --- the other tools ----------------------------------------------------------------

// Every path a remover is handed, recursive or not, what `mv` takes away, and
// what `cp`/`install`/`ln` overwrite (`cp /dev/null F` names no write the write
// reader keeps): the guard checks none is its own policy file.
const REMOVERS = new Set(["rm", "unlink", "trash", "shred"]);
const COPIERS = new Set(["cp", "install", "ln"]);

function readRemoval(out, words, cwd) {
  out.touched.push({ cwd, paths: operandsOf(words), mode: "remove" });
}

function targetDirectory(args) {
  const at = args.findIndex((arg) => arg === "-t" || arg === "--target-directory");
  if (at !== -1) {
    return args[at + 1];
  }
  const attached = args.find((arg) => arg.startsWith("--target-directory="));
  return attached ? attached.slice("--target-directory=".length) : null;
}

// Sources go away (`mv`), or are what a link points at (`ln`, mode "link"); the
// destination is overwritten. `-t DIR` names the directory.
function readMove(out, args, cwd, sourceMode = "remove") {
  const into = targetDirectory(args);
  const operands = operandsOf(args, new Set(["-S", "--suffix", "-t", "--target-directory", "-m", "--mode", "-o", "--owner", "-g", "--group"]));
  const sources = into === null ? operands.slice(0, -1) : operands;
  const written = into === null ? operands.slice(-1) : sources.map((source) => path.posix.join(into, path.posix.basename(source)));
  if (sourceMode) {
    out.touched.push({ cwd, paths: sources, mode: sourceMode });
  }
  out.touched.push({ cwd, paths: written, mode: "write" });
}

// `find START… [tests] -delete` or `-exec <remover>`: which starts, which name tests.
const FIND_TESTS = new Set(["-name", "-iname", "-path", "-ipath", "-wholename", "-iwholename", "-regex", "-iregex"]);

// Commands that never run, remove or overwrite the words they are handed.
// Each prints, searches or measures its words and runs none of them (plan.md D34).
// `rg --pre CMD` and `man -P CMD` run a program: then they are not inert.
const INERT = new Set(["echo", "printf", "grep", "egrep", "fgrep", "rg", "which", "whereis", "type", "man", "help", "cat", "head", "tail", "ls", "wc", "uniq", "cut", "stat", "file", "cmp", "md5sum", "sha1sum", "sha256sum", "test", "[", "true", "false", "basename", "dirname", "realpath", "readlink", "du", "jq"]);
const RUNS_A_PROGRAM = { rg: /^--pre(?:=|$)/, man: /^(?:-P|--pager|-H|--html)/ };
const isInert = ({ name, args }) => INERT.has(name) && !(RUNS_A_PROGRAM[name] && args.some((arg) => RUNS_A_PROGRAM[name].test(arg)));

// The commands `readCommand` reads: a later word naming one may be run by the
// command before it.
const READ_VERBS = new Set(["git", "rm", "unlink", "trash", "shred", "mv", "cp", "install", "ln", "prisma", "dropdb", "psql", "docker", "curl", "wget", "bash", "sh", "zsh", "dash", "ksh", "fish", "eval", "xargs", "find", "watch", "su", "script", "flock", "parallel", "npx", "bunx", "pnpx", "pnpm", "yarn"]);

// `-delete`, `-exec rm`/`mv` or a copy onto `{}` remove or overwrite what find
// matches. Any other command but an inert one may: `maybe`, which the guard
// makes unchecked rather than refused.
function readFindDeletion(out, args, cwd) {
  const at = args.findIndex((arg) => /^-(?:exec|execdir|ok|okdir)$/.test(arg));
  const end = args.findIndex((arg, i) => i > at && (arg === ";" || arg === "+"));
  const handed = at === -1 ? null : commandFromWords(args.slice(at + 1, end === -1 ? undefined : end));
  // A copy only touches the match when it is the destination: `cp /dev/null {}`, not `cp {} /backup`.
  const copiesOnto = handed !== null && COPIERS.has(handed.name);
  const ontoMatch = copiesOnto && operandsOf(handed.args).slice(-1).some((operand) => operand.includes("{}"));
  const deletes = args.includes("-delete") || (handed !== null && (REMOVERS.has(handed.name) || handed.name === "mv")) || ontoMatch;
  if (!deletes && (handed === null || isInert(handed) || copiesOnto)) {
    return;
  }
  const first = args.findIndex((arg) => /^[-(!]/.test(arg));
  const starts = (first === -1 ? args : args.slice(0, first)).filter(Boolean);
  const tests = [];
  args.forEach((arg, i) => {
    if (FIND_TESTS.has(arg) && args[i + 1] !== undefined) {
      tests.push({ test: arg.slice(1), pattern: args[i + 1] });
    }
  });
  out.touched.push({ cwd, find: { starts: starts.length ? starts : ["."], tests }, ...(deletes ? {} : { maybe: true }) });
}

function readRm(out, args, cwd, ctx) {
  readRemoval(out, args, cwd);
  const options = optionsOf(args);
  if (args.some((arg) => /^-[^-]/.test(arg) && EXPANDS.test(arg)) && !options.has("r", "recursive") && !options.short.has("R")) {
    out.unchecked.push({ reason: EXPANSION, command: ["rm", ...args].join(" ") });
    return;
  }
  if (!options.has("r", "recursive") && !options.short.has("R")) {
    return;
  }
  const operands = operandsOf(args);
  const named = operands.join(" ") || "<path>";
  add(out, {
    rule: "recursive rm",
    destroys: `${named} and everything under it, with no way back`,
    alternative: ctx.host.onPath("trash") ? `\`trash ${named}\` (recoverable from the system trash)` : `move it aside (\`mv <path> <path>.old\`) or ${ASK}`,
  }, ["rm", ...args], cwd);
}

const DATA_LOSS = { destroys: "the database's data", alternative: ASK };

function readPrisma(out, args, cwd) {
  const operands = operandsOf(args, new Set(["--schema"]));
  const options = optionsOf(args);
  const words = ["prisma", ...args];
  if (operands[0] === "migrate" && operands[1] === "reset") {
    add(out, { rule: "prisma migrate reset", ...DATA_LOSS }, words, cwd);
  } else if (operands[0] === "db" && operands[1] === "push" && (options.abbrev("force-reset") || options.abbrev("accept-data-loss"))) {
    add(out, { rule: "prisma db push with data loss", ...DATA_LOSS }, words, cwd);
  }
}

function readPsql(out, args, cwd) {
  const programs = [];
  args.forEach((arg, i) => {
    if (arg === "-c" || arg === "--command") {
      programs.push(args[i + 1] || "");
    } else if (arg.startsWith("--command=")) {
      programs.push(arg.slice("--command=".length));
    } else if (/^-c./.test(arg)) {
      programs.push(arg.slice(2));
    }
  });
  if (programs.some((program) => /\bdrop\s+database\b/i.test(program))) {
    add(out, { rule: "DROP DATABASE", ...DATA_LOSS }, ["psql", ...args], cwd);
  }
}

const DOCKER_VALUE_GLOBALS = new Set(["-H", "--host", "--context", "-c", "--config", "-l", "--log-level", "--tlscacert", "--tlscert", "--tlskey"]);

function readDocker(out, args, cwd) {
  const operands = operandsOf(args, DOCKER_VALUE_GLOBALS);
  const [sub, verb] = operands;
  if (sub === "system" && verb === "prune") {
    add(out, { rule: "docker system prune", destroys: "stopped containers, unused images and networks (and volumes with --volumes)", alternative: ASK }, ["docker", ...args], cwd);
  } else if (sub === "volume" && ["rm", "remove", "prune"].includes(verb)) {
    add(out, { rule: `docker volume ${verb}`, destroys: "the volumes' data", alternative: ASK }, ["docker", ...args], cwd);
  }
}

// --- a download run as a program ----------------------------------------------------

const DOWNLOADERS = new Set(["curl", "wget"]);
const STDIN_INTERPRETERS = /^(?:python[\d.]*|node|perl|ruby|php)$/;
const SUBSTITUTED_DOWNLOAD = /(?:\$\(|`)\s*(?:\S*\/)?(?:curl|wget)\b/;

// A shell or interpreter that reads its program from stdin: no script operand.
function readsStdin({ name, args }) {
  if (SHELLS.has(name)) {
    const end = args.findIndex((arg) => !arg.startsWith("-") || arg === "--");
    const options = end === -1 ? args : args.slice(0, end);
    return options.some((arg) => /^-[A-Za-z]*s[A-Za-z]*$/.test(arg)) || end === -1 || args[end] === "--";
  }
  return STDIN_INTERPRETERS.test(name) && args.every((arg) => arg.startsWith("-"));
}

const PIPED = {
  rule: "a download run as a program",
  destroys: "whatever the downloaded script does, unread",
  alternative: "download it to a file, read it, then run it",
};

function readDownload(out, command, cwd, segments, index) {
  const next = segments && segments[index + 1];
  if (next && next.before === "pipe" && readsStdin(commandOf(next))) {
    add(out, PIPED, [command.name, ...command.args], cwd);
    return;
  }
  // `bash <(curl …)`, `source <(curl …)`: the segment before opened the substitution.
  const previous = segments && segments[index - 1];
  if (previous && previous.after === "open" && /<\s*$/.test(previous.text)) {
    const reader = commandOf({ ...previous, text: previous.text.replace(/<\s*$/, "") });
    if (SHELLS.has(reader.name) || reader.name === "source" || reader.name === ".") {
      add(out, PIPED, [command.name, ...command.args], cwd);
    }
  }
}

// --- one command, then the line --------------------------------------------------------

// The command as the refusal shows it: a word with a space or a quote keeps its quotes
// (`psql -c 'DROP DATABASE mydb'`).
const quoted = (word) => (/[\s'"]/.test(word) ? `'${word.replace(/'/g, "'\\''")}'` : word);

function add(out, found, words, cwd) {
  out.findings.push({ ...found, words, command: words.map(quoted).join(" "), cwd });
}

const RUNNERS = new Set(["npx", "bunx", "pnpx"]);
const RUNNER_VALUE_OPTIONS = new Set(["-p", "--package", "-c", "--call"]);
// GNU xargs: `-i`, `-e`, `-l`, `--replace` and `--eof` take a value only when
// attached (`-i{}`, `--replace=X`), so the next word is the command. A long
// option is read by prefix (`--max-a 1`), as getopt does.
const XARGS_VALUE_OPTIONS = new Set(["-I", "-n", "-L", "-P", "-d", "-E", "-s", "-a"]);
const XARGS_LONG_VALUES = ["--max-args", "--max-lines", "--max-procs", "--delimiter", "--arg-file", "--max-chars", "--process-slot-var"];
const xargsValue = (arg) => XARGS_VALUE_OPTIONS.has(arg) || (/^--[^=]+$/.test(arg) && arg.length > 4 && XARGS_LONG_VALUES.some((name) => name.startsWith(arg)));

// GNU parallel: its options, then the command, then `:::` and the arguments it appends.
const PARALLEL_VALUE_OPTIONS = new Set(["-j", "--jobs", "-S", "--sshlogin", "-d", "--delimiter", "-a", "--arg-file", "-I", "-n", "--max-args", "-N", "-C", "--colsep", "--joblog", "--results", "--tmpdir", "--workdir", "--timeout", "--delay", "-E", "--env"]);
const PARALLEL_SOURCES = /^:{3,4}\+?$/;

// The program a package runner starts: `npx prisma …`, `pnpm exec prisma …`,
// `pnpm prisma …`, `yarn dlx prisma …`. Null when it starts none we read.
function runnerProgram(name, args) {
  let rest = args;
  if (name === "pnpm" || name === "yarn" || name === "npm") {
    if (["exec", "dlx", "x"].includes(rest[0])) {
      rest = rest.slice(1);
    } else if (name === "npm" || rest[0] !== "prisma") {
      return null;
    }
  } else if (!RUNNERS.has(name)) {
    return null;
  }
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "-c" || rest[i] === "--call") {
      return { script: rest[i + 1] === undefined ? "" : rest[i + 1] }; // `npx -c 'script'` runs it in a shell
    }
    if (rest[i].startsWith("--call=")) {
      return { script: rest[i].slice("--call=".length) };
    }
    if (RUNNER_VALUE_OPTIONS.has(rest[i])) {
      i += 1;
    } else if (rest[i] === "--") {
      continue;
    } else if (!rest[i].startsWith("-")) {
      return { name: path.basename(rest[i]).replace(/@.*$/, ""), raw: rest[i], args: rest.slice(i + 1) };
    }
  }
  return null;
}

// A command from its words, wrappers stepped over as for a segment
// (`xargs sudo rm`, `find -exec env rm`): `{ name, args }`, or null when no verb is left.
function commandFromWords(words) {
  let index = verbAt(words);
  if (path.basename(words[index] || "") === "busybox" && words[index + 1] && !words[index + 1].startsWith("-")) {
    index += 1;
  }
  return words[index] === undefined ? null : { name: path.basename(words[index]), raw: words[index], args: words.slice(index + 1) };
}

// The command `xargs` or `find -exec` runs, with the words it was given.
// `stdinOperands`: xargs (and parallel without `:::`) hands the command paths
// read from its input, which the reader never sees.
function forwarded({ name, args }) {
  if (name === "xargs") {
    for (let i = 0; i < args.length; i += 1) {
      if (xargsValue(args[i])) {
        i += 1;
      } else if (!args[i].startsWith("-")) {
        const command = commandFromWords(args.slice(i));
        return command && { ...command, stdinOperands: true };
      }
    }
    return null;
  }
  if (name === "parallel") {
    const sources = args.findIndex((arg) => PARALLEL_SOURCES.test(arg));
    const head = sources === -1 ? args : args.slice(0, sources);
    for (let i = 0; i < head.length; i += 1) {
      if (PARALLEL_VALUE_OPTIONS.has(head[i])) {
        i += 1;
      } else if (!head[i].startsWith("-")) {
        const command = commandFromWords(head.slice(i));
        const appended = sources === -1 ? [] : args.slice(sources + 1).filter((arg) => !PARALLEL_SOURCES.test(arg));
        return command && { ...command, args: [...command.args, ...appended], stdinOperands: sources === -1 };
      }
    }
    return null;
  }
  if (name === "find") {
    const at = args.findIndex((arg) => /^-(?:exec|execdir|ok|okdir)$/.test(arg));
    if (at === -1 || !args[at + 1]) {
      return null;
    }
    const end = args.findIndex((arg, i) => i > at && (arg === ";" || arg === "+"));
    return commandFromWords(args.slice(at + 1, end === -1 ? undefined : end));
  }
  return null;
}

// A program another command runs from one word: `watch 'rm -rf x'`, `su -c`,
// `script -c`. Null when it hands none on.
const WATCH_VALUE_OPTIONS = new Set(["-n", "--interval", "-q", "--equexit"]);

function handedScript({ name, args }) {
  if (name === "watch") {
    // Its own options lead; the rest is the command, run through `sh -c`.
    let i = 0;
    while (i < args.length && args[i].startsWith("-")) {
      i += WATCH_VALUE_OPTIONS.has(args[i]) ? 2 : 1;
    }
    return i < args.length ? args.slice(i).join(" ") : null;
  }
  if (name === "su" || name === "script" || name === "flock") {
    // `-c` may close a cluster: `script -qc`, `su -lc`.
    const at = args.findIndex((arg) => /^-[A-Za-z]*c$/.test(arg) || arg === "--command");
    if (at !== -1) {
      return args[at + 1] === undefined ? null : args[at + 1];
    }
    const attached = args.find((arg) => arg.startsWith("--command="));
    return attached ? attached.slice("--command=".length) : null;
  }
  return null;
}

// `env -S 'rm -rf x'` / `env --split-string=…`: env splits the string into the
// command it runs, which the verb reader has stepped over as an option value.
function splitString(tokens) {
  const env = tokens.indexOf("env");
  if (env === -1) {
    return null;
  }
  for (let i = env + 1; i < tokens.length; i += 1) {
    if (tokens[i] === "-S" || tokens[i] === "--split-string") {
      return tokens.slice(i + 1).join(" ") || null;
    }
    if (tokens[i].startsWith("--split-string=")) {
      return [tokens[i].slice("--split-string=".length), ...tokens.slice(i + 1)].join(" ");
    }
    if (!tokens[i].startsWith("-") && !tokens[i].includes("=")) {
      return null;
    }
  }
  return null;
}

function readScript(out, program, cwd, ctx) {
  if (SUBSTITUTED_DOWNLOAD.test(program)) {
    add(out, PIPED, program.split(/\s+/), cwd);
  }
  if (ctx.depth >= MAX_DEPTH) {
    // Not followed further: unchecked, never a silent allow.
    out.unchecked.push({ reason: TOO_DEEP, command: program });
    return;
  }
  const inner = readLine(program, cwd, { ...ctx, depth: ctx.depth + 1 });
  out.findings.push(...inner.findings);
  out.unchecked.push(...inner.unchecked);
  out.touched.push(...inner.touched);
  out.substituted.push(...inner.substituted);
}

function readCommand(out, command, cwd, ctx, segments = null, index = -1) {
  const { name, args } = command;
  if (!name) {
    return;
  }
  // A verb built by an expansion or a glob (`$X`, `rm$IFS-rf`, `/bin/r?`, `{rm,-rf,x}`)
  // is tested on the raw word, before `path.basename` can hide it.
  if (/[$`*?[{]/.test(command.raw || name) && !["[", "[[", "{"].includes(command.raw || name)) {
    out.unchecked.push({ reason: UNMODELLED, command: [command.raw || name, ...args].join(" ") });
    return;
  }
  const script = scriptOf(command);
  if (script !== null) {
    if (script) {
      readScript(out, script, cwd, ctx);
    }
    return;
  }
  if (name === "find") {
    readFindDeletion(out, args, cwd);
  }
  const handed = forwarded(command) || runnerProgram(name, args);
  if (handed && handed.script !== undefined) {
    readScript(out, handed.script, cwd, ctx);
    return;
  }
  if (handed) {
    readCommand(out, handed, cwd, ctx);
    return;
  }
  const gitTouches = name === "git" && args.some((arg) => ["rm", "mv", "checkout", "restore"].includes(arg));
  if (command.stdinOperands && (REMOVERS.has(name) || name === "mv" || COPIERS.has(name) || gitTouches)) {
    // The paths come from xargs' input: none of them is seen.
    out.touched.push({ cwd, unseen: true, command: [name, ...args].join(" ") });
  }
  readVerb(out, command, cwd, ctx, segments, index);
}

// The script a command runs in a shell (`eval`, `bash -c`, `trap 'cmd' EXIT`,
// `su -c`, `watch`…): "" for a shell handed none, null when it runs none.
function scriptOf(command) {
  const { name, args } = command;
  if (name === "eval") {
    return args.join(" ");
  }
  if (SHELLS.has(name)) {
    return shellProgram(args) ?? "";
  }
  if (name === "trap" && args[0] !== undefined && !/^-/.test(args[0])) {
    return args[0]; // runs later, in this shell
  }
  return handedScript(command);
}

// One verb the reader knows, read for what it destroys or touches.
function readVerb(out, command, cwd, ctx, segments, index) {
  const { name, args } = command;
  if (name === "git") {
    readGit(out, args, cwd, ctx);
  } else if (name === "rm") {
    readRm(out, args, cwd, ctx);
  } else if (REMOVERS.has(name)) {
    readRemoval(out, args, cwd);
  } else if (name === "mv") {
    readMove(out, args, cwd);
  } else if (COPIERS.has(name)) {
    readMove(out, args, cwd, name === "ln" ? "link" : null);
  } else if (name === "prisma") {
    readPrisma(out, args, cwd);
  } else if (name === "dropdb") {
    add(out, { rule: "dropdb", ...DATA_LOSS }, ["dropdb", ...args], cwd);
  } else if (name === "psql") {
    readPsql(out, args, cwd);
  } else if (name === "docker") {
    // `docker run IMAGE rm -rf /w`, `docker exec c …`: a command run in a container
    // whose volumes the guard cannot see is read as hidden when nothing else was found.
    const before = out.findings.length;
    readDocker(out, args, cwd);
    if (out.findings.length === before) {
      readHiddenVerb(out, args, cwd, ctx);
    }
  } else if (DOWNLOADERS.has(name)) {
    readDownload(out, command, cwd, segments, index);
  } else if (!isInert(command)) {
    readHiddenVerb(out, args, cwd, ctx);
  }
}

// A command the reader does not know may run the words it is handed
// (`firejail rm -rf x`, a wrapper not listed): read each word that names a
// command the reader knows as that command. What it finds is unchecked, never
// refused nor allowed; a path it touches is `maybe`.
function readHiddenVerb(out, args, cwd, ctx) {
  args.forEach((word, i) => {
    if (!READ_VERBS.has(path.basename(word)) || ctx.hidden) {
      return;
    }
    const inner = { findings: [], unchecked: [], touched: [], substituted: [] };
    readCommand(inner, { name: path.basename(word), args: args.slice(i + 1) }, cwd, { ...ctx, hidden: true });
    if (inner.findings.length || inner.unchecked.length) {
      out.unchecked.push({ reason: HIDDEN_VERB, command: args.slice(i).join(" ") });
    }
    out.touched.push(...inner.touched.map((entry) => ({ ...entry, maybe: true })));
  });
}

function readLine(line, start, ctx) {
  const out = { findings: [], unchecked: [], touched: [], substituted: [] };
  const joined = line.replace(/\\\n/g, "");
  const segments = splitSegments(joined);
  const stack = [];
  let cwd = start;
  segments.forEach((segment, index) => {
    const command = commandOf(segment);
    const piped = segment.before === "pipe" || segment.after === "pipe";
    if (command.name === "cd" || command.name === "pushd") {
      if (!piped) {
        cwd = cdTarget(cwd, command.args, ctx.home);
      }
    } else if (command.name === "popd") {
      cwd = null;
    } else {
      const tokens = tokenize(segment.text.trim());
      const raw = tokens[verbAt(tokens)];
      if (UNMODELLED_KEYWORDS.has(command.name)) {
        out.unchecked.push({ reason: `${UNMODELLED}: \`${command.name}\``, command: segment.text.trim() });
      }
      if (unmodelledBraces(tokens, command)) {
        out.unchecked.push({ reason: `${UNMODELLED}: brace expansion`, command: segment.text.trim() });
      }
      readCommand(out, { ...command, raw, args: wholeLastWord(command.args, segment, segments[index + 1]) }, cwd, ctx, segments, index);
      readHandedText(out, command, cwd, ctx);
      // `PAGER='rm -rf x' git log`, `env GIT_EDITOR=… git commit`: a variable set
      // for the command may be run by it, so its value is read as handed text.
      const assignments = tokens.slice(0, verbAt(tokens)).filter((token) => /^[A-Za-z_]\w*=/.test(token));
      if (assignments.length) {
        readHandedText(out, { name: "(assignment)", args: assignments }, cwd, ctx);
      }
      const split = splitString(tokens);
      if (split !== null) {
        readScript(out, split, cwd, ctx);
      }
    }
    if (segment.after === "open") {
      stack.push(cwd);
    } else if (segment.after === "close") {
      cwd = stack.length ? stack.pop() : cwd;
    }
  });
  readSubstitutions(out, joined, segments, start, ctx);
  const construct = unmodelledSyntax(joined);
  if (construct) {
    out.unchecked.push({ reason: `${UNMODELLED}: ${construct}`, command: joined });
  }
  return out;
}

// `rm -rf $(ls)`: the splitter ends the segment at `$(`, so the last word is `$`.
// It is named whole (`$(ls)`) when the substitution closes right after.
function wholeLastWord(args, segment, next) {
  const last = args[args.length - 1];
  if (segment.after !== "open" || last === undefined || !last.endsWith("$")) {
    return args;
  }
  const inner = next && next.after === "close" ? next.text.trim() : "…";
  return [...args.slice(0, -1), `${last}(${inner})`];
}

// --- backstop 1: only modelled syntax is allowed ---------------------------------------

const UNMODELLED_KEYWORDS = new Set(["case", "coproc", "select", "let"]);

// The line with every quoted part, substitution and heredoc body blanked
// (`outside`), and the text inside double quotes (`quoted`); `ansi` when it holds
// a `$'…'`. Null when a quote or substitution does not close.
function syntaxView(text) {
  const view = { outside: "", quoted: "", ansi: false };
  const pending = [];
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const put = (s) => (quote ? (view.quoted += s) : (view.outside += s));
    if (quote === "'") {
      quote = ch === "'" ? null : quote;
    } else if (ch === "\\") {
      put("_");
      i += 1;
    } else if (ch === "`" || (ch === "$" && text[i + 1] === "(" && text[i + 2] !== "(")) {
      i = ch === "`" ? closingBacktick(text, i + 1) : closingParen(text, i + 2);
      if (i === -1) {
        return null;
      }
      put(" ");
    } else if (quote === '"') {
      quote = ch === '"' ? null : quote;
      view.quoted += ch === '"' ? " " : ch;
    } else if (ch === "$" && text[i + 1] === "'") {
      view.ansi = true;
      i = ansiEnd(text, i + 2);
      if (i === -1) {
        return null;
      }
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      view.outside += " ";
    } else if (ch === "<" && text.startsWith("<<<", i)) {
      view.outside += "<<<";
      i += 2;
    } else if (ch === "<" && text[i + 1] === "<" && heredocAt(text, i)) {
      const heredoc = heredocAt(text, i);
      pending.push(heredoc);
      view.outside += "<<_";
      i += heredoc.length - 1;
    } else if (ch === "<" && text[i + 1] === "<" && /^<<-?[ \t]*[^\s]/.test(text.slice(i))) {
      return null; // a delimiter the reader cannot take whole
    } else if (ch === "\n" && pending.length) {
      i = pastBodies(text, i, pending);
      view.outside += "\n";
    } else if (ch === "#" && (i === 0 || /\s/.test(text[i - 1]))) {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end - 1;
    } else {
      view.outside += ch;
    }
  }
  return view;
}

// `{a,b}` / `{1..3}` turn one word into several. Modelled only in the operands of
// a command whose operands are paths the policy-file check matches as globs
// (`rm .coding-flow/{a,b}.json`), or of an inert one; anywhere else — the verb,
// an option (`rm -{r,f}`), a git path — it is unchecked.
const BRACE_EXPANSION = /\{[^{}\s]*(?:,|\.\.)[^{}\s]*\}/;
const PATH_OPERANDS = new Set([...REMOVERS, "mv", ...COPIERS, "mkdir", "touch"]);

function unmodelledBraces(tokens, command) {
  const verb = verbAt(tokens);
  return tokens.some((token, i) => BRACE_EXPANSION.test(token) && (i <= verb || token.startsWith("-") || !(PATH_OPERANDS.has(command.name) || isInert(command))));
}

// Arithmetic evaluates the variables it names, and a variable's text may hold
// `a[$(cmd)]`: only literal arithmetic is modelled.
const LITERAL_ARITHMETIC = /^[\d\s+\-*/%<>=!&|^~?:,.]*$/;

// What the reader understands is listed here; any other construct names itself.
const SYNTAX_CHECKS = [
  ["a here-string (`<<<`)", ({ outside }) => outside.includes("<<<")],
  ["an ANSI-C string (`$'…'`)", ({ ansi }) => ansi],
  ["`IFS`", ({ outside, quoted }) => /\$\{?IFS\b|(?:^|[\s;&|(])IFS=/.test(`${outside} ${quoted}`)],
  ["a tilde form (`~+`, `~-`, `~user`)", ({ outside }) => /(?:^|[\s=:;&|(])~[^\s/;&|)]/.test(outside)],
  ["an extended glob", ({ outside }) => /(?<![$<>])[@!+*?]\(/.test(outside)],
  ["arithmetic on variables", ({ outside, quoted }) => [...`${outside} ${quoted}`.matchAll(/\(\(([\s\S]*?)\)\)/g)].some((match) => !LITERAL_ARITHMETIC.test(match[1])) || /\[\[[^\]]*\s-(?:eq|ne|lt|le|gt|ge)\s/.test(outside)],
  ["alias expansion", ({ outside }) => /\bexpand_aliases\b/.test(outside)],
];

function unmodelledSyntax(line) {
  const view = syntaxView(line);
  if (view === null) {
    return "a quote, a substitution or a heredoc delimiter that does not close";
  }
  const found = SYNTAX_CHECKS.find(([, test]) => test(view));
  return found ? found[0] : null;
}

// --- backstop 2: destructive text handed to a command ----------------------------------

// Option values that are only text: a commit or tag message, a search, a PR body.
const TEXT_OPTIONS = {
  git: new Set(["-m", "--message", "-F", "--file", "--grep", "--format", "--pretty", "-S", "-G", "--author", "--committer"]),
  gh: new Set(["-b", "--body", "-t", "--title", "-n", "--notes", "-m", "--message"]),
};
// The policy file, or the directory holding it named whole (not `.coding-flow/runs`).
const POLICY_TEXT = /harness\.json|\.coding-flow[\\/]?(?![\\/\w.-])/i;

// The words a command is handed, minus the values of its text options.
function handedWords({ name, args }) {
  const text = TEXT_OPTIONS[name];
  if (!text) {
    return args;
  }
  return args.filter((arg, i) => !text.has(args[i - 1]) && ![...text].some((option) => option.startsWith("--") && arg.startsWith(`${option}=`)));
}

// A word the reader would read as a destructive command, handed to a command
// that is not inert (`ssh host 'git reset --hard'`), or a path to the policy
// file handed to one the reader does not read (`node -e "…harness.json…"`):
// unchecked. The word may be text; the guard cannot tell.
function readHandedText(out, command, cwd, ctx) {
  if (ctx.handed || ctx.hidden || isInert(command)) {
    return;
  }
  const unread = !READ_VERBS.has(command.name);
  for (const word of handedWords(command)) {
    const inner = { findings: [], unchecked: [], touched: [], substituted: [] };
    // `make CLEAN='git clean -fdx'`: the value of an assignment is read too.
    for (const text of new Set([word, word.replace(/^[\w.-]+=/, "")])) {
      if (/\s/.test(text)) {
        readScript(inner, text, cwd, { ...ctx, handed: true });
      }
    }
    if (inner.findings.length || (unread && POLICY_TEXT.test(word))) {
      out.unchecked.push({ reason: HANDED_TEXT, command: [command.name, ...command.args].join(" ") });
      return;
    }
  }
}

// --- command substitutions ---------------------------------------------------------

// `<<WORD` at `i`: `{ dash, word, literal, length }`, read as the splitter reads it.
function heredocAt(text, i) {
  return heredocWord(text.slice(i));
}

// From the newline at `at`, past the bodies of the heredocs opened on that line.
// `onBody(text)` gets each body that expands. Returns the index of the last newline read.
function pastBodies(text, at, pending, onBody = null) {
  let i = at;
  while (pending.length) {
    const { dash, word, literal } = pending.shift();
    const from = i + 1;
    let found = false;
    while (!found && i < text.length) {
      const next = text.indexOf("\n", i + 1);
      const stop = next === -1 ? text.length : next;
      const line = text.slice(i + 1, stop);
      found = (dash ? line.replace(/^\t+/, "") : line) === word;
      if (onBody && !literal && !found) {
        onBody(line);
      }
      i = stop;
    }
  }
  return i;
}

// The index of the `'` closing an ANSI-C string `$'…'` (where `\'` is a quote), or -1.
function ansiEnd(text, from) {
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === "\\") {
      i += 1;
    } else if (text[i] === "'") {
      return i;
    }
  }
  return -1;
}

// `bash -c [-e] [+x] [-o opt] [--] 'script'`: the first word after the `-c` cluster
// that is not an option.
function shellProgram(args) {
  const flag = args.findIndex((arg) => /^-[A-Za-z]*c[A-Za-z]*$/.test(arg));
  for (let i = flag === -1 ? args.length : flag + 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--" || arg === "-") {
      return args[i + 1];
    }
    if (/^[-+][A-Za-z]*[oO]$/.test(arg)) {
      i += 1;
    } else if (!/^[-+][A-Za-z]+$/.test(arg)) {
      return arg;
    }
  }
  return undefined;
}

// The index of the backtick closing the one before `from`, or -1.
function closingBacktick(text, from) {
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === "\\") {
      i += 1;
    } else if (text[i] === "`") {
      return i;
    }
  }
  return -1;
}

// The index of the `)` closing the `$(` before `from`, or -1: quotes, nested
// substitutions, comments and heredoc bodies skipped.
function closingParen(text, from) {
  let depth = 0;
  let quote = null;
  const pending = [];
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    if (quote === "'") {
      quote = ch === "'" ? null : quote;
    } else if (ch === "\\") {
      i += 1;
    } else if (ch === "`") {
      i = closingBacktick(text, i + 1);
      if (i === -1) {
        return -1;
      }
    } else if (ch === "$" && text[i + 1] === "(") {
      i = closingParen(text, i + 2);
      if (i === -1) {
        return -1;
      }
    } else if (quote === '"') {
      quote = ch === '"' ? null : quote;
    } else if (ch === "$" && text[i + 1] === "'") {
      i = ansiEnd(text, i + 2);
      if (i === -1) {
        return -1;
      }
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === "<" && text[i + 1] === "<" && text[i + 2] === "<") {
      i += 2; // a here-string, not a heredoc
    } else if (ch === "<" && text[i + 1] === "<" && heredocAt(text, i)) {
      const heredoc = heredocAt(text, i);
      pending.push(heredoc);
      i += heredoc.length - 1;
    } else if (ch === "\n" && pending.length) {
      i = pastBodies(text, i, pending);
    } else if (ch === "#" && (i === from || /\s/.test(text[i - 1]))) {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end - 1;
    } else if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      if (depth === 0) {
        return i;
      }
      depth -= 1;
    }
  }
  return -1;
}

// Every substitution in `text`, as scripts (an unquoted one too: the segment
// splitter reads it, and reading it again puts it under the backstops); null
// when one does not close. `expanding`: `text` is a heredoc body, where
// quotes are text and every `$(` runs.
function substitutionsOf(text, expanding = false) {
  const scripts = [];
  const pending = [];
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote === "'") {
      quote = ch === "'" ? null : quote;
      continue;
    }
    if (ch === "\\") {
      i += 1;
    } else if (ch === "`") {
      const end = closingBacktick(text, i + 1);
      if (end === -1) {
        return null;
      }
      scripts.push(text.slice(i + 1, end).replace(/\\([`$\\])/g, "$1"));
      i = end;
    } else if (ch === "$" && text[i + 1] === "(" && text[i + 2] !== "(") {
      const end = closingParen(text, i + 2);
      if (end === -1) {
        return null;
      }
      scripts.push(text.slice(i + 2, end));
      i = end;
    } else if (expanding) {
      continue;
    } else if (quote === null && ch === "$" && text[i + 1] === "'") {
      i = ansiEnd(text, i + 2);
      if (i === -1) {
        return null;
      }
    } else if (ch === '"') {
      quote = quote ? null : '"';
    } else if (ch === "'" && quote === null) {
      quote = "'";
    } else if (quote === null && ch === "<" && text[i + 1] === "<" && text[i + 2] === "<") {
      i += 2; // a here-string, not a heredoc
    } else if (quote === null && ch === "<" && text[i + 1] === "<" && heredocAt(text, i)) {
      const heredoc = heredocAt(text, i);
      pending.push(heredoc);
      i += heredoc.length - 1;
    } else if (quote === null && ch === "\n" && pending.length) {
      let broken = false;
      i = pastBodies(text, i, pending, (body) => {
        const inner = substitutionsOf(body, true);
        broken = broken || inner === null;
        scripts.push(...(inner || []));
      });
      if (broken) {
        return null;
      }
    }
  }
  return scripts;
}

// The scripts the segment splitter does not see: `$(…)` inside double quotes,
// every backtick, and those in an unquoted heredoc body. Each is read as a
// script, in the line's directory — unknown (null) once the line changes it.
// One that does not close is unchecked.
function readSubstitutions(out, line, segments, start, ctx) {
  const scripts = substitutionsOf(line);
  if (scripts === null) {
    out.unchecked.push({ reason: UNREAD_SUBSTITUTION, command: line });
    return;
  }
  const moves = segments.some((segment) => ["cd", "pushd", "popd"].includes(commandOf(segment).name));
  const cwd = moves ? null : start;
  for (const script of scripts) {
    out.substituted.push({ script, cwd });
    readScript(out, script, cwd, ctx);
  }
}

// `host`: `exists(absolutePath)`, `home()`, `onPath(program)` — each falls back
// rather than throwing. A finding whose `check` needs a directory and has none
// (`cd "$D" && git checkout -- .`) carries `cwd: null`; the guard makes it unchecked.
function readDestructive(command, { cwd, host }) {
  if (typeof command !== "string" || !command.trim()) {
    return { findings: [], unchecked: [], touched: [], substituted: [] };
  }
  const safeHost = { exists: () => false, home: () => cwd, onPath: () => false, gitAlias: () => ({ value: null }), gitTop: () => null, ...host };
  return readLine(command, path.resolve(cwd), { host: safeHost, home: safeHost.home(), depth: 0 });
}

module.exports = { readDestructive, substitutionsOf, UNKNOWN_CWD, EXPANSION, TOO_DEEP, CLI_ALIAS, HIDDEN_VERB, UNREAD_SUBSTITUTION, UNMODELLED, HANDED_TEXT };
