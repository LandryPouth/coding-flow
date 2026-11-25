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
//   in-place editors · copy/move/link destinations · archives · downloads ·
//   git · patches · commands handed their paths · scripts followed · interpreters

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
// One pass, left to right: a backslash the double quotes kept (`"a \\" b"` →
// `a \" b`) is text, not an escape to strip a second time.
function reduceWord(token) {
  return token.replace(/"((?:\\[\s\S]|[^"\\])*)"|'([^']*)'|\\([^\n])/g, (_, double, single, escaped) => {
    if (double !== undefined) {
      return double.replace(/\\([\s\S])/g, "$1");
    }
    return single !== undefined ? single : escaped;
  });
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

function expandHome(target, home, platform = process.platform) {
  if (target === "~" || target.startsWith("~/")) {
    return path.join(home, target.slice(1));
  }
  const match = HOME_PREFIX.exec(target);
  return match ? path.join(home, target.slice(match[0].length)) : nativeShellPath(target, platform);
}

// The path a shell word names, in the platform's own form. On Windows the agent's
// shell is Git Bash (MSYS), which hands a native program `/c/Users/x` as
// `C:/Users/x` (and `/cygdrive/c/…` likewise): read here as `/c/Users/x`, it would
// resolve to `<current drive>:\c\Users\x` — a directory that does not exist — and
// a write or a branch switch aimed at the checkout would be judged elsewhere.
// Anywhere else a word is a path as written.
const MSYS_DRIVE = /^\/(?:cygdrive\/)?([A-Za-z])(?=\/|$)/;

function nativeShellPath(word, platform = process.platform) {
  if (platform !== "win32" || typeof word !== "string") {
    return word;
  }
  const match = MSYS_DRIVE.exec(word);
  // `/c` alone is the drive's root, not `C:` (the current directory on drive C).
  return match ? `${match[1].toUpperCase()}:${word.slice(match[0].length) || "/"}` : word;
}

// util's `normalizePortable`, repeated so this module needs no other.
const portable = (file) => file.split(path.sep).join("/").replace(/^\.\//, "");

const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "fish"]);
const EXPANSION = "write target depends on shell expansion";
const UNKNOWN_CWD = "the working directory depends on shell expansion";
const PATHSPEC_FILE = "git reads its paths from a file";
const HEREDOC_PROGRAM = "an interpreter reads its program from a heredoc";
const PIPED_PROGRAM = "an interpreter reads its program from a pipe";
const SUBSTITUTED_PROGRAM = "an interpreter reads its program from a process substitution";
// A command too dynamic to read is a limit of reading shell text, met in everyday
// use (`> "$out"`, `node <<EOF`): `report` counts it, `doctor` does not warn on it.
// Every other unchecked reason means the guard itself could not do its job.
// An archive, a patch the guard cannot open, a stash: what they write is inside
// them, not in the command line (story 13-09).
const ARCHIVE = "an archive is extracted here and its contents cannot be read";
const UNREAD_PATCH = "a patch is applied that the guard cannot read";
const STASH = "git restores a stash the guard cannot read";
const SHIFTED_PATCH = "a patch's paths are shifted by an option the guard does not model";
const FORWARDED = "a write command runs on paths another command hands it";
const UNREAD_TREE = "a tree is copied onto the project from a source the guard cannot read";
const PATHSPEC_MAGIC = "git reads a pathspec magic the guard does not model";
const REMOTE_SHELL = "rsync runs a remote shell the guard cannot read";
const SUBSTITUTED_VERB = "the command itself depends on shell expansion";
const GIT_INDEX = "git writes the work tree from its index, the guard cannot read which files";
const SFTP_SESSION = "sftp runs a session whose commands the guard cannot read";
const SHELL_LIMITS = new Set([EXPANSION, UNKNOWN_CWD, PATHSPEC_FILE, HEREDOC_PROGRAM, PIPED_PROGRAM, SUBSTITUTED_PROGRAM, ARCHIVE, UNREAD_PATCH, STASH, SHIFTED_PATCH, FORWARDED, UNREAD_TREE, PATHSPEC_MAGIC, SUBSTITUTED_VERB, REMOTE_SHELL, GIT_INDEX, SFTP_SESSION]);
const isShellLimit = (reason) => SHELL_LIMITS.has(reason);

// --- segments -----------------------------------------------------------------

// Splits a command into segments at `&&`, `||`, `;`, `|`, `&`, newline and
// parentheses, never inside quotes and never inside a heredoc body. Each segment
// says which separator came `before` and `after` it, and whether it closes or
// opens a group: `after: "open"` / `"close"` apply once the segment's own text has
// run (the text before a `(` is outside the group, the text before a `)` inside it).
// Heredoc bodies are data: up to the delimiter line, none of it is a command.
// From the newline at `i`, the index of the last newline of the bodies opened.
function pastHeredocBodies(command, i, heredocs) {
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
  return i;
}

// `<<WORD` at the start of `text`: the delimiter is one shell word, its parts
// joined and unquoted (`E"OF"`, `'E'OF`, `E\\OF` are all `EOF`); the body is
// `literal` (expands nothing) when any part is quoted or escaped. Null when it is
// not a heredoc or a part does not close (`<<E"OF`).
const HEREDOC_WORD = /^<<(-?)[ \t]*((?:"[^"]*"|'[^']*'|\\[^\n]|[^\s;&|<>()`'"\\])+)/;

function heredocWord(text) {
  const match = HEREDOC_WORD.exec(text);
  if (!match || /^["'\\]/.test(text.slice(match[0].length))) {
    return null;
  }
  const raw = match[2];
  const word = raw.replace(/"([^"]*)"|'([^']*)'|\\([^\n])/g, (_, double, single, escaped) => double ?? single ?? escaped);
  return { dash: match[1] === "-", word, literal: /["'\\]/.test(raw), length: match[0].length };
}

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
    } else if (ch === "$" && command[i + 1] === "'") {
      // An ANSI-C string, `$'it\'s'`: `\'` is a quote inside it, not its end.
      let end = i + 2;
      while (end < command.length && command[end] !== "'") {
        end += command[end] === "\\" ? 2 : 1;
      }
      text += command.slice(i, end + 1);
      i = end;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      text += ch;
    } else if (ch === "<" && command.startsWith("<<<", i)) {
      text += "<<<"; // a here-string, not a heredoc
      i += 2;
    } else if (ch === "<" && command[i + 1] === "<") {
      const heredoc = heredocWord(command.slice(i));
      if (heredoc) {
        heredocs.push(heredoc);
      }
      text += "<<";
      i += 1;
    } else if (ch === "\n") {
      flush("seq");
      i = pastHeredocBodies(command, i, heredocs);
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

function reader(startCwd, host, options = {}) {
  // The shell resolves `..` physically once a `cd` went through a symlink, so every
  // directory it tracks is the real one when it exists (a missing one stays lexical).
  const start = host.realpath(path.resolve(startCwd));
  return { host, startCwd, start, cwd: start, found: [], seen: new Set(), stack: [], trees: Boolean(options.trees), segments: options.after || 0, acted: options.after || 0, substitutes: Boolean(options.substitutes), platform: options.platform || process.platform };
}

const homeOf = (r, target) => expandHome(target, r.host.home(), r.platform);

function add(r, word, kind, extra = {}) {
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

  // A move whose source is already read as a write (`mv a ./` lands on itself) is
  // judged as that write.
  const written = kind === "move" && r.found.some((other) => other.kind === "write" && other.target === entry.target);
  const key = `${entry.kind}\0${entry.target}\0${entry.unchecked || ""}`;
  if (!written && !r.seen.has(key)) {
    r.seen.add(key);
    r.found.push(Object.assign(entry, extra));
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
const WRAPPERS = new Set(["sudo", "doas", "env", "time", "builtin", "command", "nohup", "exec", "nice", "timeout", "stdbuf", "ionice", "chroot", "setsid", "unbuffer", "flock", "taskset", "then", "do", "else", "elif", "if", "while", "until", "!", "{"]);
const WRAPPER_VALUE_OPTIONS = {
  sudo: new Set(["-u", "-g", "-h", "-p", "-C", "-T", "-r", "-t", "-U", "-D", "--user", "--group", "--host", "--prompt", "--close-from", "--chdir", "--role", "--type", "--other-user", "--command-timeout"]),
  doas: new Set(["-u", "-C"]),
  env: new Set(["-u", "-C", "-S", "--unset", "--chdir"]),
  nice: new Set(["-n", "--adjustment"]),
  timeout: new Set(["-s", "-k", "--signal", "--kill-after"]),
  stdbuf: new Set(["-i", "-o", "-e", "--input", "--output", "--error"]),
  ionice: new Set(["-c", "-n", "-p", "-P", "-u", "--class", "--classdata", "--pid", "--pgid", "--uid"]),
  chroot: new Set(["--userspec", "--groups"]),
  flock: new Set(["-w", "--timeout", "--wait", "-E", "--conflict-exit-code"]),
};

// Wrappers whose first operand is not the verb: `chroot DIR`, `flock FILE`, `taskset MASK`.
const LEADING_OPERAND = new Set(["chroot", "flock", "taskset"]);

// `sudo -iu root`: a cluster of short options whose last one takes the value.
function takesValue(wrapper, token) {
  const options = WRAPPER_VALUE_OPTIONS[wrapper];
  return Boolean(options && (options.has(token) || (/^-[A-Za-z]{2,}$/.test(token) && options.has(`-${token.slice(-1)}`))));
}

// `sudo cp …`, `env FOO=1 tee …`, `time cd x`: step over the wrapper to the verb.
// An option that takes a value (`sudo -u root`, `nice -n 5`) steps over its value too,
// and `timeout` over its duration, or the value would be read as the verb.
function verbAt(tokens) {
  let index = 0;
  let wrapper = null;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === "flock" && tokens.slice(index).some((word) => word === "-c" || word === "--command" || word.startsWith("--command="))) {
      break; // `flock FILE -c 'script'` hands a script on: flock is the verb
    } else if (WRAPPERS.has(token)) {
      wrapper = token;
      index += 1;
    } else if (token.includes("=")) {
      index += 1;
    } else if (index > 0 && token.startsWith("-")) {
      index += takesValue(wrapper, token) ? 2 : 1;
    } else if ((wrapper === "timeout" && /^\d/.test(token)) || LEADING_OPERAND.has(wrapper)) {
      // `timeout 5 …` steps over its duration, `chroot DIR …` over its new root.
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
  let index = verbAt(tokens);
  // `busybox cp …` runs the applet it names.
  if (path.basename(tokens[index] || "") === "busybox" && tokens[index + 1] && !tokens[index + 1].startsWith("-")) {
    index += 1;
  }
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
  // `mv X /tmp/x` takes X away: the first half of a swap (story 13-09).
  if (command.name === "mv") {
    destination.sources.forEach((source) => add(r, source, "move"));
  }
  // `cp -r X{.bak,}` is two words once the shell expands it: which one is the
  // destination is not in the text.
  command.files.filter((file) => /\{[^}]*,[^}]*\}/.test(file)).forEach((file) => add(r, file, "write"));
  copiedTrees(r, command, destination, isDirectory);
}

// A recursive copy, a move or a link writes a whole tree where it lands: DIR/<name>
// when DIR is an existing directory, DIR when the source's contents are copied
// (`X/.`, rsync's `X/`, a glob) — and DIR itself in every case but `-t DIR`, `.` and
// `..`: an earlier `rm -rf`/`trash` in the same command may have emptied the name,
// and `mv X dst/` onto a missing `dst/` creates dst.
const REMOTE_WORD = /^(?:[^/]*:|rsync:\/\/)/;
// On Windows `C:/x` and `C:\x` are a drive for cp, mv and ln, and for a
// destination (read as local, a word flags more, never less). An rsync or scp
// *source* `C:/x` stays remote: MSYS and Cygwin builds read it as host `C`, so
// judging the local `C:/x` would allow what an ssh alias `C` may serve.
// `C:x` (no slash) stays remote everywhere: unread, which fails safe.
const LOCAL_COPIERS = new Set(["cp", "mv", "ln"]);
const isRemote = (word, platform = process.platform) => REMOTE_WORD.test(word) && !(platform === "win32" && /^[A-Za-z]:[\\/]/.test(word));

function copiedTrees(r, { name, tool = name, args }, { optionAt, directory, sources }, isDirectory) {
  const symbolic = name === "cp" && args.some((arg) => /^-[A-Za-z]*[sl]/.test(arg) || arg === "--symbolic-link" || arg === "--link");
  const recursive = name === "rsync" || name === "mv" || name === "ln" || symbolic || (name === "cp" && args.some((arg) => /^-[A-Za-z]*[rRa]/.test(arg) || arg === "--recursive" || arg === "--archive"));
  if (!r.trees || !recursive || typeof directory !== "string") {
    return;
  }
  const itself = optionAt === -1 && !/(?:^|\/)\.{1,2}\/?$/.test(directory);
  const noTarget = args.some((arg) => /^-[A-Za-z]*T/.test(arg) || arg === "--no-target-directory");
  // `rsync -e X`: X runs as the "remote" end, local or not. Pushed to a remote
  // destination, nothing lands here.
  if (name === "rsync" && !isRemote(directory, r.platform) && args.some((arg) => /^-[a-zA-Z]*e/.test(arg) || arg.startsWith("--rsh"))) {
    r.found.push({ target: directory, kind: "tree", unchecked: REMOTE_SHELL });
  }
  for (const source of sources) {
    const from = treeSource(r, source, tool);
    if (!isDirectory || noTarget || itself) {
      add(r, directory, "tree", from);
    }
    if (isDirectory && !noTarget) {
      const base = path.posix.basename(source);
      const contents = base === "." || (name === "rsync" && source.endsWith("/")) || classify(source) !== "path";
      add(r, contents ? directory : path.posix.join(directory, base), "tree", contents ? from : {});
    }
  }
}

// What a tree's source is, for the guard to judge a landing on the project root:
// `source` (resolved), `chained` when something else ran first — an earlier
// segment, or a substitution anywhere on the line (`$(…)`, a backtick, `<(…)`) — as it
// may have made or filled the source under any name, or `unread` when a glob, a
// variable or a remote (`host:/x`, `rsync://`) decides it.
function treeSource(r, source, tool) {
  const remote = LOCAL_COPIERS.has(tool) ? isRemote(source, r.platform) : REMOTE_WORD.test(source);
  if (classify(source) !== "path" || r.cwd === null || remote) {
    return { unread: true };
  }
  return { source: path.resolve(r.cwd, homeOf(r, source)), chained: r.segments > 0 || r.substitutes };
}

// --- archives -----------------------------------------------------------------

// An extraction writes wherever its archive says, under each directory it is
// given (the current one by default): kind "extract". `[]` when the command reads,
// lists, creates or pipes to stdout; null when it is no archive tool at all.
// `null` inside the list is a directory the guard cannot place.
const TAR = new Set(["tar", "bsdtar", "gtar"]);
const SEVEN_ZIP = new Set(["7z", "7za", "7zz"]);

// `--extr`, `--dir=X`: GNU long options take any unambiguous prefix.
function longOption(arg, name, shortest) {
  const key = arg.split("=")[0];
  return key.startsWith("--") && key.length - 2 >= shortest && name.startsWith(key.slice(2));
}

function tarTargets(operands) {
  const bare = /^[A-Za-z]+$/.test(operands[0] || "") ? operands[0] : "";
  const extracts = /x/.test(bare) || operands.some((arg) => longOption(arg, "extract", 3) || arg === "--get" || /^-[A-Za-z]*x/.test(arg));
  if (!extracts) {
    return null;
  }
  // `-P` keeps absolute names, `--to-command` hands each file to a program:
  // where they land is not in the command line.
  if (/P/.test(bare) || operands.some((arg) => longOption(arg, "absolute-names", 3) || longOption(arg, "to-command", 4) || /^-[A-Za-z]*P/.test(arg))) {
    return [null];
  }
  if (/O/.test(bare) || operands.some((arg) => arg === "--to-stdout" || /^-[A-Za-z]*O/.test(arg))) {
    return [];
  }
  const directories = [];
  operands.forEach((arg, i) => {
    if (arg === "-C" || (longOption(arg, "directory", 3) && !arg.includes("="))) {
      directories.push(operands[i + 1] ?? null);
    } else if (longOption(arg, "directory", 3) || arg.startsWith("--one-top-level=")) {
      directories.push(arg.slice(arg.indexOf("=") + 1));
    } else if (/^-C./.test(arg)) {
      directories.push(arg.slice(2));
    } else if (/^-[A-Za-z]+C/.test(arg)) {
      directories.push(null); // `-xC DIR`: which word is DIR depends on the cluster
    }
  });
  return directories.length ? directories : ["."];
}

// `unzip -d DIR`, `-dDIR`, `-od DIR`, `-qod DIR`: the letters before `d` are flags.
function unzipTargets(operands) {
  let directory = ".";
  for (let i = 0; i < operands.length; i += 1) {
    const arg = operands[i];
    if (!/^-[A-Za-z]/.test(arg)) {
      continue;
    }
    const letters = arg.slice(1);
    const at = letters.indexOf("d");
    if (/[lptvzZ]/.test(at === -1 ? letters : letters.slice(0, at))) {
      return [];
    }
    if (at !== -1) {
      directory = letters.slice(at + 1) || (operands[i + 1] ?? null);
    }
  }
  return [directory];
}

function otherArchiveTargets(name, operands) {
  if (name === "cpio") {
    if (operands.some((arg) => /^-[A-Za-z]*p/.test(arg) || arg === "--pass-through")) {
      return [operands.filter((arg) => !arg.startsWith("-")).pop() ?? null];
    }
    if (!operands.some((arg) => /^-[A-Za-z]*i/.test(arg) || arg === "--extract")) {
      return [];
    }
    const at = operands.findIndex((arg) => /^-D/.test(arg) || arg.startsWith("--directory"));
    const option = operands[at] || "";
    return [at === -1 ? "." : option.includes("=") ? option.slice(option.indexOf("=") + 1) : option.length > 2 && option.startsWith("-D") ? option.slice(2) : operands[at + 1] ?? null];
  }
  if (SEVEN_ZIP.has(name)) {
    if (!["x", "e"].includes(operands.find((arg) => !arg.startsWith("-")))) {
      return [];
    }
    const out = operands.find((arg) => arg.startsWith("-o"));
    return [out ? out.slice(2) : "."];
  }
  const more = moreArchiveTargets(name, operands);
  if (more !== null) {
    return more;
  }
  // `python3 -m zipfile -e ARCHIVE DIR`, `-m tarfile -e ARCHIVE [DIR]`
  const module = operands.indexOf("-m");
  if (/^python[\d.]*$/.test(name) && module !== -1 && ["zipfile", "tarfile"].includes(operands[module + 1])) {
    const at = operands.findIndex((arg, i) => i > module && (arg === "-e" || arg === "--extract"));
    return at === -1 ? [] : [operands[at + 2] ?? "."];
  }
  return null;
}

const positional = (operands) => operands.filter((arg) => !arg.startsWith("-"));

// `unrar x|e ARCHIVE [files…] [DIR/]` (a destination ends in `/`), `jar xf`
// (here, or `--dir DIR`), `pax -r` (here) and `pax -rw … DIR`; `pax -s` renames
// what it writes.
function moreArchiveTargets(name, operands) {
  if (name === "unrar" || name === "rar") {
    const [mode, , ...rest] = positional(operands);
    return mode === "x" || mode === "e" ? [rest.filter((arg) => arg.endsWith("/")).pop() || "."] : [];
  }
  if (name === "jar") {
    if (!/^-?-?[a-z]*x/.test(operands[0] || "") && !operands.includes("--extract")) {
      return [];
    }
    const at = operands.findIndex((arg) => arg === "--dir" || arg.startsWith("--dir="));
    return [at === -1 ? "." : operands[at].includes("=") ? operands[at].slice(6) : operands[at + 1] ?? null];
  }
  if (name === "pax") {
    const flags = operands.filter((arg) => /^-[A-Za-z]+$/.test(arg)).join("");
    if (!flags.includes("r")) {
      return [];
    }
    if (flags.includes("s")) {
      return [null];
    }
    return flags.includes("w") ? [positional(operands).pop() ?? null] : ["."];
  }
  return null;
}

// tar and gtar read a tar (gzip by content), unzip a zip; bsdtar detects the
// format itself.
const ARCHIVE_FORMAT = { tar: "tar", gtar: "tar", bsdtar: "any", unzip: "zip" };

// The archive file a tar or unzip extraction reads, when the command names one
// the guard can list by its plain member names: null for stdin, a renaming
// option (`--strip-components`, `--transform`, bsdtar's `-s`, unzip's `-j`), or
// any other tool.
function tarArchiveFile(operands) {
  const bare = /^[A-Za-z]+$/.test(operands[0] || "") ? operands[0] : "";
  // `-i`/`--ignore-zeros` reads past the end marker the lister stops at.
  if (/i/.test(bare) || operands.some((arg) => longOption(arg, "strip-components", 3) || longOption(arg, "transform", 3) || longOption(arg, "xform", 3) || longOption(arg, "ignore-zeros", 3) || arg === "-s" || /^-[A-Za-z]*i/.test(arg))) {
    return null;
  }
  for (let i = 0; i < operands.length; i += 1) {
    const arg = operands[i];
    if (longOption(arg, "file", 3)) {
      return arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : operands[i + 1] ?? null;
    }
    const cluster = arg === bare && i === 0 ? arg : /^-[A-Za-z]+$/.test(arg) ? arg.slice(1) : null;
    if (cluster !== null && cluster.includes("f")) {
      return cluster.endsWith("f") ? operands[i + 1] ?? null : null;
    }
    if (/^-f./.test(arg)) {
      return arg.slice(2);
    }
  }
  return null;
}

function unzipArchiveFile(operands) {
  for (let i = 0; i < operands.length; i += 1) {
    const arg = operands[i];
    if (/^-[A-Za-z]*j/.test(arg)) {
      return null;
    }
    if (arg.startsWith("-")) {
      i += /^-[A-Za-z]*d$/.test(arg) || ["-P", "-I", "-O", "-x"].includes(arg) ? 1 : 0;
      continue;
    }
    return arg;
  }
  return null;
}

function archiveFile(r, { name, operands }) {
  const word = TAR.has(name) ? tarArchiveFile(operands) : name === "unzip" ? unzipArchiveFile(operands) : null;
  if (word === null || word === "-" || classify(word) !== "path" || r.cwd === null) {
    return {};
  }
  // An earlier command (not a `cd`) or a substitution may have made the archive.
  return { archive: path.resolve(r.cwd, homeOf(r, word)), format: ARCHIVE_FORMAT[name], chained: r.acted > 0 || r.substitutes };
}

function extractTargets({ name, operands }) {
  if (TAR.has(name)) {
    return tarTargets(operands);
  }
  return name === "unzip" ? unzipTargets(operands) : otherArchiveTargets(name, operands);
}

function readArchive(r, command) {
  const directories = extractTargets(command);
  if (directories === null) {
    return false;
  }
  const members = archiveFile(r, command);
  for (const directory of directories) {
    if (directory === null) {
      r.found.push({ target: "(archive)", kind: "extract", unchecked: ARCHIVE });
    } else {
      add(r, directory, "extract", members);
    }
  }
  return true;
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

// --- patches ------------------------------------------------------------------

// A C-quoted patch path (`"b/caf\303\251"`), as git writes a name with odd bytes.
const C_ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };
function patchPath(text) {
  if (!text.startsWith('"')) {
    return text.split("\t")[0];
  }
  const bytes = [];
  for (let i = 1; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      return Buffer.from(bytes).toString("utf8");
    }
    if (ch !== "\\") {
      bytes.push(...Buffer.from(ch, "utf8"));
    } else if (/[0-7]{3}/.test(text.slice(i + 1, i + 4))) {
      bytes.push(parseInt(text.slice(i + 1, i + 4), 8));
      i += 3;
    } else if (C_ESCAPES[text[i + 1]] !== undefined) {
      bytes.push(C_ESCAPES[text[i + 1]]);
      i += 1;
    } else {
      return null;
    }
  }
  return null;
}

// `-p1` drops one leading component; a path too short for it is not guessed at.
function stripped(file, strip) {
  const parts = file.split("/");
  return file === "/dev/null" ? "" : parts.length > strip ? parts.slice(strip).join("/") : null;
}

// What one patch line names, or undefined when it names nothing. A `---`/`+++`
// line is a header only next to its pair: inside a hunk it is a removed `-- x`.
function patchLineNames(lines, i, strip) {
  const line = lines[i];
  const header = (line.startsWith("--- ") && (lines[i + 1] || "").startsWith("+++ ")) || (line.startsWith("+++ ") && (lines[i - 1] || "").startsWith("--- "));
  if (header) {
    const file = patchPath(line.slice(4));
    return file === null ? [null] : [stripped(file, strip)];
  }
  const renamed = line.match(/^(?:rename|copy) (?:from|to) (.+)$/);
  if (renamed) {
    return [patchPath(renamed[1])];
  }
  const git = line.match(/^diff --git ((?:"(?:\\.|[^"\\])*"|\S)+) ((?:"(?:\\.|[^"\\])*"|\S)+)$/);
  if (git) {
    return [git[1], git[2]].map((word) => {
      const file = patchPath(word);
      return file === null ? null : stripped(file, strip);
    });
  }
  return undefined;
}

// The files a patch names, under `base`: null when it cannot be read or a name
// cannot be placed.
function patchTargets(r, file, strip, base) {
  const text = r.cwd === null || typeof r.host.readText !== "function" ? null : r.host.readText(path.resolve(r.cwd, homeOf(r, file)));
  if (typeof text !== "string") {
    return null;
  }
  const lines = text.split("\n");
  // A context diff (`*** a/x` / `--- b/x`, `***************` hunks) is not read.
  if (lines.includes("***************")) {
    return null;
  }
  const targets = [];
  for (let i = 0; i < lines.length; i += 1) {
    const names = patchLineNames(lines, i, strip) || [];
    if (names.includes(null)) {
      return null;
    }
    names.filter(Boolean).forEach((name) => targets.push(portable(path.resolve(base, name))));
  }
  return targets;
}

// Each patch (a file, or `-` for an unread stdin) writes what it names.
function applyPatches(r, patches, strip, base) {
  for (const patch of patches) {
    if (patch === "/dev/null") {
      continue;
    }
    const targets = patch === "-" || classify(patch) !== "path" ? null : patchTargets(r, patch, strip, base);
    if (targets === null) {
      r.found.push({ target: patch, kind: "write", unchecked: UNREAD_PATCH });
    } else {
      targets.forEach((target) => add(r, target, "write"));
    }
  }
}

// `< FILE` on this segment, unless stdin comes down a pipe.
function stdinFile({ segment, args }) {
  if (segment.before === "pipe") {
    return null;
  }
  const at = args.indexOf("<");
  const glued = args.find((arg) => /^<[^<(]/.test(arg));
  return at !== -1 ? args[at + 1] ?? null : glued ? glued.slice(1) : null;
}

const shifted = (reason, r) => r.found.push({ target: "(patch)", kind: "write", unchecked: reason });

// `git apply` / `git am`: paths from the repository's top, `-p1`. Another prefix,
// `--directory` or `--unsafe-paths` is not modelled: unchecked.
function readGitPatch(r, command, sub, rest) {
  if (sub === "apply" && rest.some((arg) => /^--(?:check|stat|numstat|summary)$/.test(arg)) && !rest.includes("--apply")) {
    return;
  }
  if (sub === "am" && rest.some((arg) => arg === "--quit" || arg.startsWith("--show-current-patch"))) {
    return;
  }
  if (rest.some((arg) => (/^-p/.test(arg) && arg !== "-p1") || arg === "--no-prefix" || /^--directory/.test(arg) || arg === "--unsafe-paths")) {
    shifted(SHIFTED_PATCH, r);
    return;
  }
  const base = r.cwd === null ? null : (typeof r.host.gitRoot === "function" && r.host.gitRoot(r.cwd)) || r.cwd;
  const files = rest.filter((arg) => !arg.startsWith("-") && !/^<{1,3}/.test(arg) && arg !== stdinFile(command));
  applyPatches(r, files.length ? files : [stdinFile(command) || "-"], 1, base);
}

// `patch -p1 [-i FILE | < FILE]`, from the current directory. Without `-p0`/`-p1`
// patch picks names itself; `-d` moves it; `patch FILE` writes FILE alone.
// Short options cluster (`-Np1`, `-Ni FILE`): a letter that takes a value takes
// the rest of the word, or the next one.
const PATCH_VALUE_LETTERS = "pidoBDFrVYzgx";
function patchOptions(operands) {
  const options = { positional: [], values: {}, dryRun: false };
  for (let i = 0; i < operands.length; i += 1) {
    const arg = operands[i];
    const long = arg.match(/^--(input|strip|directory|output)(?:=(.*))?$/);
    if (long) {
      options.values[long[1][0] === "s" ? "p" : long[1][0]] = long[2] ?? operands[(i += 1)];
    } else if (arg === "--dry-run" || arg === "--check") {
      options.dryRun = true;
    } else if (/^-[A-Za-z]/.test(arg)) {
      for (let at = 1; at < arg.length; at += 1) {
        if (arg[at] === "C") {
          options.dryRun = true; // BSD patch's --check
        } else if (PATCH_VALUE_LETTERS.includes(arg[at])) {
          options.values[arg[at]] = arg.slice(at + 1) || operands[(i += 1)];
          break;
        }
      }
    } else if (!arg.startsWith("-")) {
      options.positional.push(arg);
    }
  }
  return options;
}

function readPatchCommand(r, command) {
  const { positional, values, dryRun } = patchOptions(command.operands);
  if (dryRun || positional.length || (values.i || stdinFile(command)) === "/dev/null") {
    return; // `patch FILE [PATCH]` writes FILE, read as an edited file
  }
  if (!["0", "1"].includes(values.p) || values.d !== undefined) {
    shifted(SHIFTED_PATCH, r);
    return;
  }
  applyPatches(r, [values.i || stdinFile(command) || "-"], Number(values.p), r.cwd || ".");
}

// --- git verbs ----------------------------------------------------------------

// The subcommand after git's own options (`-C dir`, `-c k=v`).
function gitSubcommand(args) {
  let index = 0;
  while (index < args.length && args[index].startsWith("-")) {
    index += args[index] === "-C" || args[index] === "-c" ? 2 : 1;
  }
  return { sub: args[index], rest: args.slice(index + 1) };
}

// `git apply`/`am` write what their patch names, `git stash pop|apply` what the
// stash holds, `git mv` moves like `mv`.
function readGitVerbs(r, command) {
  const { sub, rest } = gitSubcommand(command.args);
  if (sub === "stash" && (rest[0] === "pop" || rest[0] === "apply")) {
    r.found.push({ target: "(stash)", kind: "write", unchecked: STASH });
  } else if (sub === "apply" || sub === "am") {
    readGitPatch(r, command, sub, rest);
  } else if (readGitPlumbing(r, sub, rest)) {
    return;
  } else if (sub === "mv") {
    const operands = rest.filter((arg) => !/^<{1,3}/.test(arg));
    const files = operands.filter((arg) => classify(arg) !== "skip");
    if (files.length >= 1) {
      readCopy(r, { segment: command.segment, name: "mv", args: rest, operands, files });
    }
  }
}

const CLONE_VALUE_OPTIONS = new Set(["-b", "--branch", "-o", "--origin", "-c", "--config", "--depth", "--reference", "--reference-if-able", "--separate-git-dir", "-u", "--upload-pack", "--template", "-j", "--jobs", "--filter", "--shallow-since", "--shallow-exclude", "--server-option", "--bundle-uri"]);
const WORKTREE_VALUE_OPTIONS = new Set(["-b", "-B", "--reason", "--orphan"]);

function operandsOf(args, valueOptions) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--") {
      out.push(...args.slice(i + 1));
      break;
    }
    if (args[i].startsWith("-")) {
      i += valueOptions.has(args[i]) ? 1 : 0;
    } else if (!/^<{1,3}/.test(args[i])) {
      out.push(args[i]);
    }
  }
  return out;
}

// A directory git makes whole: judged on what it is and holds, its source unread.
function gitTree(r, dir) {
  add(r, dir, "write");
  if (r.trees) {
    add(r, dir, "tree", { unread: true });
  }
}

// Plumbing that writes the work tree: `checkout-index` (named paths; the whole
// index, a prefix or stdin are unchecked), `read-tree -u`, and the directory
// `clone` or `worktree add` makes. Returns whether `sub` was one of them.
function readGitPlumbing(r, sub, rest) {
  if (sub === "checkout-index") {
    if (rest.some((arg) => /^-[A-Za-z]*a$/.test(arg) || arg === "--all" || arg === "--stdin" || arg.startsWith("--prefix"))) {
      r.found.push({ target: "(index)", kind: "write", unchecked: GIT_INDEX });
    }
    operandsOf(rest, new Set()).forEach((file) => add(r, file, "write"));
  } else if (sub === "read-tree") {
    if (rest.some((arg) => arg === "-u")) {
      r.found.push({ target: "(index)", kind: "write", unchecked: GIT_INDEX });
    }
  } else if (sub === "clone") {
    const [repository, dir] = operandsOf(rest, CLONE_VALUE_OPTIONS);
    const named = dir ?? (repository ? path.posix.basename(repository.replace(/^[^/]*:/, "").replace(/\/?$/, "")).replace(/\.git$/, "") : null);
    if (named) {
      gitTree(r, named);
    }
  } else if (sub === "worktree" && rest[0] === "add") {
    const [dir] = operandsOf(rest.slice(1), WORKTREE_VALUE_OPTIONS);
    if (dir) {
      gitTree(r, dir);
    }
  } else {
    return false;
  }
  return true;
}

// `:/X` and `:(top)X` name X from the repository's top; any other magic
// (`:(glob)`, `:!X`) is not modelled.
function gitPathspec(r, pathspec) {
  if (!pathspec.startsWith(":")) {
    return pathspec;
  }
  const top = pathspec.match(/^:(?:\/|\(top\))(.*)$/);
  if (!top || r.cwd === null) {
    return null;
  }
  const root = (typeof r.host.gitRoot === "function" && r.host.gitRoot(r.cwd)) || r.cwd;
  return portable(path.join(root, top[1]));
}

function readGit(r, command) {
  const git = gitPaths(command.args);
  const saved = r.cwd;

  if (git.dir !== null) {
    r.cwd = classify(git.dir) === "unknown" || (r.cwd === null && !path.isAbsolute(git.dir)) ? null : r.host.realpath(path.resolve(r.cwd || "/", homeOf(r, git.dir)));
  }
  readGitVerbs(r, command);
  for (const pathspec of git.paths) {
    const file = gitPathspec(r, pathspec);
    if (file === null) {
      r.found.push({ target: pathspec, kind: "write", unchecked: PATHSPEC_MAGIC });
      continue;
    }
    add(r, file, "write");
    // A checked-out pathspec may be a whole directory.
    if (r.trees) {
      add(r, file, "tree");
    }
  }
  if (git.fromFile) {
    r.found.push({ target: "(pathspec file)", kind: "write", unchecked: PATHSPEC_FILE });
  }
  r.cwd = saved;
}

// --- scp / sftp -----------------------------------------------------------------

const SCP_VALUE_LETTERS = "cDFiJloPSX";
const SFTP_VALUE_LETTERS = "BbcDFiJloPRSsX";

// `scp SRC… DEST` copies like `cp` when DEST is local; `sftp HOST:PATH LOCAL`
// downloads like it. A bare `sftp HOST` (or `-b batch`) is a session of
// commands the guard does not read.
function readSecureCopy(r, command) {
  const letters = command.name === "scp" ? SCP_VALUE_LETTERS : SFTP_VALUE_LETTERS;
  const flags = [];
  const words = [];
  for (let i = 0; i < command.operands.length; i += 1) {
    const arg = command.operands[i];
    if (/^-[A-Za-z0-9]+$/.test(arg)) {
      flags.push(arg);
      i += letters.includes(arg[arg.length - 1]) && arg.length === 2 ? 1 : 0;
    } else if (!arg.startsWith("-")) {
      words.push(arg);
    }
  }
  const destination = words[words.length - 1];
  if (command.name === "sftp" && (words.length < 2 || flags.some((flag) => flag.includes("b")))) {
    r.found.push({ target: words[0] || "(sftp)", kind: "write", unchecked: SFTP_SESSION });
    return;
  }
  if (words.length < 2 || isRemote(destination, r.platform)) {
    return;
  }
  const recursive = flags.some((flag) => flag.includes("r"));
  const args = recursive ? ["-r", ...words] : words;
  readCopy(r, { segment: command.segment, name: "cp", tool: command.name, args, operands: args, files: words.filter((arg) => classify(arg) !== "skip") });
}

// --- commands handed their paths ----------------------------------------------

// `find … -exec mv {} …`, `xargs mv`: the paths come from another command's output.
const FORWARDING_WRITERS = new Set([...DESTINATION_LAST, ...TAR, ...SEVEN_ZIP, ...SHELLS, "unzip", "cpio", "sed", "tee", "dd", "truncate", "patch", "git"]);
const XARGS_VALUE_OPTIONS = new Set(["-I", "-i", "-n", "-L", "-l", "-P", "-d", "-E", "-e", "-s", "-a"]);
function forwardedVerb({ name, operands }) {
  if (name === "find") {
    const at = operands.findIndex((arg) => /^-(?:exec|execdir|ok|okdir)$/.test(arg));
    return at === -1 ? null : operands[at + 1];
  }
  if (name !== "xargs") {
    return null;
  }
  for (let i = 0; i < operands.length; i += 1) {
    if (XARGS_VALUE_OPTIONS.has(operands[i])) {
      i += 1;
    } else if (!operands[i].startsWith("-")) {
      return operands[i];
    }
  }
  return null;
}

function readForwarded(r, command) {
  const verb = forwardedVerb(command);
  if (verb === null || verb === undefined) {
    return false;
  }
  if (FORWARDING_WRITERS.has(path.basename(verb))) {
    r.found.push({ target: verb, kind: "write", unchecked: FORWARDED });
  }
  return true;
}

// --- scripts followed ---------------------------------------------------------

// A script handed to `bash -c` / `eval` runs from the current directory. With the
// directory unknown, only its absolute targets can still be judged; a relative one is unchecked.
function followScript(r, program) {
  for (const entry of shellWrites(unquote(program), r.cwd === null ? r.startCwd : r.cwd, r.host, { trees: r.trees, after: r.segments, substitutes: r.substitutes })) {
    if (entry.unchecked) {
      r.found.push(entry);
    } else if (r.cwd === null && !path.isAbsolute(homeOf(r, entry.target))) {
      r.found.push({ target: entry.target, kind: entry.kind, unchecked: UNKNOWN_CWD });
    } else {
      const { target, kind, ...tree } = entry;
      add(r, target, kind, tree);
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
// `source` and `.` run a file in this shell: `/dev/stdin`, `/dev/fd/N` and `<(…)` are its input.
const SOURCES = new Set(["source", "."]);
const STDIN_FILE = /^\/dev\/(?:stdin|fd\/\d+)$/;

function readStdinProgram(r, { segment, name, args: given }) {
  const interpreter = INTERPRETERS.some(([pattern]) => pattern.test(name)) || SHELLS.has(name) || SOURCES.has(name);
  const args = given.filter((arg) => !STDIN_FILE.test(arg));
  const firstOperand = args.findIndex((arg) => !arg.startsWith("-") || arg === "--");
  const options = firstOperand === -1 ? args : args.slice(0, firstOperand);
  const stdinFlag = SHELLS.has(name) && options.some((arg) => /^-[A-Za-z]*s[A-Za-z]*$/.test(arg));
  if (interpreter && segment.after === "open" && /<\s*$/.test(segment.text)) {
    r.found.push({ target: `(${name} program)`, kind: "write", unchecked: SUBSTITUTED_PROGRAM });
  } else if (interpreter && /<<</.test(segment.text)) {
    // `bash <<< 'script'`: the here-string is the program, whatever the operands.
    r.found.push({ target: `(${name} program)`, kind: "write", unchecked: HEREDOC_PROGRAM });
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
    if (name === "patch") {
      readPatchCommand(r, command);
    }
  } else if (DESTINATION_LAST.has(name) && command.files.length >= 1) {
    readCopy(r, command);
  } else if (name === "curl" || name === "wget" || name === "dd") {
    downloadFiles(command).forEach((file) => add(r, file, "write"));
  } else if (name === "git") {
    readGit(r, command);
  } else if (name === "scp" || name === "sftp") {
    readSecureCopy(r, command);
  } else if (readArchive(r, command) || readForwarded(r, command)) {
    return null;
  } else if (/[$`]/.test(name)) {
    r.found.push({ target: name, kind: "write", unchecked: SUBSTITUTED_VERB });
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
// `realPathOf(file)` (through links, for a file that may not exist yet), `home()`,
// `readText(file)` (a patch, null when unreadable), `gitRoot(dir)` (null outside one).
//
// `options.trees`: also give a "tree" entry for every write of a whole directory
// (a recursive copy, a checked-out pathspec), judged on what it holds. Off, the
// list is the per-file one.
// The line with each unquoted substitution (`$(…)`, `<(…)`, `>(…)`, a backtick
// pair) replaced by one unknown word: the segment splitter cuts a command at a
// substitution's parenthesis, so `rsync --exclude-from=<(…) E/ .` reads its
// source and destination only once the substitution is out of the way.
function withoutSubstitutions(command) {
  let out = "";
  let quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote === "'") {
      quote = ch === "'" ? null : quote;
    } else if (ch === "'" && quote === null) {
      quote = "'";
    } else if (ch === '"') {
      quote = quote === '"' ? null : '"';
    } else if (ch === "\\") {
      out += ch + (command[i + 1] ?? "");
      i += 1;
      continue;
    } else if ((/[$<>]/.test(ch) && command[i + 1] === "(") || ch === "`") {
      i = ch === "`" ? command.indexOf("`", i + 1) : closingParen(command, i + 1);
      if (i === -1) {
        return out + "$SUBSTITUTED";
      }
      out += "$SUBSTITUTED";
      continue;
    }
    out += ch;
  }
  return out;
}

function closingParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    depth += text[i] === "(" ? 1 : text[i] === ")" ? -1 : 0;
    if (depth === 0) {
      return i;
    }
  }
  return -1;
}

// Trees, moves and extractions of the command the substitutions sat in.
function readAroundSubstitutions(r, command, startCwd, options) {
  const flat = withoutSubstitutions(command);
  if (!r.trees || options.flat || flat === command) {
    return;
  }
  for (const entry of shellWrites(flat, startCwd, r.host, { ...options, flat: true, substitutes: true })) {
    if (["tree", "move", "extract"].includes(entry.kind)) {
      const { target, kind, unchecked, ...tree } = entry;
      if (unchecked) {
        r.found.push(entry);
      } else {
        add(r, target, kind, tree);
      }
    }
  }
}

function shellWrites(command, startCwd, host, options = {}) {
  if (typeof command !== "string" || !command.trim()) {
    return [];
  }

  // The shell drops a backslash-newline continuation before it reads any word.
  command = command.replace(/\\\n/g, "");

  const r = reader(startCwd, host, options);
  // A substitution anywhere on the line (`$(…)`, a backtick, `<(…)`, `>(…)`)
  // runs before the command it sits in, wherever it is placed.
  r.substitutes = r.substitutes || /\$\(|`|[<>]\(/.test(command.replace(/'[^']*'/g, ""));
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
    const command = commandOf(segment);
    left = readVerb(r, command);
    r.segments += 1;
    // A `cd` moves the read but makes no file: what follows it reads the disk as it is.
    if (!["cd", "pushd", "popd"].includes(command.name)) {
      r.acted += 1;
    }

    if (resume !== null) {
      r.cwd = resume.cwd;
    }

    if (segment.after === "open") {
      r.stack.push(r.cwd);
    } else if (segment.after === "close") {
      r.cwd = r.stack.length ? r.stack.pop() : r.cwd;
    }
  }

  if (r.substitutes) {
    readAroundSubstitutions(r, command, startCwd, options);
  }
  return r.found;
}

module.exports = { heredocWord, isRemote, shellWrites, commandOf, verbAt, splitSegments, tokenize, expandHome, nativeShellPath, isShellLimit, SHELLS, ARCHIVE, UNREAD_TREE };
