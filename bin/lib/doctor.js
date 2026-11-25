"use strict";

// Installation diagnostic: required files, skill frontmatter, manifest, and (in
// strict mode) a quick harness check. `--fix` restores.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { cwd, packageJson } = require("./context");
const { matchesPattern, log, toPortable, parseFrontmatter, readJson, hashFile, isCommandAvailable, binaryPathNote } = require("./util");
const {
  ensureTemplatesExist,
  listTemplateSkillNames,
  getTemplateSpecs,
  manifestPath,
  copyTemplates,
  copyCodexSkills,
  copyPlatformCommands,
  renderPlatformCommands,
  writeManifest,
  readManifest,
  ensureConvenienceFiles,
} = require("./templates");
const { collectHarnessReport } = require("./harness");
const { harnessConfigPath, EVIDENCE_BLOCKED_PATHS } = require("./harness-config");
const { trackedOpenSecurityFindings } = require("./recover");
const { readConfig, activeTargets } = require("./config");
const { CODEX_SKILLS_DIR } = require("./platforms/codex");
const { COMMAND_PLATFORMS } = require("./platforms/registry");
const { scanProject } = require("./bootstrap");
const { getStorage } = require("./storage");
const { findGuardEntry, guardCommandString } = require("./settings");
const { loadPolicy, isShellLimit } = require("./guard");
const { inspectCodexSandbox } = require("./codex-settings");
const { probeCodexSandbox, describeProbe } = require("./codex-probe");
const { recordProbeEvidence } = require("./platforms/evidence");
const { inspectOpenCodePlugin, probeOpenCode, usesOpenCode } = require("./opencode");
const { servedByClaude } = require("./platforms/opencode");
const { EXPLICIT_TARGETS } = require("./detect");
const { inspectOpenCodeInstructions, inspectGlobalCommands, globalOpenCodeDir } = require("./opencode-config");
const { storyLinkIssues, fixStoryLinks } = require("./story-links");
const { indexFreshness, refreshIndex } = require("./archive");
const { epicNumberCollisions } = require("./epic-numbers");

// Past this many stories, an epic is no longer one shippable capability (see
// the WIP-limit heuristic in `/flow-plan`) — it also sits open longer before
// auto-merge sees every story proven, so a bloated epic is slower to land, not
// just harder to reason about.
// Story 26-06: doctor says where every limit it applies is listed.
const RULES_POINTER = "Every rule's value here and where it comes from: ai-flow rules";

// The closing lines of both doctor outcomes: the guard's posture, where the
// binary resolves, and where every rule's value is printed.
function printFooter(report) {
  log(report.guardPosture);
  log(binaryPathNote(report.binaryOnPath));
  log(RULES_POINTER);
}

const EPIC_STORY_SOFT_LIMIT = require("./rules-registry").defaultOf("epic.maxStories");

// The docs `/flow-plan bootstrap` is supposed to write. architecture.md is left
// out on purpose: a brownfield project often already has one, so `init` skips it
// and it is never in the manifest to compare against.
const ONBOARDING_DOCS = ["docs/project-context.md", "docs/conventions.md", "docs/roadmap.md"];

// Untouched since `init` wrote it. The manifest stores the sha256 of what was
// installed, so this is exact — no line counting, no marker string, and no false
// positive on a short but genuine document.
function isUntouchedTemplate(relativePath, manifest) {
  const recorded = manifest.files ? manifest.files[relativePath] : null;
  const fullPath = path.join(cwd, relativePath);

  if (!recorded || !recorded.hash || !fs.existsSync(fullPath)) {
    return false;
  }

  return hashFile(fullPath) === recorded.hash;
}

// The half of brownfield onboarding no command can do. `init` scans the repo and
// points at /flow-plan, but nothing until now noticed when that pointer was never
// followed — so the tool reported "installed correctly" on a project whose docs
// were still the stubs it shipped. Installed is not onboarded.
function checkBrownfieldOnboarding(warnings) {
  const manifest = readJson(manifestPath(), null);

  if (!manifest || typeof manifest !== "object") {
    return;
  }

  const scan = scanProject();

  if (scan.classification === "empty" && !scan.looksLikeCode) {
    // Greenfield: there is no existing codebase to document.
    return;
  }

  // Every one, not any: someone who has written project-context but not roadmap
  // is mid-onboarding and does not need to be told to start.
  if (!ONBOARDING_DOCS.every((file) => isUntouchedTemplate(file, manifest))) {
    return;
  }

  warnings.push({
    code: "brownfield_not_onboarded",
    file: "docs/project-context.md",
    message:
      "existing code detected but the project docs are still the installed templates — " +
      "run /flow-plan bootstrap to document this codebase",
  });
}

// Mechanical mirror of the WIP-limit heuristic `/flow-plan` is told to apply
// when writing stories — a prompt-level rule the model can drift from over a
// long session, so `doctor` re-checks it from the actual files on disk.
function checkOversizedEpics(warnings) {
  let epics;
  try {
    epics = getStorage(cwd, readConfig(cwd)).listEpics();
  } catch {
    return; // best-effort only — never block doctor on a storage read failure.
  }

  for (const epic of epics) {
    if (epic.stories.length > EPIC_STORY_SOFT_LIMIT) {
      warnings.push({
        code: "epic_too_large",
        file: epic.path,
        message:
          `${epic.name} has ${epic.stories.length} stories (soft limit ${EPIC_STORY_SOFT_LIMIT}) — ` +
          "split the remainder into a follow-up epic; it also merges sooner once split",
      });
    }
  }
}

// An explicit `blockedPaths` replaces the defaults, so an install written before
// the evidence entries existed never gets them. Told, not rewritten: the list is
// the user's.
function checkEvidenceBlocked(warnings) {
  const config = readJson(harnessConfigPath(cwd), null);
  if (!config || !Array.isArray(config.blockedPaths)) return;

  // An equivalent glob of the user's own (`.coding-flow/**`) already covers it.
  const missing = EVIDENCE_BLOCKED_PATHS.filter(
    (entry) => !config.blockedPaths.some((pattern) => typeof pattern === "string" && matchesPattern(entry.replace("**", "x-verify.json"), pattern)),
  );
  if (missing.length === 0) return;

  warnings.push({
    code: "evidence_writable",
    file: ".coding-flow/harness.json",
    message:
      `blockedPaths does not list ${missing.join(", ")} — an agent's Write or shell redirect can edit the proof; ` +
      "add them to blockedPaths",
  });
}

// A public repository that ships a trace to an open security hole is publishing
// the exploit. Visibility needs `gh`: when it cannot answer, stay quiet rather
// than guess, but say the check could not be made. Only the tracked dossier
// counts — `.coding-flow/recovery/findings.local.md` is the git-ignored place the
// trace belongs.
function checkRecoveryExposure(warnings, notes) {
  const exposed = trackedOpenSecurityFindings(cwd);

  if (exposed.length === 0) return;

  const ids = exposed.map((finding) => finding.id).join(", ");
  let visibility;

  try {
    const output = execFileSync("gh", ["repo", "view", "--json", "visibility"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const parsed = JSON.parse(output);
    visibility = typeof parsed.visibility === "string" ? parsed.visibility.toLowerCase() : null;
  } catch {
    visibility = null;
  }

  if (visibility === null) {
    notes.push({
      code: "recovery_visibility_unknown",
      message:
        "`gh` could not report this repository's visibility, so the open security trace in " +
        `docs/recovery/findings.md (${ids}) was not checked; keep it in .coding-flow/recovery/findings.local.md`,
    });
    return;
  }

  if (visibility === "public") {
    warnings.push({
      code: "recovery_public_trace",
      file: "docs/recovery/findings.md",
      message:
        `public repository: docs/recovery/findings.md publishes an open security trace (${ids}) — ` +
        "move the trace to the git-ignored .coding-flow/recovery/findings.local.md",
    });
  }
}

// Story 29-08: auto-merge on a base with no required status checks merges at
// once, CI or not. Read from GitHub only when `gh` is there and auto-merge is on;
// a repository it cannot read says nothing. Each warning names the real
// blocker and the step that clears it.
function autoMergeGateWarning({ branch, kind, repo, error }) {
  const { PLAN_LIMIT, PLAN_NEXT, RULESET_UNGATED, rulesetNext } = require("./protect");
  const on = "autoMergeEpic is on but";
  const warnings = {
    disabled: {
      code: "auto_merge_disabled",
      message: `${on} the repository ${repo} has auto-merge disabled (allow_auto_merge: false), so GitHub refuses it — turn on "Allow auto-merge" in the repository's Settings → General`,
    },
    plan: { code: "auto_merge_plan_limit", message: `${on} "${branch}" cannot be protected — ${PLAN_LIMIT} — so GitHub would merge at once; ${PLAN_NEXT}` },
    ruleset: { code: "auto_merge_ungated", message: `${on} "${branch}" is ${RULESET_UNGATED} — ${rulesetNext(branch)}` },
    unread: {
      code: "auto_merge_unread",
      message: `${on} "${branch}"'s protection could not be read (${error}), so whether auto-merge waits for the checks is unknown — run \`ai-flow protect --dry-run --branch ${branch}\` to see what GitHub answers`,
    },
    ungated: {
      code: "auto_merge_ungated",
      message: `${on} "${branch}" has no required status checks, so GitHub would merge at once — run \`ai-flow protect --branch ${branch}\``,
    },
  };
  return warnings[kind];
}

function checkAutoMergeGate(warnings) {
  if (!readConfig(cwd).autoMergeEpic || !isCommandAvailable("gh")) return;

  const { ungatedBases } = require("./protect");
  for (const problem of ungatedBases(cwd)) warnings.push(autoMergeGateWarning(problem));
}

// Both reports run these together, so neither report function grows.
function checkEvidenceAndRecovery(warnings, notes) {
  checkEvidenceBlocked(warnings);
  checkRecoveryExposure(warnings, notes);
  checkAutoMergeGate(warnings);
}

const GENERATED_DIR_NAMES = new Set(["generated", "__generated__", "gen"]);
const GENERATED_DIR_THRESHOLD = 20;

// The last verify's changed files are the ones coverage and risk judged. A big
// generated directory in there is noise a person did not write, and the fix is
// one line in `ignoredPaths`. Files already ignored never reach that list, so
// the hint stops once the project has acted on it.
function checkGeneratedDirectories(warnings) {
  const runsDir = path.join(cwd, ".coding-flow", "runs");
  let latest;

  try {
    latest = fs.readdirSync(runsDir).filter((name) => name.endsWith("-verify.json")).sort().pop();
  } catch {
    return;
  }

  const evidence = latest ? readJson(path.join(runsDir, latest), null) : null;
  const files = evidence && evidence.coverage && Array.isArray(evidence.coverage.changedFiles)
    ? evidence.coverage.changedFiles
    : [];
  const counts = new Map();

  for (const file of files) {
    const parts = toPortable(file).split("/");

    for (let index = 0; index < parts.length - 1; index += 1) {
      if (GENERATED_DIR_NAMES.has(parts[index])) {
        const dir = parts.slice(0, index + 1).join("/");
        counts.set(dir, (counts.get(dir) || 0) + 1);
        break;
      }
    }
  }

  for (const [dir, count] of counts) {
    if (count > GENERATED_DIR_THRESHOLD) {
      warnings.push({
        code: "generated_not_ignored",
        file: dir,
        message:
          `the last verify counted ${count} changed files under ${dir}/ — if they are generated, ` +
          `add "${dir}/**" to ignoredPaths in .coding-flow/harness.json`,
      });
    }
  }
}

function gitQuiet(args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

// Without refs/remotes/origin/HEAD the default base silently becomes the literal
// "main", which is wrong on a repository whose trunk is called anything else (or
// whose clone predates the ref). Only a remote named `origin` makes the ref
// expected at all: `set-head origin` is what creates it.
function checkOriginHead(warnings) {
  const remotes = gitQuiet(["remote"]);

  if (!remotes || !remotes.split(/\r?\n/).includes("origin")) {
    return;
  }

  if (gitQuiet(["symbolic-ref", "-q", "refs/remotes/origin/HEAD"])) {
    return;
  }

  warnings.push({
    code: "origin_head_missing",
    message:
      "refs/remotes/origin/HEAD is not set, so verify measures against a guessed \"main\" — " +
      "run `git remote set-head origin -a`",
  });
}

// This repository only: the maintainer publishes on npm by hand, and the tag
// plus GitHub release follow with `npm run release`. A version with no tag is
// the "published but not released" gap that script closes.
function checkReleaseTag(warnings) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
  } catch {
    return;
  }

  if (pkg.name !== "@landry_pouth/coding-flow" || !pkg.version) {
    return;
  }

  const tags = gitQuiet(["tag", "-l", `v${pkg.version}`]);

  if (tags === null || tags.split(/\r?\n/).includes(`v${pkg.version}`)) {
    return;
  }

  warnings.push({
    code: "release_tag_missing",
    file: "package.json",
    message: `version ${pkg.version} has no v${pkg.version} tag — after \`npm publish\`, run \`npm run release\``,
  });
}

// The epic/story number is picked from a local, unsynced scan of `epics/` at
// plan time. Two people branching from the same base can independently land
// on `epic-05-` (or the same story number inside one epic) with different
// slugs — no Git conflict, since the directory names differ, but the number
// stops being unique the moment both branches merge. Nothing can prevent that
// race without a shared counter this tool deliberately does not have, so
// `doctor` catches it mechanically right after the merge instead, while a
// rename is still a one-line fix. Story 17-03 narrows the race before the
// merge: checkEpicNumberCollisions below reads the archived entries and the
// other local and fetched refs. Two clones that have not fetched each other
// are still caught only here, after the merge.
function checkDuplicateNumbering(warnings) {
  let epics;
  try {
    epics = getStorage(cwd, readConfig(cwd)).listEpics();
  } catch {
    return; // best-effort only — never block doctor on a storage read failure.
  }

  const epicsByNumber = new Map();

  for (const epic of epics) {
    const match = epic.name.match(/^epic-(\d+)-/);

    if (!match) {
      continue;
    }

    const number = match[1];

    if (!epicsByNumber.has(number)) {
      epicsByNumber.set(number, []);
    }

    epicsByNumber.get(number).push(epic.name);
  }

  for (const [number, names] of epicsByNumber) {
    if (names.length > 1) {
      warnings.push({
        code: "duplicate_epic_number",
        file: "epics",
        message:
          `epic-${number}- is used by ${names.length} epics (${names.join(", ")}) — ` +
          "two branches likely picked the same number independently; rename one",
      });
    }
  }

  for (const epic of epics) {
    const storiesByNumber = new Map();

    for (const story of epic.stories) {
      const match = story.name.match(/^story-\d+-(\d+)-/);

      if (!match) {
        continue;
      }

      const number = match[1];

      if (!storiesByNumber.has(number)) {
        storiesByNumber.set(number, []);
      }

      storiesByNumber.get(number).push(story.name);
    }

    for (const [number, names] of storiesByNumber) {
      if (names.length > 1) {
        warnings.push({
          code: "duplicate_story_number",
          file: epic.path,
          message:
            `${epic.name} has ${names.length} stories numbered -${number}- (${names.join(", ")}) — ` +
            "two branches likely picked the same number independently; rename one",
        });
      }
    }
  }
}

function listEpicsQuietly() {
  try {
    return getStorage(cwd, readConfig(cwd)).listEpics();
  } catch {
    return []; // best-effort only — never block doctor on a storage read failure.
  }
}

// A number on disk already held by an archived epic, or by another ref under
// another slug (story 17-03). Warn only: the fix is a rename.
function checkEpicNumberCollisions(warnings) {
  let collisions;
  try {
    collisions = epicNumberCollisions(cwd);
  } catch {
    return; // best-effort only — never block doctor on a git or index read failure.
  }
  const seen = new Set();
  for (const { code, message } of collisions) {
    if (seen.has(message)) continue;
    seen.add(message);
    warnings.push({ code, file: "epics", message });
  }
}

// `/flow-plan` writes each `## Stories` entry as a link that opens the story's
// spec (`1. [story-…](story-…/spec.md) — …`). Checked on every install shape:
// the same entries are what `worktree place` reads, minimal install or not.
function checkStoryLinks(warnings) {
  for (const epic of listEpicsQuietly()) {
    const epicDir = path.join(cwd, epic.path);
    const indexPath = path.join(epicDir, "index.md");

    if (!fs.existsSync(indexPath)) continue;

    const file = `${epic.path}/index.md`;
    for (const issue of storyLinkIssues(epicDir, fs.readFileSync(indexPath, "utf8"))) {
      warnings.push({ code: "story_entry_not_linked", file, line: issue.line, message: `${file}:${issue.line}: ${issue.message}` });
    }
  }
}

// `epics/INDEX.md`'s live section (story 17-02) lists every epic and every
// story's written status. A new epic, story, title or written status makes it
// stale; a proof going stale does not, since the file carries none.
function checkEpicIndex(warnings) {
  let freshness;
  try {
    freshness = indexFreshness();
  } catch {
    return; // best-effort only — never block doctor on a storage read failure.
  }
  if (!freshness || !freshness.stale) return;
  warnings.push({
    code: "epic_index_stale",
    file: "epics/INDEX.md",
    message: `${freshness.reason} — run \`ai-flow archive --refresh\` (or \`ai-flow doctor --fix\`)`,
  });
}

// What `doctor` reads from the epics and docs on disk: size, numbering, story
// links, the index, and the docs' stale references (story 26-03).
function checkEpicFiles(warnings) {
  checkOversizedEpics(warnings);
  checkDuplicateNumbering(warnings);
  checkEpicNumberCollisions(warnings);
  checkStoryLinks(warnings);
  checkEpicIndex(warnings);
  checkStaleDocs(warnings);
}

// Story 26-03: stale paths, scripts and links in the docs — counted and
// pointed at, a warning that never fails doctor. Best-effort: a scan that
// throws says nothing.
function checkStaleDocs(warnings) {
  let result;
  try {
    result = require("./docs-check").scanDocs({ root: cwd, suggest: false });
  } catch {
    return;
  }
  const count = result.findings.length;
  if (count === 0) return;
  warnings.push({
    code: "docs_stale",
    file: "docs",
    message: `docs check: ${count} finding${count === 1 ? "" : "s"} (paths, scripts or links that no longer resolve) — run \`ai-flow docs check\``,
  });
}

// `--fix` half of checkStoryLinks: rewrites each fixable entry to the canonical
// link, the rest of its line kept.
function fixAllStoryLinks() {
  let count = 0;
  for (const epic of listEpicsQuietly()) {
    count += fixStoryLinks(path.join(cwd, epic.path));
  }
  if (count > 0) log(`Rewrote ${count} \`## Stories\` entr${count === 1 ? "y" : "ies"} to link to the story spec.`);
}

// Calls the guard let through because it could not judge them. Silence there
// reads as protection; a recent entry says it was not. A shell command too dynamic
// to read (`> "$out"`, `node <<EOF`) is everyday use, ~100 a day here: `report`
// counts it, but a warning that is always on is a warning nobody reads.
function checkGuardUnchecked(warnings) {
  const file = path.join(cwd, ".coding-flow", "guard-unchecked.jsonl");
  let recent = 0;
  // Named in the warning: an OpenCode MCP read with a `path` looks like an unknown
  // write tool and keeps this on; the reason is what tells the two apart.
  const reasons = new Map();

  try {
    const since = Date.now() - 7 * 24 * 3600 * 1000;

    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      try {
        const entry = line ? JSON.parse(line) : null;
        if (entry && Date.parse(entry.at) >= since && !isShellLimit(entry.reason)) {
          recent += 1;
          const reason = String(entry.reason || "no reason").slice(0, 120);
          reasons.set(reason, (reasons.get(reason) || 0) + 1);
        }
      } catch {
        // a torn line is not an entry
      }
    }
  } catch {
    return;
  }

  if (recent) {
    const [top] = [...reasons].sort((a, b) => b[1] - a[1])[0];
    warnings.push({
      code: "guard_unchecked",
      file: ".coding-flow/guard-unchecked.jsonl",
      message: `the guard could not check ${recent} write(s) in the last 7 days — they were allowed, not protected (most often: ${top}); see \`ai-flow report\``,
    });
  }
}

// The guard is the one part of the install where "wired" and "wired correctly"
// silently diverge: a stale command still runs (settings.js falls back to npx
// when the resolved binary is gone) so it never crashes, and a project that
// looks installed keeps looking installed. Nothing else in `doctor` would ever
// catch that — this is the mechanical half of the imob incident recorded in
// docs/design-decisions.md entry 2 ("a dead daemon stops protecting silently").
// No PreToolUse hook at all is worse than stale: the write path is completely
// unprotected while every other signal still says "installed correctly", so it
// is an error, not a warning. A stale command still enforces, just via the
// slower fallback — that one stays a warning.
function checkGuardWiring(errors, warnings) {
  // The Claude hook is Claude's guard; another platform's guard is judged by its
  // own check (a later story), and `.claude/settings.json` is not its business.
  if (!activeTargets(readConfig(cwd)).includes("claude")) {
    return;
  }

  const settings = readJson(path.join(cwd, ".claude", "settings.json"), null);

  // No settings.json yet is init's job to create, not doctor's to flag — this
  // runs after the required-file checks, which already catch a install that
  // never ran `init` at all.
  if (!settings) {
    return;
  }

  const found = findGuardEntry(settings);

  if (!found) {
    errors.push({
      code: "guard_not_wired",
      file: ".claude/settings.json",
      message: "no PreToolUse hook is wired to `guard` — writes are not protected; run `ai-flow upgrade`",
    });
    return;
  }

  if (found.hook.command !== guardCommandString(cwd)) {
    warnings.push({
      code: "guard_hook_stale",
      file: ".claude/settings.json",
      message: "the guard hook command does not match this install (still enforces via the npx fallback) — run `ai-flow upgrade` to re-wire it",
    });
  }
}

// Codex's guard is the sandbox profile in .codex/config.toml. Absent means no
// protection, silently — an error. A file we did not generate is the user's own
// and is not ours to judge; ours but out of date still protects, so it is a warning.
// Only runs for a project that uses Codex. A profile that is present is then
// exercised for real (codex-probe.js): a profile that denies nothing is an error,
// never a warning — a false sense of protection is the worst outcome. Returns the
// probe result (or null when nothing was probed) for the report and the evidence.
function checkCodexSandbox(errors, warnings) {
  if (!activeTargets(readConfig(cwd)).includes("codex")) {
    return null;
  }

  const { state } = inspectCodexSandbox(cwd);
  const file = ".codex/config.toml";

  if (state === "absent") {
    errors.push({
      code: "guard_not_wired",
      file,
      message: "this project uses Codex but no sandbox profile is installed — writes are not protected; run `ai-flow upgrade`",
    });
  } else if (state === "stale") {
    warnings.push({
      code: "codex_sandbox_stale",
      file,
      message: "the Codex sandbox profile does not match the current blocked paths — run `ai-flow upgrade` to regenerate it",
    });
  }

  // Only our own profile is probed: a foreign file is the user's, and the profile
  // we would probe for is not in it.
  if (state === "absent" || state === "foreign") {
    return null;
  }

  const probe = probeCodexSandbox({ root: cwd });

  if (probe.ran && probe.ok === false) {
    errors.push({ code: "codex_sandbox_not_enforcing", file, message: `Codex sandbox ${describeProbe(probe)}` });
  } else if (probe.ran && probe.ok === null) {
    warnings.push({ code: "codex_sandbox_unconfirmed", file, message: `Codex sandbox ${describeProbe(probe)}` });
  }

  // A profile nothing could be probed against is a claim again, not proof: say so.
  if (!probe.ran && probe.reason === "no-directory") {
    warnings.push({ code: "codex_sandbox_unprobed", file, message: `Codex sandbox ${describeProbe(probe)}; deny globs do not stop new files, so add a directory entry (e.g. \`.ssh/**\`)` });
  }

  return probe;
}

// OpenCode's guard is a plugin file, so the same two silent failures apply: it
// is missing while the project uses OpenCode (writes unprotected there), or it
// is ours but written by another version. Not checked at all for a project that
// does not use OpenCode — Claude-only installs stay exactly as they were.
function olderVersion(a, b) {
  const parse = (v) => String(v || "0").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parse(a), parse(b)];

  for (let i = 0; i < 3; i += 1) {
    if (x[i] !== y[i]) {
      return x[i] < y[i];
    }
  }

  return false;
}

// The install for every project (`init --global`) lives outside the repo, so
// nothing else would ever say it is behind. Only an older one is flagged: a
// newer global install run from an older pinned binary must not be "fixed"
// into a downgrade.
function checkOpenCodeGlobal(warnings) {
  const global = inspectGlobalCommands({ expected: renderPlatformCommands("opencode").map((file) => file.rel) });

  if (!global.installed) {
    return;
  }

  const behind = olderVersion(global.version, packageJson.version);

  if (global.missing.length > 0 || behind) {
    const what = global.missing.length > 0 ? `${global.missing.length} file(s) missing, e.g. ${global.missing[0]}` : `from ${global.version || "an earlier version"}`;

    warnings.push({
      code: "opencode_global_stale",
      file: global.dir,
      message: `the OpenCode install for every project (${global.dir}) is behind this version (${what}) — run \`ai-flow upgrade --global\`, then restart OpenCode`,
    });
  }
}

function checkOpenCodeWiring(errors, warnings, notes = []) {
  if (!usesOpenCode()) {
    return;
  }

  checkOpenCodeGlobal(warnings);

  const host = probeOpenCode();
  const onV2 = host.found && host.major !== null && host.major >= 2;

  if (!host.found) {
    notes.push({ code: "opencode_not_on_path", message: "`opencode` is not on PATH, so the OpenCode version the guard must fit was not checked" });
  }

  // OpenCode never expands CLAUDE.md's `@RULES.md`: without `instructions` in
  // opencode.json the rulebook is not in the model's context at all.
  if (
    activeTargets(readConfig(cwd)).includes("opencode") &&
    fs.existsSync(path.join(cwd, "RULES.md")) &&
    inspectOpenCodeInstructions(cwd) === "absent"
  ) {
    warnings.push({
      code: "opencode_rules_not_loaded",
      file: "opencode.json",
      message: 'OpenCode does not load RULES.md (no "instructions" entry in opencode.json) — run `ai-flow upgrade` to wire it',
    });
  }

  // Leftovers `upgrade` retires: the commands earlier versions rendered (the
  // skills replace them), and an `.opencode/skills` copy next to the Claude one
  // OpenCode already reads (it keeps one and warns "duplicate skill name").
  const names = listTemplateSkillNames();
  const legacy = names.filter((n) => fs.existsSync(path.join(cwd, ".opencode", "command", `${n}.md`)));
  const duplicated = servedByClaude(cwd, names)
    ? names.filter((n) => fs.existsSync(path.join(cwd, ".opencode", "skills", n, "SKILL.md")))
    : [];

  if (legacy.length > 0) {
    warnings.push({
      code: "opencode_legacy_commands",
      file: ".opencode/command",
      message: `${legacy.length} coding-flow command(s) from an earlier install are still in .opencode/command (the skills replace them) — run \`ai-flow upgrade\``,
    });
  }

  if (duplicated.length > 0) {
    warnings.push({
      code: "opencode_skills_duplicated",
      file: ".opencode/skills",
      message: `${duplicated.length} skill(s) exist both in .claude/skills and .opencode/skills; OpenCode reads .claude/skills — run \`ai-flow upgrade\` to drop the second copy`,
    });
  }

  const plugin = inspectOpenCodePlugin();
  const file = ".opencode/plugins/coding-flow-guard.js";

  // OpenCode always gets the guard (`--target opencode`, `--opencode`, or a project
  // that already uses it), so an absent plugin here is a hole, not a design choice —
  // the same rule as a .claude/settings.json without the hook.
  if (plugin.state === "absent") {
    errors.push({
      code: "opencode_guard_not_wired",
      file,
      message: "this project uses OpenCode but no guard plugin is installed — writes are not protected there; run `ai-flow upgrade`",
    });
  } else if (plugin.state === "stale" && onV2 && !plugin.v2) {
    // Not outdated: absent. 2.x ignores a V1-only plugin without a word.
    errors.push({
      code: "opencode_guard_not_loaded",
      file,
      message: `the guard is not loaded on OpenCode ${host.major}: this plugin predates the 2.x entry, so writes are not protected — run \`ai-flow upgrade\``,
    });
  } else if (plugin.state === "stale") {
    warnings.push({
      code: "opencode_guard_stale",
      file,
      message: "the OpenCode guard plugin does not match this install — run `ai-flow upgrade` to re-wire it",
    });
  }

  // The plugin `init --global` puts in ~/.config/opencode applies to every project.
  if (onV2) {
    const global = inspectOpenCodePlugin(cwd, path.join(globalOpenCodeDir(), "plugins", "coding-flow-guard.js"));

    if (global.state === "stale" && !global.v2) {
      errors.push({
        code: "opencode_global_guard_not_loaded",
        file: global.path,
        message: `the global guard is not loaded on OpenCode ${host.major} (${global.path} predates the 2.x entry) — run \`ai-flow upgrade --global\``,
      });
    }
  }
}

// A minimal install owns exactly two things: the harness policy and the guard
// wiring. Judging it against the full template list would report a correct
// project as broken and push the user to "fix" it by installing a workflow they
// deliberately declined.
function collectMinimalReport({ strict = false } = {}) {
  const errors = [];
  const warnings = [];
  const notes = [];

  if (!fs.existsSync(path.join(cwd, ".coding-flow", "harness.json"))) {
    errors.push({
      code: "missing_file",
      file: ".coding-flow/harness.json",
      message: ".coding-flow/harness.json is missing",
    });
  }

  if (strict) {
    const harnessReport = collectHarnessReport({ quick: true, strict: false });

    for (const issue of harnessReport.errors) {
      errors.push({
        code: `harness_${issue.code}`,
        file: issue.file || ".coding-flow/harness.json",
        message: issue.message,
      });
    }
  }

  checkEvidenceAndRecovery(warnings, notes);
  checkGuardWiring(errors, warnings);
  checkGuardUnchecked(warnings);
  const codexProbe = checkCodexSandbox(errors, warnings);
  checkOpenCodeWiring(errors, warnings, notes);
  checkReleaseTag(warnings);
  checkStoryLinks(warnings);
  checkEpicIndex(warnings);
  checkStaleDocs(warnings);

  return {
    ok: errors.length === 0,
    root: cwd,
    version: packageJson.version,
    strict,
    ...guardPosture(),
    codexProbe,
    notes,
    install: "minimal",
    skillsMode: "plugin",
    skills: [],
    binaryOnPath: isCommandAvailable("ai-flow"),
    errors,
    warnings,
  };
}

// One line on what the guard does with a write it could not check, so the posture
// is read, not assumed.
function guardPosture() {
  const { mode, unreadable } = loadPolicy(cwd);
  let guardPosture = "guard: standard (unchecked writes are allowed and logged)";
  if (mode === "strict") {
    guardPosture = "guard: strict (unchecked writes are refused)";
  } else if (unreadable) {
    // Say why: a project that set strict and broke the file must not read "standard" as a choice.
    guardPosture = "guard: standard (.coding-flow/harness.json could not be read; unchecked writes are allowed and logged)";
  }
  return { guardMode: mode, guardPosture };
}

function collectDoctorReport({ strict = false } = {}) {
  const config = readConfig(cwd);

  if (config.install === "minimal") {
    return collectMinimalReport({ strict });
  }

  ensureTemplatesExist();

  // The install recorded which channel serves its skills. Doctor must judge the
  // project against THAT decision, not against whether this particular machine
  // happens to have the plugin.
  const skillsMode = config.skills;
  const includeSkills = skillsMode === "project";
  const skillNames = listTemplateSkillNames();
  const required = [
    "RULES.md",
    "docs/project-context.md",
    "docs/architecture.md",
    "docs/conventions.md",
    "docs/roadmap.md",
  ];

  // CLAUDE.md and the Claude skills belong to a Claude install only; a Codex
  // project is judged against its own commands, and an unrecognized one against
  // the shared files alone.
  const platforms = activeTargets(config);
  const hasClaude = platforms.includes("claude");

  if (hasClaude) {
    required.push("CLAUDE.md");
  }

  if (platforms.includes("codex")) {
    for (const name of skillNames) {
      required.push(`${CODEX_SKILLS_DIR}/${name}/SKILL.md`);
    }
  }

  // The exact files each platform's renderer writes. OpenCode needs none of its
  // own when `.claude/skills` already carries them: it reads them there.
  for (const platform of platforms.filter((p) => COMMAND_PLATFORMS[p])) {
    const { render, renderCommand } = COMMAND_PLATFORMS[platform];

    for (const name of skillNames) {
      const source = `---\nname: ${name}\ndescription: x\n---\n`;

      if (!(platform === "opencode" && servedByClaude(cwd, skillNames))) {
        required.push(render(source).relPath);
      }

      // The `/` menu entry: without it OpenCode's TUI shows no /flow-* at all.
      if (renderCommand) {
        required.push(renderCommand(source).relPath);
      }
    }
  }

  const errors = [];
  const warnings = [];
  // Known, permanent facts — not a problem to fix, so never an error or a warning.
  // OpenCode has its own guard (a plugin, checked by checkOpenCodeWiring), so only
  // the platforms with no verified mechanism get this note.
  const notes = platforms
    .filter((p) => COMMAND_PLATFORMS[p] && !COMMAND_PLATFORMS[p].guard)
    .map((p) => ({
      code: "guard_unavailable",
      message: `guard not available on this host (${p}): commands are installed, writes are not mechanically protected`,
    }));

  if (config.target === "unrecognized") {
    warnings.push({
      code: "platform_unrecognized",
      message:
        "no platform was recognized at init, so no commands and no guard were installed — " +
        `run \`ai-flow init --target <platform>\` (${EXPLICIT_TARGETS.join(", ")})`,
    });
  }

  for (const spec of getTemplateSpecs({ includeSkills, target: hasClaude ? "claude" : config.target })) {
    required.push(spec.targetRel);
  }

  for (const file of [...new Set(required)]) {
    if (!fs.existsSync(path.join(cwd, file))) {
      errors.push({
        code: "missing_file",
        file,
        message: `${file} is missing`,
      });
    }
  }

  for (const name of skillNames) {
    const claudeSkill = path.join(cwd, ".claude", "skills", name, "SKILL.md");

    if (!fs.existsSync(claudeSkill)) {
      continue;
    }

    const content = fs.readFileSync(claudeSkill, "utf8");
    const frontmatter = parseFrontmatter(content);

    if (!frontmatter) {
      errors.push({
        code: "invalid_frontmatter",
        file: toPortable(path.relative(cwd, claudeSkill)),
        message: `${toPortable(path.relative(cwd, claudeSkill))} has no valid frontmatter block`,
      });
      continue;
    }

    if (!frontmatter.name) {
      errors.push({
        code: "missing_skill_name",
        file: toPortable(path.relative(cwd, claudeSkill)),
        message: `${toPortable(path.relative(cwd, claudeSkill))} frontmatter is missing name`,
      });
    } else if (frontmatter.name !== name) {
      errors.push({
        code: "skill_name_mismatch",
        file: toPortable(path.relative(cwd, claudeSkill)),
        message: `${toPortable(path.relative(cwd, claudeSkill))} name "${frontmatter.name}" does not match folder "${name}"`,
      });
    }

    if (!frontmatter.description) {
      errors.push({
        code: "missing_skill_description",
        file: toPortable(path.relative(cwd, claudeSkill)),
        message: `${toPortable(path.relative(cwd, claudeSkill))} frontmatter is missing description`,
      });
    }

    if (content.trim().length < 120) {
      warnings.push({
        code: "small_skill_file",
        file: toPortable(path.relative(cwd, claudeSkill)),
        message: `${toPortable(path.relative(cwd, claudeSkill))} looks unusually small`,
      });
    }
  }

  if (strict) {
    const manifest = readJson(manifestPath(), null);

    if (!manifest) {
      errors.push({
        code: "missing_manifest",
        file: ".coding-flow/manifest.json",
        message: ".coding-flow/manifest.json is missing",
      });
    }

    for (const file of ["docs/project-context.md", "docs/architecture.md", "docs/conventions.md", "docs/roadmap.md"]) {
      const fullPath = path.join(cwd, file);

      if (fs.existsSync(fullPath) && fs.readFileSync(fullPath, "utf8").trim().length < 200) {
        warnings.push({
          code: "thin_doc",
          file,
          message: `${file} looks too thin for strict mode`,
        });
      }
    }

    const harnessReport = collectHarnessReport({ quick: true, strict: false });

    for (const issue of harnessReport.errors) {
      errors.push({
        code: `harness_${issue.code}`,
        file: issue.file || ".coding-flow/harness.json",
        message: issue.message,
      });
    }

    for (const issue of harnessReport.warnings) {
      warnings.push({
        code: `harness_${issue.code}`,
        file: issue.file || ".coding-flow/harness.json",
        message: issue.message,
      });
    }
  }

  // Not strict-only: this is the mitigation for the risk that folding the scan
  // into `init` makes the expensive half of onboarding invisible, so it has to
  // fire on the `doctor` a user actually runs. A warning, never an error —
  // unfinished onboarding is not a broken install.
  checkBrownfieldOnboarding(warnings);
  checkEpicFiles(warnings);
  checkGeneratedDirectories(warnings);
  checkOriginHead(warnings);
  checkReleaseTag(warnings);
  checkEvidenceAndRecovery(warnings, notes);
  checkGuardWiring(errors, warnings);
  checkGuardUnchecked(warnings);
  const codexProbe = checkCodexSandbox(errors, warnings);
  checkOpenCodeWiring(errors, warnings, notes);

  return {
    ok: errors.length === 0,
    root: cwd,
    version: packageJson.version,
    strict,
    ...guardPosture(),
    codexProbe,
    install: "full",
    skillsMode,
    skills: skillNames,
    // Not a warning: an npx-only workflow (the documented zero-install default)
    // has this false on every run by design, so flagging it as an "issue" would
    // be noise for the common case. It answers a different question — "will the
    // short `ai-flow <command>` form work on THIS machine" — worth surfacing
    // plainly, never worth failing the install over.
    binaryOnPath: isCommandAvailable("ai-flow"),
    errors,
    warnings,
    notes,
  };
}

function printNotes(report) {
  for (const note of report.notes || []) {
    log("");
    log(`Note: ${note.message}`);
  }
}

// `doctor --fix`. Epic indexes are the project's own files on either install
// shape, so their story links and `epics/INDEX.md`'s live section are fixed
// first. `--fix` then restores the templates, which a minimal install never
// had: silently laying them down would turn a diagnostic into an unasked-for
// upgrade.
function applyFix() {
  fixAllStoryLinks();
  refreshIndex({ quiet: true });

  const fixConfig = readConfig(cwd);

  if (fixConfig.install === "minimal") {
    log("Minimal install: nothing to restore (no templates were laid down).");
    log("Run `ai-flow init` to lay down the full workflow.");
    return;
  }

  const fixPlatforms = activeTargets(fixConfig);

  copyTemplates({
    force: false,
    dryRun: false,
    includeSkills: fixPlatforms.includes("claude") && fixConfig.skills === "project",
    target: fixPlatforms.includes("claude") ? "claude" : fixConfig.target,
  });

  for (const platform of fixPlatforms.filter((p) => COMMAND_PLATFORMS[p])) {
    copyPlatformCommands(platform, { force: false, dryRun: false });
  }

  if (fixPlatforms.includes("codex")) {
    copyCodexSkills({ force: false, dryRun: false });
  }
  writeManifest(readManifest());
  ensureConvenienceFiles({ dryRun: false, force: false });
}

function doctor({ fix = false, json = false, strict = false } = {}) {
  if (fix) {
    applyFix();
  }

  const report = collectDoctorReport({ strict });

  // Every probe is evidence, so `ai-flow report` can show enforcement as checked
  // rather than claimed. Idempotent: an unchanged result writes nothing.
  if (report.codexProbe) {
    recordProbeEvidence(cwd, { target: "codex", probe: report.codexProbe, baseTier: "sandbox-profile" });
  }

  // A broken or unconfirmed probe is already an error/warning above; the line is
  // for the two outcomes that are not (confirmed working, not checked).
  const probeLine =
    report.codexProbe && (!report.codexProbe.ran || report.codexProbe.ok === true)
      ? `Codex sandbox: ${describeProbe(report.codexProbe)}`
      : null;

  if (json) {
    log(JSON.stringify(report, null, 2));
  } else if (report.ok) {
    log(
      report.install === "minimal"
        ? "Coding Flow is installed correctly (minimal: guard + proof layer only)."
        : "Coding Flow is installed correctly.",
    );

    if (report.warnings.length > 0) {
      log("");
      log("Warnings:");
      for (const warning of report.warnings) {
        log(`- ${warning.message}`);
      }
    }

    printNotes(report);

    if (probeLine) {
      log("");
      log(probeLine);
    }

    log("");
    printFooter(report);
  } else {
    log("Coding Flow has installation issues:");
    for (const error of report.errors) {
      log(`- ${error.message}`);
    }

    if (report.warnings.length > 0) {
      log("");
      log("Warnings:");
      for (const warning of report.warnings) {
        log(`- ${warning.message}`);
      }
    }

    printNotes(report);

    if (probeLine) {
      log("");
      log(probeLine);
    }

    log("");
    log("Run `ai-flow doctor --fix` to restore missing files.");
    log("");
    printFooter(report);
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
}

module.exports = { doctor };
