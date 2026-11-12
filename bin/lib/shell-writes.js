"use strict";

// What a shell command would WRITE, read from its text: string in, targets out.
// Conservative: a target it fails to recognise is simply not checked
// (fail-open), never guessed at. Policy and path resolution stay in `guard.js`.
//
// The questions that need the disk — the real directory a `cd` reaches, whether
// a copy's destination is a directory, where a link's directory really is — and
// `$HOME` are asked of a `host` the caller hands in, so this module reads
// nothing but its arguments.
//
// One section per form, in the order a segment is read:
//   words · segments · targets · redirections · the verb · cd/pushd/popd ·
//   in-place editors · copy/move/link destinations · downloads · git ·
//   scripts followed · interpreters

const path = require("node:path");

// --- words --------------------------------------------------------------------

function unquote(token) {
  if (token.length >= 2) {
    const first = token[0];
    const last = token[token.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return token.slice(1, -1);
    }
  }
  return token;
}

function tokenize(segment) {
  const tokens = [];
  // A word is quoted parts and bare characters glued together (`.e""nv`, `'.en'v`); a
  // double-quoted part may hold escaped quotes (`"echo \"x\" > .env"`).
  const pattern = /(?:"(?:\\[\s\S]|[^"\\])*"|'[^']*'|\S)+/g;
  let match;

  while ((match = pattern.exec(segment)) !== null) {
    tokens.push(reduceWord(match[0]));
  }

  return tokens;
}

// Quote and backslash removal the shell does inside one word: `.e""nv`, `.e\nv`
// and `'.en'v` all name `.env`. A lone quote that pairs with nothing stays as is.
function reduceWord(token) {
  return token.replace(/"((?:\\[\s\S]|[^"\\])*)"|'([^']*)'/g, (_, double, single) => (double !== undefined ? double.replace(/\\([\s\S])/g, "$1") : single)).replace(/\\([^\n])/g, "$1");
}

const HOME_PREFIX = /^(?:\$HOME|\$\{HOME\})(?=\/|$)/;

// "skip": not a file (flags, fd duplications, the null sink). "unknown": a variable
// or a substitution decides the path, which no static read can resolve. Else "path".
function classify(token) {
  if (!token || token.startsWith("-") || token.startsWith("&")) {
    return "skip";
  }

  if (token === "/dev/null" || token.startsWith("/dev/")) {
    return "skip";
  }

  // An unquoted glob or brace list (`.e*`, `.en{v,}`) names files only the shell can list.
  if (/^~[^/]/.test(token) || token.includes("`") || /[*?[{]/.test(token.replace(HOME_PREFIX, "")) || token.replace(HOME_PREFIX, "").includes("$")) {
    return "unknown";
  }

  return "path";
}

function expandHome(target, home) {
  if (target === "~" || target.startsWith("~/")) {
    return path.join(home, target.slice(1));
  }
  const match = HOME_PREFIX.exec(target);
  return match ? path.join(home, target.slice(match[0].length)) : target;
}

// util's `normalizePortable`, repeated so this module needs no other.
const portable = (file) => file.split(path.sep).join("/").replace(/^\.\//, "");

const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const EXPANSION = "write target depends on shell expansion";
const UNKNOWN_CWD = "the working directory depends on shell expansion";
const PATHSPEC_FILE = "git reads its paths from a file";
const HEREDOC_PROGRAM = "an interpreter reads its program from a heredoc";
const PIPED_PROGRAM = "an interpreter reads its program from a pipe";
const SUBSTITUTED_PROGRAM = "an interpreter reads its program from a process substitution";
// A command too dynamic to read is a limit of reading shell text, met in everyday
// use (`> "$out"`, `node <<EOF`): `report` counts it, `doctor` does not warn on it.
// Every other unchecked reason means the guard itself could not do its job.
const SHELL_LIMITS = new Set([EXPANSION, UNKNOWN_CWD, PATHSPEC_FILE, HEREDOC_PROGRAM, PIPED_PROGRAM, SUBSTITUTED_PROGRAM]);
const isShellLimit = (reason) => SHELL_LIMITS.has(reason);

// --- segments -----------------------------------------------------------------

// Splits a command into segments at `&&`, `||`, `;`, `|`, `&`, newline and
// parentheses, never inside quotes and never inside a heredoc body. Each segment
// says which separator came `before` and `after` it, and whether it closes or
// opens a group: `after: "open"` / `"close"` apply once the segment's own text has
// run (the text before a `(` is outside the group, the text before a `)` inside it).
function splitSegments(command) {
  const out = [];
  const heredocs = [];
  let text = "";
  let quote = null;
  let before = null;

  const flush = (after) => {
    out.push({ text, before, after });
    before = after;
    text = "";
  };

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];

    if (quote) {
      text += ch;
      if (ch === quote) {
        quote = null;
      } else if (ch === "\\" && quote === '"' && i + 1 < command.length) {
        text += command[(i += 1)];
      }
      continue;
    }

    if (ch === "\\" && i + 1 < command.length) {
      text += ch + command[(i += 1)];
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      text += ch;
    } else if (ch === "<" && command[i + 1] === "<" && command[i + 2] !== "<") {
      const word = /^<<(-?)\s*(?:"([^"]*)"|'([^']*)'|\\?([^\s;&|<>()]+))/.exec(command.slice(i));
      if (word) {
        heredocs.push({ dash: word[1] === "-", word: word[2] ?? word[3] ?? word[4] });
      }
      text += "<<";
      i += 1;
    } else if (ch === "\n") {
      flush("seq");
      // Heredoc bodies are data: up to the delimiter line, none of it is a command.
      while (heredocs.length) {
        const { dash, word } = heredocs.shift();
        let end = command.indexOf("\n", i + 1);
        while (i + 1 < command.length) {
          const stop = end === -1 ? command.length : end;
          const line = command.slice(i + 1, stop);
          i = stop;
          end = command.indexOf("\n", i + 1);
          if ((dash ? line.replace(/^\t+/, "") : line) === word) {
            break;
          }
        }
      }
    } else if (ch === "(") {
      flush("open");
    } else if (ch === ")") {
      flush("close");
    } else if (ch === ";") {
      flush("seq");
    } else if (ch === "|" && command[i - 1] === ">") {
      text += ch; // `>|` clobber is a redirection, not a pipe
    } else if ((ch === "&" || ch === "|") && command[i + 1] === ch) {
      i += 1;
      flush(ch === "&" ? "and" : "or");
    } else if (ch === "|" && command[i + 1] === "&") {
      i += 1;
      flush("pipe"); // `|&` pipes stderr too: still a pipe, not a background job
    } else if (ch === "|") {
      flush("pipe");
    } else if (ch === "&" && command[i - 1] !== ">" && command[i - 1] !== "<" && command[i + 1] !== ">") {
      flush("bg");
    } else {
      text += ch;
    }
  }

  out.push({ text, before, after: null });
  return out;
}

// --- targets ------------------------------------------------------------------
//
// One read of one command: what it found so far, and the directory a relative
// word lands in — null once a `cd` went somewhere no static read can follow.

function reader(startCwd, host) {
  // The shell resolves `..` physically once a `cd` went through a symlink, so every
  // directory it tracks is the real one when it exists (a missing one stays lexical).
  const start = host.realpath(path.resolve(startCwd));
  return { host, startCwd, start, cwd: start, found: [], seen: new Set(), stack: [] };
}

const homeOf = (r, target) => expandHome(target, r.host.home());

function add(r, word, kind) {
  const token = reduceWord(word);
  const state = classify(token);
  if (state === "skip") {
    return;
  }

  let entry;
  if (state === "unknown") {
    entry = { target: token, kind, unchecked: EXPANSION };
  } else if (r.cwd === null && !path.isAbsolute(homeOf(r, token))) {
    entry = { target: token, kind, unchecked: UNKNOWN_CWD };
  } else if (r.cwd === null || r.cwd === r.start || path.isAbsolute(homeOf(r, token))) {
    entry = { target: token, kind };
  } else {
    entry = { target: portable(path.relative(r.start, path.resolve(r.cwd, token))), kind };
  }

  const key = `${entry.kind}\0${entry.target}\0${entry.unchecked || ""}`;
  if (!r.seen.has(key)) {
    r.seen.add(key);
    r.found.push(entry);
  }
}

// --- redirections -------------------------------------------------------------

// Redirections: `> file`, `>> file`, `2> file`. `2>&1` and `>&2` duplicate a
// descriptor and write to no path — the (?!&) drops them.
// Spaces around the operator are optional (`echo a>.env`), and `>|` (clobber) and
// `&>` (both streams) write too; `>&file` is a write, `>&2` and `2>&1` are not.
// The target is one shell word: quoted parts and bare characters glued together (`'.e'nv`).
const TARGET = `((?:"(?:\\\\[\\s\\S]|[^"\\\\])*"|'[^']*'|[^\\s;&|<>()"'])+)`;
const REDIRECTIONS = [
  new RegExp(`(?<![<>&\\d])\\d?(?:&>>?|>>|>\\|?)(?!&)\\s*${TARGET}`, "gd"),
  new RegExp(`(?<![<>&\\d])\\d?>&\\s*(?![\\d-])${TARGET}`, "gd"),
];

function readRedirections(r, text) {
  // An operator inside quotes is text: scan a copy whose quoted contents are blanked out
  // (same offsets), and read the target from the original.
  const masked = text.replace(/"(?:\\[\s\S]|[^"\\])*"|'[^']*'/g, (quoted) => quoted[0] + "_".repeat(quoted.length - 2) + quoted[quoted.length - 1]);
  for (const redirection of REDIRECTIONS) {
    for (const match of masked.matchAll(redirection)) {
      add(r, text.slice(...match.indices[1]), "write");
    }
  }
}

// --- the verb -----------------------------------------------------------------

// Wrappers and compound-command keywords that sit in front of the real verb.
const WRAPPERS = new Set(["sudo", "doas", "env", "time", "builtin", "command", "nohup", "exec", "nice", "timeout", "then", "do", "else", "elif", "if", "while", "until", "!", "{"]);
const WRAPPER_VALUE_OPTIONS = {
  sudo: new Set(["-u", "-g", "-h", "-p", "-C", "-T", "-r", "-t", "-U", "-D"]),
  doas: new Set(["-u", "-C"]),
  env: new Set(["-u", "-C", "-S"]),
  nice: new Set(["-n"]),
  timeout: new Set(["-s", "-k"]),
};

// `sudo cp …`, `env FOO=1 tee …`, `time cd x`: step over the wrapper to the verb.
// An option that takes a value (`sudo -u root`, `nice -n 5`) steps over its value too,
// and `timeout` over its duration, or the value would be read as the verb.
function verbAt(tokens) {
  let index = 0;
  let wrapper = null;
  while (index < tokens.length) {
    const token = tokens[index];
    if (WRAPPERS.has(token)) {
      wrapper = token;
      index += 1;
    } else if (token.includes("=")) {
      index += 1;
    } else if (index > 0 && token.startsWith("-")) {
      index += WRAPPER_VALUE_OPTIONS[wrapper]?.has(token) ? 2 : 1;
    } else if (wrapper === "timeout" && /^\d/.test(token)) {
      index += 1;
      wrapper = null;
    } else {
      break;
    }
  }
  return index;
}

// One segment's verb and the words it is handed. `< input` and `<<EOF` read;
// their operand is not a file the command writes.
function commandOf(segment) {
  const tokens = tokenize(segment.text.trim());
  const index = verbAt(tokens);
  const args = tokens.slice(index + 1);
  const operands = args.filter((arg, i) => !/^<{1,3}$/.test(arg) && !/^<{1,3}$/.test(args[i - 1] || "") && !arg.startsWith("<"));
  const files = operands.filter((arg) => classify(arg) !== "skip");
  return { segment, empty: tokens.length === 0, name: path.basename(tokens[index] || ""), args, operands, files };
}

// --- cd / pushd / popd --------------------------------------------------------

// Moves the read to where the cd goes. Returns the directory it left, for
// `cd a || X` — null when nothing moved (a cd inside a pipeline runs in a subshell).
function readCd(r, { segment, args }) {
  const inPipeline = segment.before === "pipe" || segment.after === "pipe" || segment.after === "bg";
  const dir = args.find((arg) => !arg.startsWith("-") || arg === "-");
  const target = dir === undefined || dir === "~" ? r.host.home() : dir === "-" || classify(dir) === "unknown" ? null : homeOf(r, dir);

  if (inPipeline) {
    return null;
  }
  const left = { cwd: r.cwd };
  r.cwd = target === null || (r.cwd === null && !path.isAbsolute(target)) ? null : r.host.realpath(path.resolve(r.cwd || "/", target));
  return left;
}

// --- in-place editors ---------------------------------------------------------

// The files `sed -i` edits. The script is the first operand only when no
// `-e`/`-f`/`--expression`/`--file` gave it (`sed -i -es/a/b/ .env` edits .env).
// In a short cluster, `i` takes the rest as its backup suffix (`-ie` is suffix "e").
function sedFiles(args) {
  const operands = [];
  let script = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") {
      operands.push(...args.slice(i + 1));
      break;
    } else if (/^--(expression|file)=/.test(arg)) {
      script = true;
    } else if (arg === "--expression" || arg === "--file" || arg === "--line-length") {
      script = script || arg !== "--line-length";
      i += 1;
    } else if (arg.startsWith("--")) {
      continue;
    } else if (arg.startsWith("-") && arg.length > 1) {
      // `-e`, `-f`, `-l` take a value: the rest of the cluster, else the next word.
      for (let at = 1; at < arg.length; at += 1) {
        if (arg[at] === "i") {
          break;
        }
        if ("efl".includes(arg[at])) {
          script = script || arg[at] !== "l";
          i += at === arg.length - 1 ? 1 : 0;
          break;
        }
      }
    } else {
      operands.push(arg);
    }
  }
  return (script ? operands : operands.slice(1)).filter((arg) => classify(arg) !== "skip");
}

// The files an in-place editor rewrites, or null when the verb is not one (a
// `sed` without `-i` only prints).
function editedFiles({ name, args, operands, files }) {
  if (name === "tee" || name === "sponge" || name === "ed" || name === "ex" || name === "patch") {
    // ed/ex/patch FILE edit the named file in place (patch with no FILE reads the diff's own paths: not read).
    return files;
  }
  if (name === "sed" && args.some((arg) => arg === "--in-place" || arg.startsWith("--in-place=") || /^-[A-Za-z]*i/.test(arg))) {
    return sedFiles(operands);
  }
  if (name === "perl" && args.some((arg) => /^-[A-Za-z]*i/.test(arg))) {
    // perl -pi -e '<script>' <files…> edits in place; the script is the word after -e.
    const e = args.findIndex((arg) => /^-[A-Za-z]*e$/.test(arg));
    return args.slice(e === -1 ? 0 : e + 2);
  }
  if (name === "awk" && args.includes("-i") && args.includes("inplace")) {
    // awk -i inplace '<program>' <files…>
    return files.filter((arg) => arg !== "inplace").slice(1);
  }
  if (name === "truncate") {
    // truncate -s N <files…>: the size (or reference file) is an option value, not a target.
    const skip = args.findIndex((arg) => arg === "-s" || arg === "-r" || arg === "--size" || arg === "--reference");
    return files.filter((arg) => skip === -1 || arg !== args[skip + 1]);
  }
  return null;
}

// --- copy, move and link destinations -----------------------------------------

// Commands whose last non-flag argument is the destination.
const DESTINATION_LAST = new Set(["cp", "mv", "ln", "install", "rsync"]);

// `cp -t DIR src…` / `--target-directory=DIR`: DIR is the destination, not a source.
// `-t` may end a cluster (`cp -rt DIR`, `install -Dt DIR`) or carry the value (`-tDIR`).
function destinationOf(r, { name, operands, files }) {
  const optionAt = operands.findIndex((arg) => /^-[A-Za-z]*t/.test(arg) || arg === "--target-directory" || arg.startsWith("--target-directory="));
  let directory = null;
  let sources = files;
  if (optionAt !== -1) {
    const option = operands[optionAt];
    const glued = option.match(/^-[A-Za-z]*t(.+)$/);
    directory = option.startsWith("--target-directory=") ? option.slice(option.indexOf("=") + 1) : glued ? glued[1] : operands[optionAt + 1];
    sources = files.filter((arg) => arg !== directory);
    if (directory !== undefined) {
      add(r, directory, "write");
    }
  } else if (files.length >= 2) {
    directory = files[files.length - 1];
    sources = files.slice(0, -1);
    add(r, directory, "write");
  } else if (name === "ln" && classify(files[0]) === "path") {
    // `ln SRC` (one operand) makes `./<name of SRC>` here: `ln -sf /tmp/x/.env` replaces .env.
    const link = path.posix.basename(homeOf(r, files[0]));
    if (link !== "." && link !== "..") {
      add(r, link, "write");
    }
  }
  return { optionAt, directory, sources };
}

// A directory destination receives `DIR/<name of each source>`: that is the file
// written. Returns whether the destination was read as a directory.
function intoDirectory(r, { optionAt, directory, sources }) {
  if (typeof directory !== "string" || classify(directory) !== "path") {
    return false;
  }
  const base = r.cwd === null ? null : path.resolve(r.cwd, homeOf(r, directory));
  // a missing destination is a file name
  const isDirectory = /(?:^|\/)\.{0,2}\/?$/.test(directory) || optionAt !== -1 || (base !== null && r.host.isDirectory(base));
  if (isDirectory) {
    for (const source of sources) {
      const name = path.posix.basename(source);
      if (classify(source) === "path" && name !== "." && name !== ".." && !source.endsWith("/")) {
        add(r, path.posix.join(directory, name), "write");
      }
    }
  }
  return isDirectory;
}

// The link lands in DIR itself when the destination is a directory
// (`ln -s SRC dir/`, `ln -s -t dir SRC`), else next to the name it is given.
// A destination that does not exist yet may be made earlier in the same command
// (`mkdir -p x/y && ln -s ../../.env x/y`), so without `-T` both are tried.
function linkAliases(r, { args, files }, { optionAt, directory, sources }, isDirectory) {
  const noTarget = args.some((arg) => /^-[A-Za-z]*T/.test(arg) || arg === "--no-target-directory");
  const wheres = [...new Set([
    ...(isDirectory || (typeof directory === "string" && !noTarget) ? [directory] : []),
    files.length >= 2 && optionAt === -1 ? path.dirname(files[files.length - 1]) : ".",
  ])];
  for (const source of sources) {
    add(r, source, "alias");
    if (classify(source) !== "path" || path.isAbsolute(homeOf(r, source))) {
      continue;
    }
    // A relative symlink source is read from the link's own directory — its
    // real one: under `a -> sub/deep`, `ln -s ../../.env a/x` aliases <root>/.env.
    for (const where of wheres) {
      if (where === "." || where === "./") {
        continue;
      }
      // add() reads shell words, where a backslash is an escape: a path built
      // here goes in with forward slashes, or Windows' `D:\a\.env` loses them.
      add(r, path.posix.join(where, source), "alias");
      if (r.cwd !== null && classify(reduceWord(where)) === "path") {
        const linkDir = r.host.realPathOf(path.resolve(r.cwd, homeOf(r, reduceWord(where))));
        add(r, portable(path.resolve(linkDir, reduceWord(source))), "alias");
      }
    }
  }
}

function readCopy(r, command) {
  const symbolic = command.args.some((arg) => /^-[A-Za-z]*[sl]/.test(arg) || arg === "--symbolic" || arg === "--link" || arg === "--symbolic-link");
  const destination = destinationOf(r, command);
  const isDirectory = intoDirectory(r, destination);
  if (command.name === "ln" || (command.name === "cp" && symbolic)) {
    linkAliases(r, command, destination, isDirectory);
  }
}

// --- downloads ----------------------------------------------------------------

// curl -o FILE / --output FILE; wget -O FILE / --output-document / -o logfile; dd of=FILE.
function downloadFiles({ name, args, operands }) {
  if (name === "dd") {
    return args.filter((arg) => arg.startsWith("of=")).map((arg) => arg.slice(3));
  }
  const options = name === "curl" ? /^(?:-[A-Za-z]*o|--output)$/ : /^(?:-[A-Za-z]*[oO]|--output-document|--output-file)$/;
  const out = [];
  operands.forEach((arg, i) => {
    const long = arg.match(/^--(?:output|output-document|output-file)=(.*)$/);
    if (long) {
      out.push(long[1]);
    } else if (options.test(arg) && operands[i + 1] !== undefined) {
      out.push(operands[i + 1]);
    }
  });
  return out;
}

// --- git ----------------------------------------------------------------------

// `git checkout <tree> [--] <paths>` and `git restore <paths>` overwrite working
// files. `dir` is `git -C <dir>`; `fromFile` is a pathspec the guard cannot read.
// A lone `git checkout <x>` is read as a path too: a branch literally named like a
// blocked file is not worth a hole.
function gitPaths(args) {
  let index = 0;
  let dir = null;
  while (index < args.length && args[index].startsWith("-")) {
    if (args[index] === "-C") {
      dir = args[index + 1];
    }
    index += args[index] === "-C" || args[index] === "-c" ? 2 : 1;
  }

  const sub = args[index];
  const rest = args.slice(index + 1);
  const result = { dir, paths: [], fromFile: rest.some((arg) => arg.startsWith("--pathspec-from-file")) };

  if (sub === "checkout") {
    const dashes = rest.indexOf("--");
    result.paths = dashes === -1 ? rest.filter((arg) => !arg.startsWith("-")) : rest.slice(dashes + 1);
  } else if (sub === "restore") {
    if (rest.some((arg) => arg === "--staged" || arg === "-S") && !rest.some((arg) => arg === "--worktree" || arg === "-W")) {
      return result;
    }
    for (let i = 0; i < rest.length; i += 1) {
      if (rest[i] === "--source" || rest[i] === "-s") {
        i += 1;
      } else if (rest[i] === "--") {
        result.paths.push(...rest.slice(i + 1));
        break;
      } else if (!rest[i].startsWith("-")) {
        result.paths.push(rest[i]);
      }
    }
  }

  return result;
}

function readGit(r, { args }) {
  const git = gitPaths(args);
  const saved = r.cwd;

  if (git.dir !== null) {
    r.cwd = classify(git.dir) === "unknown" || (r.cwd === null && !path.isAbsolute(git.dir)) ? null : r.host.realpath(path.resolve(r.cwd || "/", homeOf(r, git.dir)));
  }
  git.paths.forEach((file) => add(r, file, "write"));
  if (git.fromFile) {
    r.found.push({ target: "(pathspec file)", kind: "write", unchecked: PATHSPEC_FILE });
  }
  r.cwd = saved;
}

// --- scripts followed ---------------------------------------------------------

// A script handed to `bash -c` / `eval` runs from the current directory. With the
// directory unknown, only its absolute targets can still be judged; a relative one is unchecked.
function followScript(r, program) {
  for (const entry of shellWrites(unquote(program), r.cwd === null ? r.startCwd : r.cwd, r.host)) {
    if (entry.unchecked) {
      r.found.push(entry);
    } else if (r.cwd === null && !path.isAbsolute(homeOf(r, entry.target))) {
      r.found.push({ target: entry.target, kind: entry.kind, unchecked: UNKNOWN_CWD });
    } else {
      add(r, entry.target, entry.kind);
    }
  }
}

// `eval …`, or `bash -c "<script>"`: the script is a command of its own, read from
// this directory. Returns false when the verb hands no script on.
function readScript(r, { name, args }) {
  if (name === "eval") {
    followScript(r, args.join(" "));
    return true;
  }
  const flag = SHELLS.has(name) ? args.findIndex((arg) => /^-[A-Za-z]*c$/.test(arg)) : -1;
  if (flag === -1) {
    return false;
  }
  if (args[flag + 1] !== undefined) {
    followScript(r, args[flag + 1]);
  }
  return true;
}

// --- interpreters -------------------------------------------------------------

// The inline program an interpreter was handed, in its flag spellings: `-c code`,
// `-Bc code`, `-pe code`, `--eval code`, `--eval=code`, `perl -E code`, `deno eval [options] code`.
const INTERPRETERS = [
  [/^python[\d.]*$/, /^-[A-Za-z]*c$/],
  [/^(node|nodejs|bun)$/, /^(-e|-p|-pe|--eval|--print)$/],
  [/^perl$/, /^-[A-Za-z\d]*[eE]$/],
  [/^ruby$/, /^-[A-Za-z]*e$/],
  [/^deno$/, /^eval$/],
];

function inlineCode(name, args) {
  const programs = [];
  for (const [pattern, flag] of INTERPRETERS) {
    if (!pattern.test(name)) {
      continue;
    }
    args.forEach((arg, at) => {
      if (name === "deno" && flag.test(arg)) {
        // `deno eval --ext=ts code`: options may come first, so every word that is not one is read.
        programs.push(...args.slice(at + 1).filter((word) => !word.startsWith("-")));
      } else if (flag.test(arg) && args[at + 1] !== undefined) {
        programs.push(args[at + 1]);
      } else if (/^--(eval|print)=/.test(arg)) {
        programs.push(unquote(arg.slice(arg.indexOf("=") + 1)));
      }
    });
  }
  return programs;
}

// String literals of an inline program. Not a parser: a literal that spells a
// blocked path is the whole signal, and a built-up one (`'.e'+'nv'`) is a documented limit.
function stringLiterals(code) {
  const found = [];
  for (const match of code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
    const value = match[2];
    if (value && value.length <= 200 && !/[\n\0]/.test(value)) {
      found.push(value);
    }
  }
  return found;
}

function readInline(r, programs) {
  programs.forEach((program) =>
    stringLiterals(program).forEach((literal) => {
      // A bare open() mode (`'w'`, `'rb'`) is not a path.
      if (!/^[rwabx+]{1,3}$/.test(literal)) {
        add(r, literal, "inline");
      }
      // A 2-argument `open(F, ">.env")` carries its mode in the literal.
      const bare = literal.replace(/^\+?[<>]{1,2}\s*/, "");
      if (bare !== literal) {
        add(r, bare, "inline");
      }
    }),
  );
}

// A program read from a heredoc / here-string, piped in (`cat <<EOF | bash`,
// `curl … | sh`) or from a process substitution (`bash <(curl …)`) is data to
// the splitter: it cannot be judged. `sh -s ARGS` reads stdin whatever follows
// its options (`curl … | bash -s -- --yes`).
function readStdinProgram(r, { segment, name, args }) {
  const interpreter = INTERPRETERS.some(([pattern]) => pattern.test(name)) || SHELLS.has(name);
  const firstOperand = args.findIndex((arg) => !arg.startsWith("-") || arg === "--");
  const options = firstOperand === -1 ? args : args.slice(0, firstOperand);
  const stdinFlag = SHELLS.has(name) && options.some((arg) => /^-[A-Za-z]*s[A-Za-z]*$/.test(arg));
  if (interpreter && segment.after === "open" && /<\s*$/.test(segment.text)) {
    r.found.push({ target: `(${name} program)`, kind: "write", unchecked: SUBSTITUTED_PROGRAM });
  } else if (interpreter && (stdinFlag || args.every((arg) => arg.startsWith("-") || arg.startsWith("<")))) {
    if (segment.text.includes("<<")) {
      r.found.push({ target: `(${name} program)`, kind: "write", unchecked: HEREDOC_PROGRAM });
    } else if (segment.before === "pipe") {
      r.found.push({ target: `(${name} program)`, kind: "write", unchecked: PIPED_PROGRAM });
    }
  }
}

// --- one segment, then the whole command --------------------------------------

// What one segment's verb writes. Returns the directory a `cd` left, else null.
function readVerb(r, command) {
  const { name } = command;
  if (command.empty) {
    return null;
  }
  if (name === "cd" || name === "pushd") {
    return readCd(r, command);
  }
  if (name === "popd") {
    r.cwd = null;
    return null;
  }

  const edited = editedFiles(command);
  if (edited !== null) {
    edited.forEach((file) => add(r, file, "write"));
  } else if (DESTINATION_LAST.has(name) && command.files.length >= 1) {
    readCopy(r, command);
  } else if (name === "curl" || name === "wget" || name === "dd") {
    downloadFiles(command).forEach((file) => add(r, file, "write"));
  } else if (name === "git") {
    readGit(r, command);
  } else if (!readScript(r, command)) {
    const programs = inlineCode(name, command.args);
    readInline(r, programs);
    if (programs.length === 0) {
      readStdinProgram(r, command);
    }
  }
  return null;
}

// What a command would write, in order: `[{ target, kind, unchecked? }]`. `target`
// is relative to `startCwd` (or `~`/absolute), already resolved against any `cd`
// earlier in the command. `kind`: "write" | "alias" (a link whose source is the
// target) | "inline" (a literal in inline code). `unchecked` carries the reason a
// target cannot be resolved. Conservative: a shape we do not recognise is not guessed at.
//
// `host` answers the disk questions, each falling back rather than throwing:
// `realpath(dir)` (the dir itself when missing), `isDirectory(file)`,
// `realPathOf(file)` (through links, for a file that may not exist yet), `home()`.
function shellWrites(command, startCwd, host) {
  if (typeof command !== "string" || !command.trim()) {
    return [];
  }

  // The shell drops a backslash-newline continuation before it reads any word.
  command = command.replace(/\\\n/g, "");

  const r = reader(startCwd, host);
  let left = null;

  for (const segment of splitSegments(command)) {
    // `cd a || X`: X only runs when the cd failed, so it sees the old directory.
    // What follows X (`cd a || exit; …`) only runs when the cd worked, so it goes on
    // from the directory the cd reached.
    let resume = null;
    if (segment.before === "or" && left !== null) {
      resume = { cwd: r.cwd };
      r.cwd = left.cwd;
    }

    readRedirections(r, segment.text);
    left = readVerb(r, commandOf(segment));

    if (resume !== null) {
      r.cwd = resume.cwd;
    }

    if (segment.after === "open") {
      r.stack.push(r.cwd);
    } else if (segment.after === "close") {
      r.cwd = r.stack.length ? r.stack.pop() : r.cwd;
    }
  }

  return r.found;
}

module.exports = { shellWrites, splitSegments, tokenize, expandHome, isShellLimit, SHELLS };
