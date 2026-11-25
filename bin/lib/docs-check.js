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
const { log, matchesPattern, normalizePortable } = require("./util");
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
  return walk(root);
}

const WALK_LIMIT = 20000;

// Outside git: the files under the folder the check runs in, never from the
// filesystem root, and at most WALK_LIMIT of them (a home folder is not a project).
function walk(root) {
  if (path.resolve(root) === path.parse(path.resolve(root)).root) return [];
  const out = [];
  const pending = [""];
  while (pending.length > 0 && out.length < WALK_LIMIT) {
    const rel = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, rel || "."), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) pending.push(child);
      else if (out.length < WALK_LIMIT) out.push(child);
    }
  }
  return out.sort();
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
// (`<name>`, `…`, an upper-case word like `NN`, `X` or `YYYY`), globs, URLs,
// flags, home/env/absolute paths and bare names are not judged; `file:12`,
// `file::test`, `file#anchor` and `file#L10` are read as `file`. A route
// segment (`[locale]`, `[...slug]`, `(group)`) is a folder name, not a glob.
function pathCandidate(span) {
  if (!span || /[\s<>*?{}|;,'"=\\`…]/.test(span) || span.includes("://")) return null;
  if ("-~$/@#".includes(span[0]) || span.startsWith("http") || span.startsWith("www.")) return null;
  let value = span;
  for (const mark of ["::", "#"]) {
    const at = value.indexOf(mark);
    if (at !== -1) value = value.slice(0, at);
  }
  value = value.replace(/:\d+(?:-\d+)?(?::\d+)?$/, "");
  if (value.includes(":") || !value.includes("/") || value === ".git" || value.startsWith(".git/")) return null;
  const plain = withoutRouteSegments(value);
  if (plain.includes("...")) return null;
  if (plain.split(/[/.\-_]/).some((word) => PLACEHOLDER_WORDS.has(word))) return null;
  return value;
}

const ROUTE_SEGMENT = /^(?:\[\[?(?:\.\.\.)?[\w-]+\]\]?|\([\w.-]+\))$/;
const withoutRouteSegments = (value) => value.split("/").filter((segment) => !ROUTE_SEGMENT.test(segment)).join("/");

// A bracket that is not a whole route segment (`[id].tsx`, `[ab]`): judged
// only when the literal path exists, else read as a pattern and skipped.
const isPattern = (value) => /[[\]()]/.test(withoutRouteSegments(value));

// Upper case only: `epic-NN-name` is a pattern, `src/x-name.js` or `lib/slug.ts` a file.
const PLACEHOLDER_WORDS = new Set(["N", "NN", "NNN", "X", "XX", "XXX", "YYYY", "MM", "DD"]);

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


// Edit distance with adjacent swaps (optimal string alignment), or Infinity
// once it exceeds `max` (banded).
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return Infinity;
  let before = null;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (before && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) current[j] = Math.min(current[j], before[j - 2] + 1);
      best = Math.min(best, current[j]);
    }
    if (best > max) return Infinity;
    before = previous;
    previous = current;
  }
  return previous[b.length];
}

// The closest name within a small edit distance (a typo), or null.
function closest(target, names) {
  return pick(target, names, Math.max(1, Math.floor(target.length * 0.15)));
}

// What git recorded for a path, newest first (uncommitted, then history):
// renamed to `to`, or deleted in `deleted` (a short SHA, or "the working tree");
// `order` is its rank, 0 the newest.
// Read once, only when a path is missing.
function pathHistory(root) {
  const map = new Map();
  const read = (args, where) => {
    const out = git(args, root);
    if (!out) return;
    let sha = where;
    for (const line of out.split("\n")) {
      if (line.startsWith("\u0001")) sha = line.slice(1);
      const [status, from, to] = line.split("\t");
      if (!status || !from || map.has(from)) continue;
      if (status.startsWith("R") && to) map.set(from, { to, order: map.size });
      else if (status === "D") map.set(from, { deleted: sha, order: map.size });
    }
  };
  read(["diff", "-M", "--diff-filter=RD", "--name-status", "HEAD"], "the working tree");
  read(["log", "-M", "--diff-filter=RD", "--name-status", "--format=%x01%h"], null);
  return map;
}

// Where a missing path went: its recorded renames followed to a path that
// exists; nothing when git recorded it deleted; else the one same-named file
// elsewhere (a move), else a typo among its folder's entries and its namesakes.
function suggestPath(missing, context) {
  if (!context.suggest) return { suggestion: null };
  let current = missing;
  const seen = new Set();
  for (let event = recordedEvent(current, context); event && !seen.has(current); event = recordedEvent(current, context)) {
    seen.add(current);
    if (event.deleted !== undefined) return { suggestion: null, deleted: event.deleted };
    current = event.to;
    if (fs.existsSync(path.join(context.root, current))) return { suggestion: current };
  }
  const { byBase, byDir } = context.index();
  const namesakes = (byBase.get(path.posix.basename(missing)) || []).filter((name) => name !== missing);
  if (namesakes.length === 1) return { suggestion: namesakes[0] };
  // A typo in the name, among the folder's entries; else in the folder, among namesakes.
  const dir = path.posix.dirname(missing);
  const join = (folder, name) => (folder === "." ? name : `${folder}/${name}`);
  const name = closest(path.posix.basename(missing), (byDir.get(dir) || []).map((entry) => path.posix.basename(entry)));
  if (name) return { suggestion: join(dir, name) };
  const folder = closest(dir, namesakes.map((entry) => path.posix.dirname(entry)));
  return { suggestion: folder ? join(folder, path.posix.basename(missing)) : null };
}

// The latest event git recorded for a path, or for a folder through the files
// it held: `{deleted}`, or `{to}` (a folder's new place, when its newest file
// event is a rename that kept the file's place inside it). Null when none.
function recordedEvent(place, context) {
  const history = context.history();
  if (history.has(place)) return history.get(place);
  const prefix = `${place}/`;
  let newest = null;
  let newestFrom = null;
  for (const [from, event] of history) {
    if (from.startsWith(prefix) && (newest === null || event.order < newest.order)) {
      newest = event;
      newestFrom = from;
    }
  }
  if (!newest || newest.deleted !== undefined) return newest;
  const rest = newestFrom.slice(prefix.length);
  return newest.to.endsWith(`/${rest}`) ? { to: newest.to.slice(0, -rest.length - 1) } : null;
}

// Every tracked file and folder by base name and by parent folder: the
// candidates a suggestion is measured against, not the whole repository.
function entryIndex(files) {
  const byBase = new Map();
  const byDir = new Map();
  const seen = new Set();
  const add = (entry) => {
    if (seen.has(entry)) return;
    seen.add(entry);
    for (const [map, key] of [[byBase, path.posix.basename(entry)], [byDir, path.posix.dirname(entry)]]) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(entry);
    }
  };
  for (const file of files) {
    const parts = file.split("/");
    for (let end = 1; end <= parts.length; end += 1) add(parts.slice(0, end).join("/"));
  }
  return { byBase, byDir };
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
const WORKSPACE_FLAGS = new Set(["-w", "--workspace"]);
const DIR_FLAGS = new Set(["--prefix", "-C", "--dir"]);
const FILTER_FLAGS = new Set(["--filter", "-F"]);
const EVERYWHERE_FLAGS = new Set(["-r", "--recursive", "--workspaces", "-ws", "--include-workspace-root"]);
const UNREADABLE = /[$<>{}*`]/;

// `npm run <name>`, `pnpm run <name>` and `pnpm --filter <pkg> run <name>` in a
// piece of code, each with where it runs: `place.cwd` is the folder a `cd`
// or `pushd` moved to (kept across the lines of one code block), undefined
// before any, null once one left the repository or cannot be read. A `cd`
// inside `( … )` ends at the parenthesis; `popd` returns; a `#` starts a
// comment. A call that runs in every package or names its script through a
// variable or a placeholder is not judged.
function scriptCalls(text, place = {}) {
  const tokens = text.split(/[ \t]+/).filter(Boolean);
  const comment = tokens.findIndex((token) => token.startsWith("#"));
  if (comment !== -1) tokens.length = comment;
  const subshells = [];
  const calls = [];
  tokens.forEach((raw, index) => {
    const tool = raw.startsWith("(") ? raw.slice(1) : raw;
    if (raw.startsWith("(")) subshells.push(place.cwd);
    if (tool === "cd") place.cwd = movedTo(place.cwd, tokens[index + 1]);
    if (tool === "pushd") (place.stack = place.stack || []).push(place.cwd);
    if (tool === "pushd") place.cwd = movedTo(place.cwd, tokens[index + 1]);
    if (tool === "popd" && place.stack && place.stack.length > 0) place.cwd = place.stack.pop();
    if (tool === "npm" || tool === "pnpm") {
      const call = readCall(tokens, index + 1, tool, place.cwd);
      if (call) calls.push(call);
    }
    if (raw.endsWith(")") && subshells.length > 0) place.cwd = subshells.pop();
  });
  return calls;
}

// The folder `cd <dir>` moves to from `from` (commands are read from the root).
function movedTo(from, dir) {
  const target = trimQuotes(dir || "", "\"';)");
  if (from === null || !target || "/~$-".includes(target[0]) || UNREADABLE.test(target)) return null;
  const moved = normalizePortable(path.posix.normalize(path.posix.join(from === undefined ? "." : from, target)));
  return insideRoot(moved) ? moved : null;
}

function readCall(tokens, from, tool, cwd) {
  const call = { tool, cwd };
  let at = from;
  for (; at < tokens.length && tokens[at] !== "run" && tokens[at] !== "run-script"; at += 1) {
    if (SEPARATORS.has(tokens[at]) || !tokens[at].startsWith("-")) return null;
    at = readFlag(tokens, at, call);
    if (at === -1) return null;
  }
  for (at += 1; at < tokens.length && tokens[at].startsWith("-"); at += 1) {
    at = readFlag(tokens, at, call);
    if (at === -1) return null;
  }
  const name = trimQuotes(tokens[at] || "", "\"';),.");
  if (at >= tokens.length || !name || SEPARATORS.has(name) || UNREADABLE.test(name)) return null;
  // npm reads its own flags after the script name; pnpm hands them to the script.
  for (let k = at + 1; tool === "npm" && k < tokens.length && !SEPARATORS.has(tokens[k]) && tokens[k] !== "--"; k += 1) {
    if (tokens[k].startsWith("-")) k = readFlag(tokens, k, call);
    if (k === -1) return null;
  }
  for (const key of ["filter", "workspace", "dir"]) {
    if (call[key] === undefined) continue;
    if (!call[key] || /[*{}[\]^!$<>`]|\.\.\./.test(call[key])) return null;
  }
  return { ...call, name };
}

// One flag of a call at `at`: records where the call runs and returns the
// index of its last token, or -1 for a call that runs in every package.
function readFlag(tokens, at, call) {
  const [key, inline] = tokens[at].split(/=(.*)/s);
  const value = () => trimQuotes(inline !== undefined ? inline : tokens[++at] || "", "\"'");
  if (EVERYWHERE_FLAGS.has(key)) return -1;
  if (WORKSPACE_FLAGS.has(key)) call.workspace = value();
  else if (DIR_FLAGS.has(key)) call.dir = value();
  else if (call.tool === "pnpm" && FILTER_FLAGS.has(key)) call.filter = value();
  return at;
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
    const entry = { scripts: json && typeof json.scripts === "object" && json.scripts ? json.scripts : {}, workspaces: Boolean(json && json.workspaces) };
    byDir.set(path.posix.dirname(file), entry);
    if (json && typeof json.name === "string") byName.set(json.name, entry);
  }
  // A workspace (pnpm-workspace.yaml, or `workspaces` in the root package.json):
  // a filter or workspace naming none of its packages is an error, not a guess.
  const top = byDir.get(".");
  const workspace = files.includes("pnpm-workspace.yaml") || Boolean(top && top.workspaces);
  return { byDir, byName, workspace };
}

// The package a call's script is looked up in, or null when it cannot be told.
function packageFor(call, docDir, packages) {
  const byPath = (dir) => packages.byDir.get(normalizePortable(path.posix.normalize(dir)).replace(/\/+$/, "")) || null;
  if (call.filter) return call.filter.startsWith("./") || call.filter.startsWith("../") ? byPath(call.filter) : packages.byName.get(call.filter) || null;
  if (call.workspace) return packages.byName.get(call.workspace) || byPath(call.workspace);
  if (call.cwd === null) return null;
  const start = call.cwd === undefined ? docDir : call.cwd;
  if (call.dir) return byPath(path.posix.join(call.cwd === undefined ? "." : start, call.dir));
  for (let dir = start; ; dir = path.posix.dirname(dir)) {
    if (packages.byDir.has(dir)) return packages.byDir.get(dir);
    if (dir === "." || dir === "/" || dir === "") return null;
  }
}

function scriptFindings(text, docDir, packages, place) {
  const out = [];
  for (const call of scriptCalls(text, place)) {
    const scope = call.filter || call.workspace;
    const target = scope ? `${scope}: ${call.name}` : call.name;
    const pkg = packageFor(call, docDir, packages);
    if (!pkg) {
      // A workspace that has no such package: the call fails before any script runs.
      const named = scope && packages.workspace && !scope.startsWith(".");
      if (named) out.push({ kind: "script", target, suggestion: closest(scope, [...packages.byName.keys()]) });
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(pkg.scripts, call.name)) continue;
    out.push({ kind: "script", target, suggestion: closest(call.name, Object.keys(pkg.scripts)) });
  }
  return out;
}

// One doc's findings, and the repository paths it mentions (for --changed).
function scanDoc(doc, context) {
  const lines = fs.readFileSync(path.join(context.root, doc), "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
  const kinds = classifyLines(lines);
  const docDir = path.posix.dirname(doc);
  const state = { comment: false };
  const block = {}; // where a code block's `cd` lines moved to
  const findings = [];
  const mentions = new Set();
  const add = (line, found) => found.forEach((f) => findings.push({ file: doc, line, ...f }));

  lines.forEach((line, index) => {
    const kind = kinds[index];
    if (kind.kind !== "prose") {
      if (state.comment && line.includes("-->")) state.comment = false;
      if (kind.kind !== "code") Object.keys(block).forEach((key) => delete block[key]);
      else if (SHELL_INFOS.has(kind.info)) add(index + 1, scriptFindings(line, docDir, context.packages, block));
      return;
    }
    const { spans, prose } = inlineParts(line, state);
    for (const span of spans) {
      add(index + 1, scriptFindings(span.text, docDir, context.packages, {}));
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
  const inside = places.filter(insideRoot).map((place) => place.replace(/\/+$/, ""));
  inside.forEach((place) => mentions.add(place));
  if (!judged || inside.length === 0 || inside.some((place) => fs.existsSync(path.join(context.root, place)))) return [];
  if (isPattern(value) || context.suffixes().has(path.posix.normalize(value).replace(/^\.\//, "").replace(/\/+$/, ""))) return [];
  if (inside.some((place) => context.ignoredByConfig(place))) return [];
  // What git recorded (a rename, a deletion) beats a comment that still names it.
  const recorded = inside.find((place) => recordedEvent(place, context));
  if (!recorded && context.namedByCode(value)) return [];
  return [{ kind: "path", target: value, places: inside, ...suggestPath(recorded || inside[0], context) }];
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
    return [{ kind: "link", target: raw, places: [resolved], ...suggestPath(resolved.replace(/\/+$/, ""), context) }];
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
  let history = null;
  let suffixes = null;
  let corpus = null;
  let index = null;
  return {
    // A path the project's own tracked code or config names is one it writes,
    // reads or installs: not a stale reference. Run records, notes and
    // changelogs name old paths too, so they are not part of it.
    namedByCode(value) {
      if (corpus === null) corpus = codeCorpus(root, inGit ? trackedFiles(root) : files);
      return containsPath(corpus, value.replace(/^\.\//, "").replace(/\/+$/, ""));
    },
    suffixes() {
      if (!suffixes) suffixes = suffixesOf(files);
      return suffixes;
    },
    history() {
      if (!history) history = inGit ? pathHistory(root) : new Map();
      return history;
    },
    index() {
      if (!index) index = entryIndex(files);
      return index;
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
    if (!isCodeOrConfig(file)) continue;
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

const CODE_EXTENSIONS = new Set([
  "js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx", "vue", "svelte", "py", "go", "rb", "rs", "java", "kt", "kts",
  "scala", "swift", "c", "h", "cc", "cpp", "hpp", "cs", "php", "lua", "ex", "exs", "dart", "sh", "bash", "zsh", "fish",
  "ps1", "json", "jsonc", "json5", "yaml", "yml", "toml", "ini", "cfg", "conf", "xml", "gradle", "properties", "sql",
]);
const CODE_NAMES = new Set(["Dockerfile", "Makefile", "Procfile", "Justfile", "Rakefile", "Gemfile"]);

// Code and config, never the tool's own records (`.coding-flow/`) or a vendored tree.
function isCodeOrConfig(file) {
  const parts = file.split("/");
  if (parts[0] === ".coding-flow" || parts.includes("node_modules")) return false;
  const base = parts[parts.length - 1];
  const dot = base.lastIndexOf(".");
  return CODE_NAMES.has(base) || (dot > 0 && CODE_EXTENSIONS.has(base.slice(dot + 1).toLowerCase()));
}

function trackedFiles(root) {
  const listed = git(["ls-files", "-z"], root);
  return listed === null ? [] : listed.split("\0").filter(Boolean);
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

// Exit 2: the check could not run as asked (usage, base, paths). Exit 1 is
// kept for "something is stale", so a caller can tell the two apart.
function refuse(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(2);
}

function docsCheckCommand({ commandArgs, flags, getFlagValue }) {
  if (commandArgs[0] !== "check") refuse('usage: ai-flow docs check [--json] [--changed <base>] [paths...]');
  const rest = commandArgs.slice(1);
  const changedBase = getFlagValue("--changed", null);
  const unknown = rest.find((arg) => arg.startsWith("-") && !KNOWN_FLAGS.has(arg.split("=")[0]));
  if (unknown) refuse(`unknown option ${unknown} for "docs check".`);
  if (flags.has("--changed") && !changedBase) refuse("--changed needs a base: ai-flow docs check --changed <base>.");

  let changed = null;
  if (changedBase) {
    changed = changedSince(changedBase, cwd);
    if (!changed) refuse(`cannot read the changes since "${changedBase}" (not a commit here).`);
  }
  const explicit = rest.filter((arg, i) => !arg.startsWith("-") && rest[i - 1] !== "--changed");
  let result;
  try {
    result = scanDocs({ root: cwd, explicit, changed });
  } catch (error) {
    refuse(`docs check could not read the docs: ${error.message}`);
  }
  if (explicit.length > 0 && result.selected === 0) refuse(`no Markdown doc under ${explicit.join(", ")}.`);
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
    const hint = f.suggestion ? `  (did you mean ${f.suggestion}?)` : f.deleted ? `  (deleted in ${f.deleted})` : "";
    log(`  ${f.file}:${f.line}  ${f.kind.padEnd(6)} ${f.target}${hint}`);
  }
}

module.exports = { docsCheckCommand, scanDocs, docsCheckSettings, pathCandidate, scriptCalls, closest };
