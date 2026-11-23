"use strict";

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
const { splitSegments, commandOf, verbAt, tokenize, SHELLS } = require("./shell-writes");

const EXPANDS = /[$`]/;
const ASK = "stop and ask the human";
const MAX_DEPTH = 4;

const EXPANSION = "a destructive-command check depends on shell expansion";
const UNKNOWN_CWD = "a destructive-command check depends on a working directory set by shell expansion";
const TOO_DEEP = `a destructive-command check stops at ${MAX_DEPTH} nested scripts`;
const CLI_ALIAS = "git runs an alias defined on its own command line";

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
  if (EXPANDS.test(word)) {
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
      return options.short.has("D") || (options.has("d", "delete") && options.has("f", "force"))
        ? { rule: "forced branch delete", destroys: "the branch's commits that no other branch holds", alternative: "`git branch -d <name>`, which refuses an unmerged branch" }
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

// Sources go away; the destination is overwritten. `-t DIR` names the directory.
function readMove(out, args, cwd, sourcesGo = true) {
  const into = targetDirectory(args);
  const operands = operandsOf(args, new Set(["-S", "--suffix", "-t", "--target-directory", "-m", "--mode", "-o", "--owner", "-g", "--group"]));
  const sources = into === null ? operands.slice(0, -1) : operands;
  const written = into === null ? operands.slice(-1) : sources.map((source) => path.posix.join(into, path.posix.basename(source)));
  if (sourcesGo) {
    out.touched.push({ cwd, paths: sources, mode: "remove" });
  }
  out.touched.push({ cwd, paths: written, mode: "write" });
}

// `find START… [tests] -delete` or `-exec <remover>`: which starts, which name tests.
const FIND_TESTS = new Set(["-name", "-iname", "-path", "-ipath", "-wholename", "-iwholename", "-regex", "-iregex"]);

function readFindDeletion(out, args, cwd) {
  const at = args.findIndex((arg) => /^-(?:exec|execdir|ok|okdir)$/.test(arg));
  const handed = at === -1 ? null : commandFromWords(args.slice(at + 1));
  const deletes = args.includes("-delete") || (handed !== null && (REMOVERS.has(handed.name) || handed.name === "mv"));
  if (!deletes) {
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
  out.touched.push({ cwd, find: { starts: starts.length ? starts : ["."], tests } });
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

function add(out, found, words, cwd) {
  out.findings.push({ ...found, words, command: words.join(" "), cwd });
}

const RUNNERS = new Set(["npx", "bunx", "pnpx"]);
const RUNNER_VALUE_OPTIONS = new Set(["-p", "--package", "-c", "--call"]);
const XARGS_VALUE_OPTIONS = new Set(["-I", "-i", "-n", "-L", "-l", "-P", "-d", "-E", "-e", "-s", "-a"]);

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
    if (RUNNER_VALUE_OPTIONS.has(rest[i])) {
      i += 1;
    } else if (rest[i] === "--") {
      continue;
    } else if (!rest[i].startsWith("-")) {
      return { name: path.basename(rest[i]).replace(/@.*$/, ""), args: rest.slice(i + 1) };
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
  return words[index] === undefined ? null : { name: path.basename(words[index]), args: words.slice(index + 1) };
}

// The command `xargs` or `find -exec` runs, with the words it was given.
function forwarded({ name, args }) {
  if (name === "xargs") {
    for (let i = 0; i < args.length; i += 1) {
      if (XARGS_VALUE_OPTIONS.has(args[i])) {
        i += 1;
      } else if (!args[i].startsWith("-")) {
        return commandFromWords(args.slice(i));
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
  if (name === "su" || name === "script") {
    const at = args.findIndex((arg) => arg === "-c" || arg === "--command");
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
}

function readCommand(out, command, cwd, ctx, segments = null, index = -1) {
  const { name, args } = command;
  if (!name || EXPANDS.test(name)) {
    return; // a substituted verb is already unchecked by the write reader
  }
  if (name === "eval") {
    readScript(out, args.join(" "), cwd, ctx);
    return;
  }
  if (SHELLS.has(name)) {
    const flag = args.findIndex((arg) => /^-[A-Za-z]*c[A-Za-z]*$/.test(arg));
    // `bash -c -- 'script'`: `--` ends the options, the script follows it.
    const program = flag === -1 ? undefined : args[flag + 1] === "--" ? args[flag + 2] : args[flag + 1];
    if (program !== undefined) {
      readScript(out, program, cwd, ctx);
    }
    return;
  }
  const script = handedScript(command);
  if (script !== null) {
    readScript(out, script, cwd, ctx);
    return;
  }
  if (name === "find") {
    readFindDeletion(out, args, cwd);
  }
  const handed = forwarded(command) || runnerProgram(name, args);
  if (handed) {
    readCommand(out, handed, cwd, ctx);
    return;
  }
  if (name === "git") {
    readGit(out, args, cwd, ctx);
  } else if (name === "rm") {
    readRm(out, args, cwd, ctx);
  } else if (REMOVERS.has(name)) {
    readRemoval(out, args, cwd);
  } else if (name === "mv") {
    readMove(out, args, cwd);
  } else if (COPIERS.has(name)) {
    readMove(out, args, cwd, false);
  } else if (name === "prisma") {
    readPrisma(out, args, cwd);
  } else if (name === "dropdb") {
    add(out, { rule: "dropdb", ...DATA_LOSS }, ["dropdb", ...args], cwd);
  } else if (name === "psql") {
    readPsql(out, args, cwd);
  } else if (name === "docker") {
    readDocker(out, args, cwd);
  } else if (DOWNLOADERS.has(name)) {
    readDownload(out, command, cwd, segments, index);
  }
}

function readLine(line, start, ctx) {
  const out = { findings: [], unchecked: [], touched: [] };
  const segments = splitSegments(line.replace(/\\\n/g, ""));
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
      readCommand(out, command, cwd, ctx, segments, index);
      const split = splitString(tokenize(segment.text.trim()));
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
  return out;
}

// `host`: `exists(absolutePath)`, `home()`, `onPath(program)` — each falls back
// rather than throwing. A finding whose `check` needs a directory and has none
// (`cd "$D" && git checkout -- .`) carries `cwd: null`; the guard makes it unchecked.
function readDestructive(command, { cwd, host }) {
  if (typeof command !== "string" || !command.trim()) {
    return { findings: [], unchecked: [], touched: [] };
  }
  const safeHost = { exists: () => false, home: () => cwd, onPath: () => false, ...host };
  return readLine(command, path.resolve(cwd), { host: safeHost, home: safeHost.home(), depth: 0 });
}

module.exports = { readDestructive, UNKNOWN_CWD, EXPANSION, TOO_DEEP, CLI_ALIAS };
