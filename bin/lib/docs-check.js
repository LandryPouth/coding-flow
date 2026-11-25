"use strict";

// `ai-flow docs check [--json] [--changed <base>] [paths...]` (story 26-03):
// the backticked repository paths, the npm/pnpm script names and the relative
// links a doc names that no longer resolve, each with its line and, for a
// rename, the closest existing name. Read-only; no command a doc shows is ever
// run. Mechanical on purpose: three checks with near-zero false positives beat
// a fuzzy one nobody trusts, so anything this cannot judge is skipped, never
// reported (the skips are listed in docs/rules-and-limits.md).

const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const { cwd } = require("./context");
const { log, fail, matchesPattern, normalizePortable } = require("./util");
const { readConfig } = require("./config");
const { defaultOf } = require("./rules-registry");
const { classifyLines, inlineParts, linkTargets, anchorsOf, SHELL_INFOS } = require("./docs-markdown");

// A list of non-empty strings, or null (an empty or invalid list reads as unset).
const strings = (value) => {
  const list = Array.isArray(value) ? value.filter((v) => typeof v === "string" && v.trim()) : [];
  return list.length > 0 ? list : null;
};

// The settings in force: each key a list of non-empty strings, else its default.
function docsCheckSettings(config) {
  const docs = config && typeof config.docs === "object" && config.docs ? config.docs : null;
  const check = docs && typeof docs.check === "object" && docs.check ? docs.check : null;
  const read = (key) => (check && strings(check[key])) || defaultOf(`docs.check.${key}`);
  return { include: read("include"), exclude: read("exclude"), ignorePaths: read("ignorePaths") };
}

function git(args, root) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

// `docs/**/*.md` also matches `docs/a.md`: `**/` may be empty.
function matchesGlob(file, pattern) {
  return matchesPattern(file, pattern) || (pattern.includes("/**/") && matchesPattern(file, pattern.replace("/**/", "/")));
}

// Tracked and untracked-not-ignored files that exist; outside git, a walk.
function listFiles(root) {
  const listed = git(["ls-files", "-co", "--exclude-standard", "-z"], root);
  if (listed !== null) return [...new Set(listed.split("\0").filter(Boolean))].filter((f) => fs.existsSync(path.join(root, f)));
  return walk(root, "");
}

function walk(root, rel) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, rel || "."), { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(root, child));
    else out.push(child);
  }
  return out;
}

function selectDocs(files, settings, explicit) {
  const isDoc = (file) => file.endsWith(".md");
  if (explicit.length > 0) {
    const wanted = explicit.map((p) => normalizePortable(p).replace(/^\.\//, "").replace(/\/+$/, ""));
    return files.filter((f) => isDoc(f) && wanted.some((w) => f === w || f.startsWith(`${w}/`)));
  }
  return files.filter((f) => isDoc(f) && settings.include.some((g) => matchesGlob(f, g)) && !settings.exclude.some((g) => matchesGlob(f, g)));
}

// A backticked span that names a path, normalised, or null: placeholders
// (`<name>`, `…`, a segment like `NN`, `x` or `YYYY`), globs, URLs, flags,
// home/env/absolute paths and bare names are not judged; `file:12` and
// `file::test` are read as `file`.
function pathCandidate(span) {
  if (!span || /[\s<>*?[\]{}()|;,'"=\\`…]/.test(span) || span.includes("://") || span.includes("...")) return null;
  if ("-~$/@#".includes(span[0]) || span.startsWith("http") || span.startsWith("www.")) return null;
  let value = span;
  const test = value.indexOf("::");
  if (test !== -1) value = value.slice(0, test);
  value = value.replace(/:\d+(?:-\d+)?(?::\d+)?$/, "");
  if (value.includes(":") || value.includes("#") || !value.includes("/") || value === ".git" || value.startsWith(".git/")) return null;
  if (value.split(/[/.\-_]/).some((word) => PLACEHOLDER_WORDS.has(word))) return null;
  return value;
}

const PLACEHOLDER_WORDS = new Set(["N", "NN", "NNN", "X", "XX", "XXX", "x", "xx", "YYYY", "MM", "DD", "name", "slug", "foo", "bar"]);

// Where a named path may live, and whether it is judged at all. A `./` or
// `../` path is read from the doc's folder and from the root, and judged only
// when both stay inside the repository (`../sibling` is another checkout).
// Any other path is judged only when its first segment exists at the root or
// in the doc's folder, so another project's example path is not.
function pathPlaces(value, docDir, root) {
  const norm = (p) => normalizePortable(path.posix.normalize(p));
  const places = [norm(value), norm(path.posix.join(docDir, value))];
  if (value.startsWith("./") || value.startsWith("../")) return { judged: places.every(insideRoot), places: places.filter(insideRoot) };
  const first = value.split("/")[0];
  const judged = [".", docDir].some((base) => fs.existsSync(path.join(root, base, first)));
  return { judged, places };
}

// Every path, file or folder, that ends a tracked path after a `/`: a path a
// doc names may live under another root of the repository — a package, a
// template, a fixture — and is not missing then.
function suffixesOf(files) {
  const out = new Set();
  for (const file of files) {
    const parts = file.split("/");
    for (let from = 1; from < parts.length; from += 1) {
      for (let to = from + 1; to <= parts.length; to += 1) out.add(parts.slice(from, to).join("/"));
    }
  }
  return out;
}

const insideRoot = (rel) => rel !== ".." && !rel.startsWith("../") && !path.isAbsolute(rel);


// Levenshtein distance, or Infinity once it exceeds `max` (banded).
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return Infinity;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, current[j]);
    }
    if (best > max) return Infinity;
    previous = current;
  }
  return previous[b.length];
}

// The closest name within a small edit distance (a typo), or null. For a
// path, the one file elsewhere with the same base name (a move) wins.
function closest(target, names, { moves = false } = {}) {
  if (moves) {
    const base = path.posix.basename(target);
    const moved = names.filter((name) => path.posix.basename(name) === base);
    if (moved.length === 1) return moved[0];
  }
  return pick(target, names, Math.max(1, Math.floor(target.length * 0.15)));
}

// Renames git recorded (history, then staged and unstaged), old → new; read
// once, only when a path is missing.
function renameMap(root) {
  const map = new Map();
  const read = (args) => {
    const out = git(args, root);
    if (!out) return;
    for (const line of out.split("\n")) {
      const [status, from, to] = line.split("\t");
      if (status && status.startsWith("R") && from && to && !map.has(from)) map.set(from, to);
    }
  };
  read(["diff", "-M", "--diff-filter=R", "--name-status", "HEAD"]);
  read(["log", "-M", "--diff-filter=R", "--name-status", "--format="]);
  return map;
}

// Where a missing path went: its recorded renames followed to a file that
// exists, else a move or a typo.
function suggestPath(missing, context) {
  if (!context.suggest) return null;
  let current = missing;
  const seen = new Set();
  while (context.renames().has(current) && !seen.has(current)) {
    seen.add(current);
    current = context.renames().get(current);
    if (fs.existsSync(path.join(context.root, current))) return current;
  }
  return closest(missing, context.files, { moves: true });
}

function pick(target, names, max) {
  let best = null;
  let bestDistance = Infinity;
  for (const name of names) {
    const d = distance(target, name, Math.min(max, bestDistance));
    if (d < bestDistance || (d === bestDistance && best !== null && name < best)) {
      best = name;
      bestDistance = d;
    }
  }
  return bestDistance <= max ? best : null;
}

const SEPARATORS = new Set(["&&", "||", ";", "|", "&"]);
const ELSEWHERE = new Set(["-w", "--workspace", "--workspaces", "--prefix", "-C", "--dir", "-r", "--recursive", "-ws"]);

// `npm run <name>`, `pnpm run <name>` and `pnpm --filter <pkg> run <name>` in a
// piece of code. A call that runs elsewhere (workspace flags, a directory) or
// names its script through a variable or a placeholder is not judged.
function scriptCalls(text) {
  const tokens = text.split(/[ \t]+/).filter(Boolean);
  const calls = [];
  tokens.forEach((tool, index) => {
    if (tool !== "npm" && tool !== "pnpm") return;
    const call = readCall(tokens, index + 1, tool);
    if (call) calls.push(call);
  });
  return calls;
}

function readCall(tokens, from, tool) {
  let filter = null;
  let at = from;
  for (; at < tokens.length; at += 1) {
    const token = tokens[at];
    if (token === "run" || token === "run-script") break;
    if (SEPARATORS.has(token) || !token.startsWith("-")) return null;
    if (tool === "pnpm" && (token === "--filter" || token === "-F")) filter = tokens[++at] || null;
    else if (tool === "pnpm" && token.startsWith("--filter=")) filter = token.slice(9);
    else if (ELSEWHERE.has(token.split("=")[0])) return null;
  }
  let nameAt = at + 1;
  while (nameAt < tokens.length && tokens[nameAt].startsWith("-")) nameAt += 1;
  const name = trimQuotes(tokens[nameAt] || "", "\"';),.");
  if (at >= tokens.length || !name || SEPARATORS.has(name) || /[$<>{}*`]/.test(name)) return null;
  if (filter !== null && (!filter || /[*{}[\]^!]|\.\.\./.test(filter))) return null;
  return { tool, filter: filter && trimQuotes(filter, "\"'"), name };
}

// Drops one leading quote and every trailing character of `tail`.
function trimQuotes(token, tail) {
  const start = token[0] === '"' || token[0] === "'" ? 1 : 0;
  let end = token.length;
  while (end > start && tail.includes(token[end - 1])) end -= 1;
  return token.slice(start, end);
}

// Every package.json of the repository: by directory and by package name.
function readPackages(files, root) {
  const byDir = new Map();
  const byName = new Map();
  for (const file of files) {
    if (path.posix.basename(file) !== "package.json" || file.split("/").includes("node_modules")) continue;
    let json;
    try {
      json = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
    } catch {
      continue;
    }
    const entry = { scripts: json && typeof json.scripts === "object" && json.scripts ? json.scripts : {} };
    byDir.set(path.posix.dirname(file), entry);
    if (json && typeof json.name === "string") byName.set(json.name, entry);
  }
  return { byDir, byName };
}

// The package a call's script is looked up in, or null when it cannot be told.
function packageFor(call, docDir, packages) {
  if (call.filter) {
    if (call.filter.startsWith("./") || call.filter.startsWith("../")) {
      return packages.byDir.get(normalizePortable(path.posix.normalize(call.filter))) || null;
    }
    return packages.byName.get(call.filter) || null;
  }
  for (let dir = docDir; ; dir = path.posix.dirname(dir)) {
    if (packages.byDir.has(dir)) return packages.byDir.get(dir);
    if (dir === "." || dir === "/" || dir === "") return null;
  }
}

function scriptFindings(text, docDir, packages) {
  const out = [];
  for (const call of scriptCalls(text)) {
    const pkg = packageFor(call, docDir, packages);
    if (!pkg || Object.prototype.hasOwnProperty.call(pkg.scripts, call.name)) continue;
    out.push({
      kind: "script",
      target: call.filter ? `${call.filter}: ${call.name}` : call.name,
      suggestion: closest(call.name, Object.keys(pkg.scripts)),
    });
  }
  return out;
}

// One doc's findings, and the repository paths it mentions (for --changed).
function scanDoc(doc, context) {
  const lines = fs.readFileSync(path.join(context.root, doc), "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
  const kinds = classifyLines(lines);
  const docDir = path.posix.dirname(doc);
  const state = { comment: false };
  const findings = [];
  const mentions = new Set();
  const add = (line, found) => found.forEach((f) => findings.push({ file: doc, line, ...f }));

  lines.forEach((line, index) => {
    const kind = kinds[index];
    if (kind.kind !== "prose") {
      if (state.comment && line.includes("-->")) state.comment = false;
      if (kind.kind === "code" && SHELL_INFOS.has(kind.info)) add(index + 1, scriptFindings(line, docDir, context.packages));
      return;
    }
    const { spans, prose } = inlineParts(line, state);
    for (const span of spans) {
      add(index + 1, scriptFindings(span.text, docDir, context.packages));
      add(index + 1, pathFindings(span.text, doc, context, mentions));
    }
    for (const target of linkTargets(prose)) add(index + 1, linkFindings(target, doc, context, mentions));
  });

  return { findings, mentions };
}

function pathFindings(span, doc, context, mentions) {
  const value = pathCandidate(span);
  if (!value) return [];
  const { judged, places } = pathPlaces(value, path.posix.dirname(doc), context.root);
  const inside = places.filter(insideRoot);
  inside.forEach((place) => mentions.add(place.replace(/\/+$/, "")));
  if (!judged || inside.length === 0 || inside.some((place) => fs.existsSync(path.join(context.root, place)))) return [];
  if (context.suffixes().has(path.posix.normalize(value).replace(/^\.\//, "").replace(/\/+$/, ""))) return [];
  if (inside.some((place) => context.ignoredByConfig(place)) || context.namedByCode(value)) return [];
  return [{ kind: "path", target: value, places: inside, suggestion: suggestPath(inside[0].replace(/\/+$/, ""), context) }];
}

function linkFindings(raw, doc, context, mentions) {
  let dest;
  try {
    dest = decodeURI(raw);
  } catch {
    dest = raw;
  }
  if (!dest || /^[a-z][a-z0-9+.-]*:/i.test(dest) || dest.startsWith("//") || /[<>{}$]/.test(dest)) return [];
  const hash = dest.indexOf("#");
  const file = (hash === -1 ? dest : dest.slice(0, hash)).split("?")[0];
  const anchor = hash === -1 ? null : dest.slice(hash + 1);
  const resolved = file === "" ? doc : normalizePortable(path.posix.normalize(file.startsWith("/") ? file.slice(1) : path.posix.join(path.posix.dirname(doc), file)));
  if (!insideRoot(resolved)) return [];
  if (file !== "") mentions.add(resolved.replace(/\/+$/, ""));
  const full = path.join(context.root, resolved);
  if (!fs.existsSync(full)) {
    if (context.ignoredByConfig(resolved)) return [];
    return [{ kind: "link", target: raw, places: [resolved], suggestion: suggestPath(resolved, context) }];
  }
  if (!anchor || !resolved.endsWith(".md") || !fs.statSync(full).isFile()) return [];
  const anchors = context.anchors(resolved);
  if (anchors.has(anchor) || anchors.has(anchor.toLowerCase())) return [];
  return [{ kind: "anchor", target: `${file}#${anchor}`, suggestion: closest(anchor.toLowerCase(), [...anchors]) }];
}

// What every doc's scan shares: the file list, the packages, the anchors of a
// page (read once), and whether a missing path is generated or ignored.
function scanContext(root, settings, suggest) {
  const files = listFiles(root);
  const anchorCache = new Map();
  const inGit = git(["rev-parse", "--is-inside-work-tree"], root) !== null;
  let renames = null;
  let suffixes = null;
  let corpus = null;
  return {
    // A path the project's own code, config or tests name (anything but
    // Markdown) is one it writes, reads or installs: not a stale reference.
    namedByCode(value) {
      if (corpus === null) corpus = codeCorpus(root, files);
      return containsPath(corpus, value.replace(/^\.\//, "").replace(/\/+$/, ""));
    },
    suffixes() {
      if (!suffixes) suffixes = suffixesOf(files);
      return suffixes;
    },
    renames() {
      if (!renames) renames = inGit ? renameMap(root) : new Map();
      return renames;
    },
    suggest,
    root,
    files,
    packages: readPackages(files, root),
    anchors(file) {
      if (!anchorCache.has(file)) anchorCache.set(file, anchorsOf(fs.readFileSync(path.join(root, file), "utf8")));
      return anchorCache.get(file);
    },
    ignoredByConfig(place) {
      return settings.ignorePaths.some((glob) => matchesGlob(place, glob));
    },
  };
}

// The places git ignores (generated output), asked in one call: a missing
// place named without its trailing slash is asked as a folder too.
function ignoredPlaces(root, places) {
  if (places.length === 0 || git(["rev-parse", "--is-inside-work-tree"], root) === null) return new Set();
  const asked = [...new Set(places.flatMap((p) => [p, `${p.replace(/\/+$/, "")}/`]))];
  const res = spawnSync("git", ["check-ignore", "--no-index", "--stdin", "-z"], { cwd: root, input: `${asked.join("\0")}\0`, encoding: "utf8" });
  const out = new Set();
  for (const name of (res.stdout || "").split("\0").filter(Boolean)) out.add(name.replace(/\/+$/, ""));
  return out;
}

const CORPUS_FILE_LIMIT = 1024 * 1024;
const isPathChar = (char) => char !== undefined && /[\w.\-/@]/.test(char);

// `value` named as a whole path in the corpus: not inside a longer name, and
// not as the tail of another path (the suffix rule's case).
function containsPath(corpus, value) {
  for (let at = corpus.indexOf(value); at !== -1; at = corpus.indexOf(value, at + 1)) {
    const after = corpus[at + value.length];
    if (!isPathChar(corpus[at - 1]) && (!isPathChar(after) || after === "/")) return true;
  }
  return false;
}

function codeCorpus(root, files) {
  const parts = [];
  for (const file of files) {
    if (file.endsWith(".md") || file.split("/").includes("node_modules")) continue;
    try {
      const full = path.join(root, file);
      if (fs.statSync(full).size > CORPUS_FILE_LIMIT) continue;
      const text = fs.readFileSync(full, "utf8");
      if (!text.includes("\0")) parts.push(text);
    } catch {
      // unreadable: not part of the corpus
    }
  }
  return parts.join("\n");
}

// Paths changed since `base` (committed, staged, unstaged and new), or null
// when the base cannot be read.
function changedSince(base, root) {
  if (git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`], root) === null) return null;
  const diff = git(["diff", "--name-only", "--no-renames", "-z", base], root);
  const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"], root);
  if (diff === null) return null;
  return new Set(`${diff}\0${untracked || ""}`.split("\0").filter(Boolean));
}

function scanDocs({ root = cwd, explicit = [], changed = null, suggest = true } = {}) {
  const settings = docsCheckSettings(readConfig(root));
  const context = scanContext(root, settings, suggest);
  const docs = selectDocs(context.files, settings, explicit);
  const scanned = docs.map((doc) => ({ doc, ...scanDoc(doc, context) }));
  const kept = changed ? scanned.filter(({ mentions }) => [...mentions].some((m) => changed.has(m))) : scanned;
  const findings = kept.flatMap((entry) => entry.findings);
  const ignored = ignoredPlaces(root, findings.flatMap((f) => f.places || []));
  const generated = (f) => (f.places || []).some((p) => ignored.has(p.replace(/\/+$/, "")));
  const result = { docs: kept.length, findings: findings.filter((f) => !generated(f)).map(({ places, ...f }) => f) };
  return Object.defineProperty(result, "selected", { value: docs.length });
}

const KNOWN_FLAGS = new Set(["--json", "--changed"]);

function docsCheckCommand({ commandArgs, flags, getFlagValue }) {
  if (commandArgs[0] !== "check") fail('usage: ai-flow docs check [--json] [--changed <base>] [paths...]');
  const rest = commandArgs.slice(1);
  const changedBase = getFlagValue("--changed", null);
  const unknown = rest.find((arg) => arg.startsWith("-") && !KNOWN_FLAGS.has(arg.split("=")[0]));
  if (unknown) fail(`unknown option ${unknown} for "docs check".`);
  if (flags.has("--changed") && !changedBase) fail("--changed needs a base: ai-flow docs check --changed <base>.");

  let changed = null;
  if (changedBase) {
    changed = changedSince(changedBase, cwd);
    if (!changed) fail(`cannot read the changes since "${changedBase}" (not a commit here).`);
  }
  const explicit = rest.filter((arg, i) => !arg.startsWith("-") && rest[i - 1] !== "--changed");
  const result = scanDocs({ root: cwd, explicit, changed });
  if (explicit.length > 0 && result.selected === 0) fail(`no Markdown doc under ${explicit.join(", ")}.`);
  if (flags.has("--json")) log(JSON.stringify(result, null, 2));
  else printReport(result);
  if (result.findings.length > 0) process.exitCode = 1;
}

function printReport({ docs, findings }) {
  if (findings.length === 0) {
    log(`docs check: no stale path, script or link in ${docs} doc(s).`);
    return;
  }
  log(`docs check: ${findings.length} finding(s) in ${docs} doc(s) read.`);
  for (const f of findings) {
    log(`  ${f.file}:${f.line}  ${f.kind.padEnd(6)} ${f.target}${f.suggestion ? `  (did you mean ${f.suggestion}?)` : ""}`);
  }
}

module.exports = { docsCheckCommand, scanDocs, docsCheckSettings, pathCandidate, scriptCalls, closest };
