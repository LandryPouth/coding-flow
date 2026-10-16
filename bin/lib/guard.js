"use strict";

// `ai-flow guard`: the deterministic PreToolUse hook. Claude Code passes the tool
// call on stdin BEFORE the write; guard refuses it (exit 2 + "deny" decision) if
// the targeted file matches a blocked path in the harness policy, or if the
// written content contains a secret. This is the move from the *advisory*
// guardrail (harness check, after the fact) to the *in-code* guardrail (at the
// tool boundary, before the write).
//
// SCOPE, stated precisely, because a security control that is described as
// absolute stops being checked:
//
//   - Covered: the editing tools (Write/Edit/MultiEdit/NotebookEdit), and the
//     common shell write forms in a `Bash` call — redirections (`> .env`,
//     heredocs), `tee`, `sed -i`, `cp`/`mv`/`ln`/`install`, `dd of=`.
//   - NOT covered: a write performed inside an interpreter the guard cannot
//     read, e.g. `python -c "open('.env','w')…"`, a compiled binary, or a
//     script fetched and executed. Shell text is parsed, program semantics are
//     not.
//
// So: this makes the common leak paths impossible, not every leak path. The
// harness scan (`ai-flow harness check`) remains the after-the-fact net.
//
// Fail-open by design: empty/unreadable stdin, unrelated tool, or missing config
// ⇒ allow. A hook must never break a legitimate use; it only blocks on a
// deterministic and explicit match.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const {
  defaultHarnessConfig,
  getSecretPatterns,
  findSecretsInContent,
  isHeuristicAllowlisted,
} = require("./harness");
const { matchesPattern, isAllowedEnvExample, normalizePortable } = require("./util");

// Tools that write to disk through a structured file_path. The others (Read,
// Grep…) are not our business here: immediate allow.
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

// Tools known to leave the disk alone, in Claude Code and OpenCode spellings. Any
// OTHER tool that carries a path is a write tool we have not met yet: the guard
// cannot judge it, and says so (`unchecked`) instead of waving it through.
// Keep in step with the read-only regex in the OpenCode plugin body (opencode.js).
const READ_ONLY_TOOLS = new Set(
  [
    "Read", "Glob", "Grep", "LS", "WebFetch", "WebSearch", "Task", "Agent", "TodoWrite", "TodoRead",
    "Skill", "SlashCommand", "AskUserQuestion", "ExitPlanMode", "EnterPlanMode", "BashOutput",
    "KillShell", "KillBash", "EnterWorktree", "ExitWorktree", "ListMcpResourcesTool", "ReadMcpResourceTool", "ToolSearch", "Monitor",
    "read", "glob", "grep", "list", "ls", "webfetch", "websearch", "todowrite", "todoread", "skill",
    "task", "question", "lsp", "codesearch",
    "Artifact", "ArtifactData", "ArtifactComments", "ArtifactCheck",
  ].map((name) => name.toLowerCase()),
);
// MCP tools (`mcp__server__tool`) are the server's own, not a write tool the guard
// could learn: counting them would bury the real unknowns in noise.
const isMcpTool = (name) => /^mcp__/i.test(String(name || ""));
const PATH_FIELDS = ["file_path", "path", "filePath", "notebook_path"];

function readHookInput({ inputFile = null } = {}) {
  try {
    if (inputFile) {
      return fs.readFileSync(inputFile, "utf8");
    }
    // fd 0 = stdin. In a hook context, the input is always piped.
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parseHookInput(raw) {
  if (!raw || !raw.trim()) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Path targeted by the tool call, depending on the shape of tool_input.
function targetPath(toolInput) {
  if (!toolInput || typeof toolInput !== "object") {
    return null;
  }
  return toolInput.notebook_path || toolInput.file_path || null;
}

// Content that would be written, aggregated per tool (for the secret scan).
function writtenContent(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== "object") {
    return "";
  }

  if (toolName === "Write") {
    return typeof toolInput.content === "string" ? toolInput.content : "";
  }
  if (toolName === "Edit") {
    return typeof toolInput.new_string === "string" ? toolInput.new_string : "";
  }
  if (toolName === "NotebookEdit") {
    return typeof toolInput.new_source === "string" ? toolInput.new_source : "";
  }
  if (toolName === "MultiEdit" && Array.isArray(toolInput.edits)) {
    return toolInput.edits
      .map((edit) => (edit && typeof edit.new_string === "string" ? edit.new_string : ""))
      .join("\n");
  }
  return "";
}

// Loads the harness policy from the resolved root, without depending on the
// module's cwd (the hook provides its own cwd). Missing config ⇒ defaults, so a
// project that never ran `harness init` is still guarded. A config that exists but
// cannot be read or parsed also falls back to defaults, flagged `unreadable` so the
// decision says it was not judged against the user's policy.
function loadPolicy(root) {
  const defaults = defaultHarnessConfig();
  const configFile = path.join(root, ".coding-flow", "harness.json");

  let config = null;
  let unreadable = false;
  try {
    if (fs.existsSync(configFile)) {
      config = JSON.parse(fs.readFileSync(configFile, "utf8").replace(/^﻿/, ""));
    }
  } catch {
    config = null;
    unreadable = true;
  }

  const pick = (key) =>
    config && Array.isArray(config[key]) ? config[key] : defaults[key];

  return {
    blockedPaths: pick("blockedPaths"),
    secretPatterns: pick("secretPatterns"),
    secretScanAllowlist: pick("secretScanAllowlist"),
    // Only an explicit "strict" tightens the guard; anything else (absent, unreadable,
    // a typo) is the standard posture, so a broken file never locks anyone out.
    mode: config && config.mode === "strict" ? "strict" : "standard",
    unreadable,
  };
}

// --- shell write detection ------------------------------------------------
//
// Extracts the paths a shell command would WRITE to. Conservative: a target we
// fail to recognise is simply not checked (fail-open), never guessed at.

// Commands whose last non-flag argument is the destination.
const DESTINATION_LAST = new Set(["cp", "mv", "ln", "install", "rsync"]);

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

const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const EXPANSION = "write target depends on shell expansion";
const UNKNOWN_CWD = "the working directory depends on shell expansion";

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

// The inline program an interpreter was handed, in its flag spellings: `-c code`,
// `-Bc code`, `--eval code`, `--eval=code`, `deno eval code`.
const INTERPRETERS = [
  [/^python[\d.]*$/, /^-[A-Za-z]*c$/],
  [/^(node|nodejs|bun)$/, /^(-e|-p|--eval|--print)$/],
  [/^(perl|ruby)$/, /^-[A-Za-z]*e$/],
  [/^deno$/, /^eval$/],
];

function inlineCode(name, args) {
  const programs = [];
  for (const [pattern, flag] of INTERPRETERS) {
    if (!pattern.test(name)) {
      continue;
    }
    args.forEach((arg, at) => {
      if (flag.test(arg) && args[at + 1] !== undefined) {
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

// What a command would write, in order: `[{ target, kind, unchecked? }]`. `target`
// is relative to `startCwd` (or `~`/absolute), already resolved against any `cd`
// earlier in the command. `kind`: "write" | "alias" (a link whose source is the
// target) | "inline" (a literal in inline code). `unchecked` carries the reason a
// target cannot be resolved. Conservative: a shape we do not recognise is not guessed at.
function shellWrites(command, startCwd = process.cwd()) {
  if (typeof command !== "string" || !command.trim()) {
    return [];
  }

  // The shell drops a backslash-newline continuation before it reads any word.
  command = command.replace(/\\\n/g, "");

  const found = [];
  const seen = new Set();
  const stack = [];
  // The shell resolves `..` physically once a `cd` went through a symlink, so every
  // directory it tracks is the real one when it exists (a missing one stays lexical).
  const physical = (dir) => {
    try {
      return fs.realpathSync(dir);
    } catch {
      return dir;
    }
  };
  const start = physical(path.resolve(startCwd));
  let cwd = start;

  const add = (word, kind) => {
    const token = reduceWord(word);
    const state = classify(token);
    if (state === "skip") {
      return;
    }

    let entry;
    if (state === "unknown") {
      entry = { target: token, kind, unchecked: EXPANSION };
    } else if (cwd === null && !path.isAbsolute(expandHome(token))) {
      entry = { target: token, kind, unchecked: UNKNOWN_CWD };
    } else if (cwd === null || cwd === start || path.isAbsolute(expandHome(token))) {
      entry = { target: token, kind };
    } else {
      entry = { target: path.relative(start, path.resolve(cwd, token)), kind };
    }

    const key = `${entry.kind}\0${entry.target}\0${entry.unchecked || ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      found.push(entry);
    }
  };

  // Redirections: `> file`, `>> file`, `2> file`. `2>&1` and `>&2` duplicate a
  // descriptor and write to no path — the (?!&) drops them.
  // Spaces around the operator are optional (`echo a>.env`), and `>|` (clobber) and
  // `&>` (both streams) write too; `>&file` is a write, `>&2` and `2>&1` are not.
  // The target is one shell word: quoted parts and bare characters glued together (`'.e'nv`).
  const TARGET = `((?:"(?:\\\\[\\s\\S]|[^"\\\\])*"|'[^']*'|[^\\s;&|<>()"'])+)`;
  const redirections = [
    new RegExp(`(?<![<>&\\d])\\d?(?:&>>?|>>|>\\|?)(?!&)\\s*${TARGET}`, "gd"),
    new RegExp(`(?<![<>&\\d])\\d?>&\\s*(?![\\d-])${TARGET}`, "gd"),
  ];

  // A script handed to `bash -c` / `eval` runs from the current directory. With the
  // directory unknown, only its absolute targets can still be judged; a relative one is unchecked.
  const followScript = (program) => {
    for (const entry of shellWrites(unquote(program), cwd === null ? startCwd : cwd)) {
      if (entry.unchecked) {
        found.push(entry);
      } else if (cwd === null && !path.isAbsolute(expandHome(entry.target))) {
        found.push({ target: entry.target, kind: entry.kind, unchecked: UNKNOWN_CWD });
      } else {
        add(entry.target, entry.kind);
      }
    }
  };

  // Wrappers and compound-command keywords that sit in front of the real verb.
  const WRAPPERS = new Set(["sudo", "doas", "env", "time", "builtin", "command", "nohup", "exec", "nice", "timeout", "then", "do", "else", "elif", "if", "while", "until", "!", "{"]);
  const WRAPPER_VALUE_OPTIONS = {
    sudo: new Set(["-u", "-g", "-h", "-p", "-C", "-T", "-r", "-t", "-U", "-D"]),
    doas: new Set(["-u", "-C"]),
    env: new Set(["-u", "-C", "-S"]),
    nice: new Set(["-n"]),
    timeout: new Set(["-s", "-k"]),
  };
  let beforeCd = null;

  for (const segment of splitSegments(command)) {
    // `cd a || X`: X only runs when the cd failed, so it sees the old directory.
    // What follows X (`cd a || exit; …`) only runs when the cd worked, so it goes on
    // from the directory the cd reached.
    let resume = null;
    if (segment.before === "or" && beforeCd !== null) {
      resume = { cwd };
      cwd = beforeCd.cwd;
    }
    beforeCd = null;

    // An operator inside quotes is text: scan a copy whose quoted contents are blanked out
    // (same offsets), and read the target from the original.
    const masked = segment.text.replace(/"(?:\\[\s\S]|[^"\\])*"|'[^']*'/g, (quoted) => quoted[0] + "_".repeat(quoted.length - 2) + quoted[quoted.length - 1]);
    for (const redirection of redirections) {
      for (const match of masked.matchAll(redirection)) {
        add(segment.text.slice(...match.indices[1]), "write");
      }
    }

    const tokens = tokenize(segment.text.trim());

    // `sudo cp …`, `env FOO=1 tee …`, `time cd x`: step over the wrapper to the verb.
    // An option that takes a value (`sudo -u root`, `nice -n 5`) steps over its value too,
    // and `timeout` over its duration, or the value would be read as the verb.
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

    const name = path.basename(tokens[index] || "");
    const args = tokens.slice(index + 1);
    // `< input` and `<<EOF` read; their operand is not a file the command writes.
    const operands = args.filter((arg, i) => !/^<{1,3}$/.test(arg) && !/^<{1,3}$/.test(args[i - 1] || "") && !arg.startsWith("<"));
    const files = operands.filter((arg) => classify(arg) !== "skip");

    if (tokens.length === 0) {
      // nothing to read
    } else if (name === "cd" || name === "pushd") {
      const inPipeline = segment.before === "pipe" || segment.after === "pipe" || segment.after === "bg";
      const dir = args.find((arg) => !arg.startsWith("-") || arg === "-");
      const target = dir === undefined || dir === "~" ? os.homedir() : dir === "-" || classify(dir) === "unknown" ? null : expandHome(dir);

      if (!inPipeline) {
        beforeCd = { cwd };
        cwd = target === null || (cwd === null && !path.isAbsolute(target)) ? null : physical(path.resolve(cwd || "/", target));
      }
    } else if (name === "popd") {
      cwd = null;
    } else if (name === "tee" || name === "sponge") {
      files.forEach((file) => add(file, "write"));
    } else if (name === "sed" && args.some((arg) => arg === "--in-place" || arg.startsWith("--in-place=") || /^-[A-Za-z]*i/.test(arg))) {
      // sed -i '<script>' <files…>: the script is the first non-flag argument.
      files.slice(1).forEach((file) => add(file, "write"));
    } else if (DESTINATION_LAST.has(name) && files.length >= 1) {
      const symbolic = args.some((arg) => /^-[A-Za-z]*[sl]/.test(arg) || arg === "--symbolic" || arg === "--link" || arg === "--symbolic-link");
      const aliasing = name === "ln" || (name === "cp" && symbolic);

      // `cp -t DIR src…` / `--target-directory=DIR`: DIR is the destination, not a source.
      // `-t` may end a cluster (`cp -rt DIR`, `install -Dt DIR`) or carry the value (`-tDIR`).
      const optionAt = operands.findIndex((arg) => /^-[A-Za-z]*t/.test(arg) || arg === "--target-directory" || arg.startsWith("--target-directory="));
      let directory = null;
      let sources = files;
      if (optionAt !== -1) {
        const option = operands[optionAt];
        const glued = option.match(/^-[A-Za-z]*t(.+)$/);
        directory = option.startsWith("--target-directory=") ? option.slice(option.indexOf("=") + 1) : glued ? glued[1] : operands[optionAt + 1];
        sources = files.filter((arg) => arg !== directory);
        if (directory !== undefined) {
          add(directory, "write");
        }
      } else if (files.length >= 2) {
        directory = files[files.length - 1];
        sources = files.slice(0, -1);
        add(directory, "write");
      }

      // A directory destination receives `DIR/<name of each source>`: that is the file written.
      if (typeof directory === "string" && classify(directory) === "path") {
        const base = cwd === null ? null : path.resolve(cwd, expandHome(directory));
        let isDirectory = /(?:^|\/)\.{0,2}\/?$/.test(directory) || optionAt !== -1;
        try {
          isDirectory = isDirectory || (base !== null && fs.statSync(base).isDirectory());
        } catch {
          // a missing destination is a file name
        }
        if (isDirectory) {
          for (const source of sources) {
            const name = path.posix.basename(source);
            if (classify(source) === "path" && name !== "." && name !== ".." && !source.endsWith("/")) {
              add(path.posix.join(directory, name), "write");
            }
          }
        }
      }

      if (aliasing) {
        const sources = files.length >= 2 ? files.slice(0, -1) : files;
        const where = files.length >= 2 ? path.dirname(files[files.length - 1]) : ".";
        for (const source of sources) {
          add(source, "alias");
          // A relative symlink source is read from the link's own directory.
          if (where !== "." && classify(source) === "path" && !path.isAbsolute(expandHome(source))) {
            add(path.join(where, source), "alias");
          }
        }
      }
    } else if (name === "perl" && args.some((arg) => /^-[A-Za-z]*i/.test(arg))) {
      // perl -pi -e '<script>' <files…> edits in place; the script is the word after -e.
      const e = args.findIndex((arg) => /^-[A-Za-z]*e$/.test(arg));
      args.slice(e === -1 ? 0 : e + 2).forEach((file) => add(file, "write"));
    } else if (name === "awk" && args.includes("-i") && args.includes("inplace")) {
      // awk -i inplace '<program>' <files…>
      files.filter((arg) => arg !== "inplace").slice(1).forEach((file) => add(file, "write"));
    } else if (name === "ed" || name === "ex" || name === "patch") {
      // ed/ex/patch FILE edit the named file in place (patch with no FILE reads the diff's own paths: not read).
      files.forEach((file) => add(file, "write"));
    } else if (name === "truncate") {
      // truncate -s N <files…>: the size (or reference file) is an option value, not a target.
      const skip = args.findIndex((arg) => arg === "-s" || arg === "-r" || arg === "--size" || arg === "--reference");
      files.filter((arg) => skip === -1 || arg !== args[skip + 1]).forEach((file) => add(file, "write"));
    } else if (name === "curl" || name === "wget") {
      // curl -o FILE / --output FILE; wget -O FILE / --output-document / -o logfile.
      const options = name === "curl" ? /^(?:-[A-Za-z]*o|--output)$/ : /^(?:-[A-Za-z]*[oO]|--output-document|--output-file)$/;
      operands.forEach((arg, i) => {
        const long = arg.match(/^--(?:output|output-document|output-file)=(.*)$/);
        if (long) {
          add(long[1], "write");
        } else if (options.test(arg) && operands[i + 1] !== undefined) {
          add(operands[i + 1], "write");
        }
      });
    } else if (name === "dd") {
      for (const arg of args) {
        if (arg.startsWith("of=")) {
          add(arg.slice(3), "write");
        }
      }
    } else if (name === "git") {
      const git = gitPaths(args);
      const saved = cwd;

      if (git.dir !== null) {
        cwd = classify(git.dir) === "unknown" || (cwd === null && !path.isAbsolute(git.dir)) ? null : physical(path.resolve(cwd || "/", expandHome(git.dir)));
      }
      git.paths.forEach((file) => add(file, "write"));
      if (git.fromFile) {
        found.push({ target: "(pathspec file)", kind: "write", unchecked: "git reads its paths from a file" });
      }
      cwd = saved;
    } else if (name === "eval") {
      followScript(args.join(" "));
    } else if (SHELLS.has(name) && args.some((arg) => /^-[A-Za-z]*c$/.test(arg))) {
      // `bash -c "<script>"`: the script is a command of its own, read from this directory.
      const program = args[args.findIndex((arg) => /^-[A-Za-z]*c$/.test(arg)) + 1];
      if (program !== undefined) {
        followScript(program);
      }
    } else {
      const programs = inlineCode(name, args);
      programs.forEach((program) =>
        stringLiterals(program).forEach((literal) => {
          // A bare open() mode (`'w'`, `'rb'`) is not a path.
          if (!/^[rwabx+]{1,3}$/.test(literal)) {
            add(literal, "inline");
          }
          // A 2-argument `open(F, ">.env")` carries its mode in the literal.
          const bare = literal.replace(/^\+?[<>]{1,2}\s*/, "");
          if (bare !== literal) {
            add(bare, "inline");
          }
        }),
      );

      // A program read from a heredoc / here-string is data to the splitter: it cannot be judged.
      const reader = INTERPRETERS.some(([pattern]) => pattern.test(name)) || SHELLS.has(name);
      if (reader && programs.length === 0 && segment.text.includes("<<") && args.every((arg) => arg.startsWith("-") || arg.startsWith("<"))) {
        found.push({ target: `(${name} program)`, kind: "write", unchecked: "an interpreter reads its program from a heredoc" });
      }
    }

    if (resume !== null) {
      cwd = resume.cwd;
    }

    if (segment.after === "open") {
      stack.push(cwd);
    } else if (segment.after === "close") {
      cwd = stack.length ? stack.pop() : cwd;
    }
  }

  return found;
}

// Compatibility: the plain list of paths a command writes.
function shellWriteTargets(command) {
  return [...new Set(shellWrites(command).filter((e) => e.kind === "write" && !e.unchecked).map((e) => e.target))];
}

// --- path resolution --------------------------------------------------------
//
// A write is judged on the file it will REACH, not on the string it was given:
// through a symlink, a `..`, a `~`, or an absolute path into the primary checkout.

const gitMemo = new Map();

function git(cwd, args) {
  const key = `${cwd}\0${args.join(" ")}`;
  if (!gitMemo.has(key)) {
    let out = null;
    try {
      out = execFileSync("git", ["-C", cwd, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2000,
      }).trim();
    } catch {
      out = null;
    }
    gitMemo.set(key, out || null);
  }
  return gitMemo.get(key);
}

// The OUTERMOST `.coding-flow/` between `cwd` and the git toplevel (so a nested
// one cannot swap in a weaker policy), else the git toplevel, else `cwd` itself.
function projectRoot(cwd) {
  const start = path.resolve(cwd);
  const top = git(start, ["rev-parse", "--show-toplevel"]);
  let found = null;

  for (let dir = start; ; dir = path.dirname(dir)) {
    try {
      if (fs.statSync(path.join(dir, ".coding-flow")).isDirectory()) {
        found = dir;
        if (!top) {
          break; // no repo to bound the search: nearest wins
        }
      }
    } catch {
      // not here
    }
    if (dir === top || path.dirname(dir) === dir) {
      break;
    }
  }

  return found || top || start;
}

// When `root` is a linked worktree (its `.git` is a file), the primary checkout.
function primaryCheckout(root) {
  try {
    if (!fs.statSync(path.join(root, ".git")).isFile()) {
      return null;
    }
  } catch {
    return null;
  }

  const common = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);

  return common && path.basename(common) === ".git" ? path.dirname(path.resolve(common)) : null;
}

// realpath of the target, or of its nearest existing ancestor plus the segments
// that do not exist yet (a file about to be created). A dangling link is followed
// to where it WOULD create the file — `alias -> .env` with no `.env` yet is `.env`.
// A loop falls back to the lexical path: never throws.
function realPathOf(file, depth = 0, issues = null) {
  const rest = [];
  let dir = file;

  for (;;) {
    try {
      return path.join(fs.realpathSync.native(dir), ...rest);
    } catch (err) {
      if (!err || (err.code !== "ENOENT" && err.code !== "ENOTDIR")) {
        if (issues) {
          issues.push(`could not resolve a path (${(err && err.code) || "error"})`);
        }
        return file;
      }

      try {
        if (fs.lstatSync(dir).isSymbolicLink()) {
          if (depth > 16) {
            if (issues) {
              issues.push("could not resolve a path (too many links)");
            }
            return file;
          }
          const target = path.resolve(path.dirname(dir), fs.readlinkSync(dir));
          return path.join(realPathOf(target, depth + 1, issues), ...rest);
        }
      } catch {
        // not a link either: keep walking up
      }

      const parent = path.dirname(dir);
      if (parent === dir) {
        return file;
      }
      rest.unshift(path.basename(dir));
      dir = parent;
    }
  }
}

function expandHome(target) {
  const home = os.homedir();
  if (target === "~" || target.startsWith("~/")) {
    return path.join(home, target.slice(1));
  }
  const match = HOME_PREFIX.exec(target);
  return match ? path.join(home, target.slice(match[0].length)) : target;
}

function within(base, file) {
  const rel = path.relative(base, file);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)) ? rel : null;
}

// The policy-relative names a target answers to: lexical and real, each made
// relative to the project root, else to the primary checkout, else to $HOME.
function resolveTargets(ctx, target) {
  const lexical = path.resolve(ctx.cwd, expandHome(target));
  const real = realPathOf(lexical, 0, ctx.issues);
  const bases = [ctx.root, ctx.realRoot, ctx.primary, ctx.primary && realPathOf(ctx.primary), os.homedir()].filter(Boolean);
  const found = [];

  for (const file of [lexical, real]) {
    for (const base of bases) {
      const rel = within(base, file);
      if (rel !== null) {
        const relative = normalizePortable(rel);
        if (!found.some((entry) => entry.relative === relative)) {
          found.push({ relative });
        }
        break;
      }
    }
  }

  return found;
}

function hookCwd(hook, fallback) {
  return hook && typeof hook.cwd === "string" && hook.cwd ? hook.cwd : fallback;
}

function context(hook, root) {
  const cwd = hookCwd(hook, root);
  const top = projectRoot(cwd);
  return { cwd: path.resolve(cwd), root: top, realRoot: realPathOf(top), primary: primaryCheckout(top), issues: [] };
}

// Whether writing to this path is refused by policy. Returns the matched pattern,
// or null. On a case-insensitive filesystem `.ENV` is `.env`.
function blockedPathHit(relative, policy, caseInsensitive = false) {
  if (isAllowedEnvExample(relative)) {
    return null;
  }

  const fold = (value) => (caseInsensitive ? value.toLowerCase() : value);

  return policy.blockedPaths.find((pattern) => matchesPattern(fold(relative), fold(pattern))) || null;
}

// First blocked name among everything this target resolves to.
function firstHit(ctx, target, policy, caseInsensitive) {
  for (const entry of resolveTargets(ctx, target)) {
    const hit = blockedPathHit(entry.relative, policy, caseInsensitive);
    if (hit) {
      return { hit, relative: entry.relative };
    }
  }
  return null;
}

function viaNote(found, given) {
  const lexical = normalizePortable(given);
  return lexical && lexical !== found.relative ? ` (via ${lexical})` : "";
}

const CASE_INSENSITIVE = process.platform === "win32" || process.platform === "darwin";

// Pure decision: from the hook input + root, returns allow/deny + reason.
function decide(hook, root, { caseInsensitive = CASE_INSENSITIVE } = {}) {
  if (!hook || typeof hook !== "object") {
    return { decision: "unchecked", reason: "no parseable hook input" };
  }

  const toolName = hook.tool_name;
  const toolInput = hook.tool_input;

  if (toolName === "Bash") {
    return decideBash(toolInput, hook, root, caseInsensitive);
  }

  if (!WRITE_TOOLS.has(toolName)) {
    const input = toolInput && typeof toolInput === "object" ? toolInput : {};

    if (!isMcpTool(toolName) && !READ_ONLY_TOOLS.has(String(toolName || "").toLowerCase()) && PATH_FIELDS.some((field) => input[field])) {
      return { decision: "unchecked", reason: `tool ${String(toolName || "?").slice(0, 64)} is unknown to the guard and carries a path` };
    }

    return { decision: "allow", reason: `tool ${toolName || "?"} is not a write tool` };
  }

  const ctx = context(hook, root);
  const policy = loadPolicy(ctx.root);
  if (policy.unreadable) {
    ctx.issues.push("harness.json could not be read (default policy applied)");
  }
  const filePath = targetPath(toolInput);
  const found = filePath ? firstHit(ctx, filePath, policy, caseInsensitive) : null;
  const relative = filePath ? normalizePortable(path.relative(ctx.root, path.resolve(ctx.cwd, filePath))) : null;

  // Check 1 — path blocked by the policy.
  if (found) {
    return {
      decision: "deny",
      reason: `${found.relative}${viaNote(found, relative)} matches a blocked harness path (${found.hit}). Writing secrets or protected files at the tool boundary is refused by policy.`,
      path: found.relative,
    };
  }

  // Check 2 — secret in the written content. On an allowlisted path (docs,
  // fixtures, story files) only the exact credential formats apply: a
  // placeholder in an example is not a leak, an AWS key in one still is.
  const content = writtenContent(toolName, toolInput);

  if (content) {
    const secret = findSecretsInContent(content, getSecretPatterns(policy), {
      skipHeuristics: relative ? isHeuristicAllowlisted(relative, policy) : false,
      first: true,
    })[0];

    if (secret) {
      return {
        decision: "deny",
        reason: `Potential secret detected in written content (${secret.name}). Refused before it can reach the disk.`,
        path: relative,
      };
    }
  }

  // Nothing refused: what could not be judged (a missing path) is said, not allowed silently.
  if (!filePath) {
    return { decision: "unchecked", reason: `${toolName} carried no target path` };
  }

  if (ctx.issues.length) {
    return { decision: "unchecked", reason: ctx.issues[0] };
  }

  return { decision: "allow", reason: "no blocked path or secret detected" };
}

// A shell call is checked on what it would WRITE, and on the credential formats
// visible in the command text. Heuristic patterns are not applied to a command
// line: `psql "password=…"` and `export TOKEN=$(…)` are normal, and a guard that
// cries wolf on them is a guard people route around.
function decideBash(toolInput, hook, root, caseInsensitive) {
  const command = toolInput && typeof toolInput.command === "string" ? toolInput.command : "";

  if (toolInput && typeof toolInput === "object" && "command" in toolInput && typeof toolInput.command !== "string") {
    return { decision: "unchecked", reason: "Bash carried no readable command" };
  }

  if (!command.trim()) {
    return { decision: "allow", reason: "no command to inspect" };
  }

  const ctx = context(hook, root);
  const policy = loadPolicy(ctx.root);
  if (policy.unreadable) {
    ctx.issues.push("harness.json could not be read (default policy applied)");
  }

  for (const entry of shellWrites(command, ctx.cwd)) {
    if (entry.unchecked) {
      ctx.issues.push(entry.unchecked);
      continue;
    }

    const target = entry.target;
    const found = firstHit(ctx, target, policy, caseInsensitive);

    if (found) {
      const what =
        entry.kind === "alias"
          ? `this command aliases ${found.relative}${viaNote(found, target)} (a link to it would be a way around the policy), which matches a blocked harness path (${found.hit}).`
          : entry.kind === "inline"
            ? `this inline code names ${found.relative}${viaNote(found, target)}, which matches a blocked harness path (${found.hit}). An interpreter is not a way around the policy.`
            : `this command writes to ${found.relative}${viaNote(found, target)}, which matches a blocked harness path (${found.hit}). Shell redirection is not a way around the policy.`;

      return { decision: "deny", reason: what, path: found.relative };
    }
  }

  const secret = findSecretsInContent(command, getSecretPatterns(policy), {
    skipHeuristics: true,
    first: true,
  })[0];

  if (secret) {
    return {
      decision: "deny",
      reason: `Potential secret detected in the command itself (${secret.name}). Refused before it can reach the disk.`,
      path: null,
    };
  }

  if (ctx.issues.length) {
    return { decision: "unchecked", reason: ctx.issues[0] };
  }

  return { decision: "allow", reason: "no blocked write target or secret detected" };
}

// A denial used to be exit 2 and a line on stderr, and then nothing. That is
// the one event most worth keeping: when the guard is *wrong*, the person it
// blocked has no artifact to send and no way to show what happened — and a gate
// nobody can argue with is a gate they turn off. One JSONL line per denial, read
// back by `ai-flow report`.
//
// Three properties this must never lose, because it runs inside the hot path of
// a security check: it never throws (a full disk must not turn a deny into a
// crash), it never delays the decision (the write already happened by the time
// we exit), and it never records the secret itself — `decide` reports the
// pattern's name, never the matched text.
const DENIAL_LOG_MAX_BYTES = 256 * 1024;

// Inside the project: relative. Outside it: a marker, not a `../..` chain that
// spells out where the project sits.
function loggedPath(root, target) {
  const relative = path.isAbsolute(target) ? path.relative(root, target) : path.normalize(target);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ? "(outside project)" : normalizePortable(relative);
}

function recordEvent(file, { root, hook, result }) {
  try {
    const dir = path.join(root, ".coding-flow");

    if (!fs.existsSync(dir)) {
      return;
    }

    const logPath = path.join(dir, file);

    // Bounded on purpose: this is a diagnostic tail, not an audit ledger. The
    // audit ledger is `ai-flow audit`, and it is opt-in.
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > DENIAL_LOG_MAX_BYTES) {
      const kept = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean).slice(-200);
      fs.writeFileSync(logPath, kept.length ? `${kept.join("\n")}\n` : "");
    }

    // A hook that made the decision throw can throw here too: read it defensively.
    const field = (read) => {
      try {
        return read() || null;
      } catch {
        return null;
      }
    };
    const target = result.path || field(() => hook.tool_input.file_path);

    fs.appendFileSync(
      logPath,
      `${JSON.stringify({
        at: new Date().toISOString(),
        tool: field(() => hook.tool_name),
        // Relative when it is inside the project, so the log carries no home
        // directory and no username. `report` redacts anything left over.
        path: target ? loggedPath(root, target) : null,
        reason: result.reason,
      })}\n`,
    );
  } catch {
    // Diagnostics are never worth failing a security decision over.
  }
}

function recordDenial(event) {
  recordEvent("denials.jsonl", event);
}

// The guard could not judge this call. Not a refusal, so not in `denials.jsonl`
// (whose readers mean "the guard refused this"); a separate file `report` and
// `doctor` read, so silence is never mistaken for protection.
function recordUnchecked(event) {
  recordEvent("guard-unchecked.jsonl", event);
}

// Appended to what the agent reads (never to the denial log). Observed on
// OpenCode: refused `.env`, a model wrote the same content to `env` instead. The
// guard cannot see intent, so it says it plainly to the one that can.
const AGENT_ADVICE =
  "Do not retry this under another name, path or tool to get around the guard: tell the user what was refused and why.";

function forAgent(reason) {
  return `${reason} ${AGENT_ADVICE}`;
}

// In `strict`, "the guard could not check this" is a refusal: a hard boundary has
// no third outcome. The one exemption is the policy file itself through a write tool,
// so strictness alone can never lock the user out of switching back.
const STRICT_PREFIX = "not checked, refused in strict mode:";

function strictOutcome(result, hook, root) {
  if (!result || result.decision !== "unchecked") {
    return result;
  }

  let strict = false;
  try {
    strict = loadPolicy(root).mode === "strict";
  } catch {
    strict = false;
  }

  const input = hook && hook.tool_input;
  const file = input && typeof (input.file_path || input.path) === "string" ? String(input.file_path || input.path) : "";
  if (!strict || (WRITE_TOOLS.has(hook && hook.tool_name) && /(^|[\\/])\.coding-flow[\\/]harness\.json$/.test(file))) {
    return result;
  }

  return { decision: "deny", reason: `${STRICT_PREFIX} ${result.reason}`, path: null };
}

function guardCommand({ getFlagValue, flags }) {
  const inputFile = getFlagValue("--input", null);
  const raw = readHookInput({ inputFile });
  const hook = parseHookInput(raw);
  // Root: cwd provided by the hook if present, otherwise the process cwd.
  const root = projectRoot(hookCwd(hook, process.cwd()));

  let result;
  try {
    result = decide(hook, root);
  } catch (err) {
    result = { decision: "unchecked", reason: `guard error: ${(err && (err.code || err.name)) || "unknown"}` };
  }

  result = strictOutcome(result, hook, root);

  if (result.decision === "unchecked") {
    recordUnchecked({ root, hook, result });
    // Hosts that spawn the guard (OpenCode fallback) forward this line.
    process.stderr.write(`coding-flow guard: ${result.reason}; this write was NOT checked\n`);
  }

  if (result.decision === "deny") {
    // Hook decision (stdout) + blocking message (stderr) + exit 2: we cover both
    // documented paths to stay robust across Claude Code versions.
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: forAgent(result.reason),
        },
        systemMessage: result.reason,
      })}\n`,
    );
    process.stderr.write(`coding-flow guard: ${forAgent(result.reason)}\n`);
    recordDenial({ root, hook, result });
    process.exit(2);
  }

  if (flags.has("--json")) {
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
        reason: result.reason,
      })}\n`,
    );
  }

  process.exit(0);
}

// The same decision for a host that loads this module in its own process (the
// OpenCode plugin) instead of spawning `ai-flow guard`: decide, record a denial,
// return the result. Never throws — a guard that crashes its host gets removed.
function evaluate(hook, root) {
  try {
    const result = strictOutcome(decide(hook, root), hook, projectRoot(hookCwd(hook, root)));

    if (result.decision === "deny") {
      recordDenial({ root: projectRoot(hookCwd(hook, root)), hook, result });
      return { ...result, reason: forAgent(result.reason) };
    }

    if (result.decision === "unchecked") {
      recordUnchecked({ root: projectRoot(hookCwd(hook, root)), hook, result });
    }

    return result;
  } catch (err) {
    const result = strictOutcome({ decision: "unchecked", reason: `guard error: ${(err && (err.code || err.name)) || "unknown"}` }, hook, root);
    if (result.decision === "deny") {
      recordDenial({ root, hook, result });
      return { ...result, reason: forAgent(result.reason) };
    }
    recordUnchecked({ root, hook, result });
    return result;
  }
}

module.exports = { guardCommand, decide, evaluate, recordUnchecked, shellWriteTargets, shellWrites, loadPolicy };
