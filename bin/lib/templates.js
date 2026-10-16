"use strict";

// Installation and update of the template files: copy, manifest (fingerprints to
// detect local edits), convenience npm scripts, and cheat-sheet.

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { templatesRoot, cwd, packageJson, npxCommand, flowScripts } = require("./context");
const { CODEX_SKILLS_DIR, renderSkill: renderCodexSkill } = require("./platforms/codex");
const { COMMAND_PLATFORMS } = require("./platforms/registry");
const { OPENCODE_SKILLS_DIR, OPENCODE_COMMANDS_DIR, servedByClaude } = require("./platforms/opencode");
const {
  log,
  fail,
  toPortable,
  normalizePortable,
  walkFiles,
  hashFile,
  readJson,
  writeJson,
  removeFileIfExists,
  removeEmptyDirsUpward,
} = require("./util");
const { ensureHarnessConfig } = require("./harness");

function ensureTemplatesExist() {
  if (!fs.existsSync(templatesRoot)) {
    fail(`templates directory not found: ${templatesRoot}`);
  }
}

function listTemplateSkillNames() {
  const skillsRoot = path.join(templatesRoot, ".claude", "skills");

  if (!fs.existsSync(skillsRoot)) {
    return [];
  }

  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

const SKILLS_DIR = ".claude/skills";

// The single seam that decides "does this project carry its own copy of the
// skills?". Every consumer (init, upgrade, doctor, manifest, uninstall) derives
// its view of the install from here, so the answer can never disagree between
// two commands.
function isSkillTarget(targetRel) {
  return normalizePortable(targetRel).startsWith(`${SKILLS_DIR}/`);
}

// Files that exist only for Claude Code. A Codex install must not get them: it
// has its own flavor (platforms/codex.js), and a stray CLAUDE.md in a Codex
// project is the kind of Claude-specific file the target was meant to avoid.
const CLAUDE_ONLY_TEMPLATES = ["CLAUDE.md"];

// `target` is "claude" by default so every existing caller keeps its behavior.
// Anything else (codex, unrecognized) gets the shared files only.
// The Claude skills are copied file for file, so pinning them (see pinNpx) means
// handing the copy a pinned source. It lives in a per-version temp directory, so
// every hash comparison (upgrade, manifest, uninstall) sees the pinned bytes as
// "what we install" with no other change. OpenCode reads .claude/skills too: an
// unpinned copy there sent `npx` to whatever npm called latest.
function pinnedSkillSource(source, relativePath) {
  const original = fs.readFileSync(source, "utf8");
  const pinned = pinNpx(original);

  if (pinned === original) {
    return source;
  }

  const target = path.join(os.tmpdir(), `coding-flow-pinned-${packageJson.version}`, relativePath);

  if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== pinned) {
    // Written aside then renamed: parallel runs never read a half-written file.
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const partial = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(partial, pinned);
    fs.renameSync(partial, target);
  }

  return target;
}

function getTemplateSpecs({ includeSkills = true, target = "claude" } = {}) {
  ensureTemplatesExist();

  const specs = [];

  for (const source of walkFiles(templatesRoot)) {
    const relativePath = toPortable(path.relative(templatesRoot, source));

    if (!includeSkills && isSkillTarget(relativePath)) {
      continue;
    }

    if (target !== "claude" && CLAUDE_ONLY_TEMPLATES.includes(relativePath)) {
      continue;
    }

    specs.push({
      source: isSkillTarget(relativePath) ? pinnedSkillSource(source, relativePath) : source,
      sourceRel: relativePath,
      targetRel: relativePath,
      kind: "template",
    });
  }

  return specs.sort((a, b) => a.targetRel.localeCompare(b.targetRel));
}

function manifestPath() {
  return path.join(cwd, ".coding-flow", "manifest.json");
}

function commandsPath() {
  return path.join(cwd, ".coding-flow", "COMMANDS.md");
}

function readManifest() {
  return readJson(manifestPath(), {
    version: null,
    installedAt: null,
    updatedAt: null,
    packageJsonCreated: false,
    files: {},
  });
}

function buildManifestFromCurrentTargets(previous = null) {
  const files = {};

  for (const spec of getTemplateSpecs()) {
    const target = path.join(cwd, spec.targetRel);
    const sourceHash = hashFile(spec.source);

    if (fs.existsSync(target) && hashFile(target) === sourceHash) {
      files[spec.targetRel] = {
        source: spec.sourceRel,
        hash: sourceHash,
        kind: spec.kind,
      };
    } else if (fs.existsSync(target) && previous && previous.files && previous.files[spec.targetRel]) {
      // Carrying the previous entry forward keeps the original hash of a file
      // the user edited locally. It must not resurrect an entry for a file that
      // is gone — a skill pruned when the project switched to the plugin would
      // otherwise stay in the manifest forever.
      files[spec.targetRel] = previous.files[spec.targetRel];
    }
  }

  return {
    package: packageJson.name,
    version: packageJson.version,
    installedAt: previous && previous.installedAt ? previous.installedAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    packageJsonCreated: Boolean(previous && previous.packageJsonCreated),
    files,
    // Codex skills are rendered, so they are tracked by the hash of what was
    // written; carried forward untouched because this builder only knows the
    // Claude targets.
    codexSkills: (previous && previous.codexSkills) || {},
    platformCommands: (previous && previous.platformCommands) || {},
  };
}

function writeManifest(previous = null) {
  writeJson(manifestPath(), buildManifestFromCurrentTargets(previous));
}

function markGeneratedPackageJson() {
  const manifest = readManifest();
  manifest.packageJsonCreated = true;
  manifest.updatedAt = new Date().toISOString();
  writeJson(manifestPath(), manifest);
}

function detectProjectPackageJson() {
  const packagePath = path.join(cwd, "package.json");

  if (!fs.existsSync(packagePath)) {
    return {
      exists: false,
      path: packagePath,
      packageJson: null,
    };
  }

  return {
    exists: true,
    path: packagePath,
    packageJson: readJson(packagePath, null),
  };
}

function buildCommandsMarkdown({ hasPackageJson = false } = {}) {
  // The daily driver is in Claude Code (the skills); the terminal only needs to
  // see state and ship. Everything else is machinery the skills run for you.
  const terminalDaily = hasPackageJson
    ? [
        "npm run flow:status                 # where each story stands",
        "npm run flow:next                   # the one thing worth doing right now",
        `${npxCommand} ship   # push the branch and open/update the PR`,
      ]
    : [
        `${npxCommand} status`,
        `${npxCommand} next`,
        `${npxCommand} ship`,
      ];
  const setupCommands = hasPackageJson
    ? [
        `${npxCommand} init`,
        "npm run flow:upgrade",
        "npm run flow:fix",
        "npm run flow:uninstall -- --dry-run",
        "npm run flow:uninstall",
      ]
    : [
        `${npxCommand} init`,
        `${npxCommand} upgrade`,
        `${npxCommand} doctor --fix`,
        `${npxCommand} uninstall --dry-run`,
        `${npxCommand} uninstall`,
      ];
  // Rarely typed by hand: the skills, CI, and the git hook run these for you.
  const machinery = hasPackageJson
    ? [
        "npm run flow:doctor   # check the installation",
        "npm run flow:check    # strict docs + harness quick check",
        "npm run flow:skills   # list available skills",
        "npm run flow:harness  # quick security evidence check",
      ]
    : [
        `${npxCommand} doctor`,
        `${npxCommand} doctor --strict`,
        `${npxCommand} list-skills`,
        `${npxCommand} harness check --quick`,
      ];

  return [
    "# Coding Flow Commands",
    "",
    "This file is generated by `ai-flow init` as a local command cheat sheet.",
    "",
    "## Start Here",
    "",
    "In your agent (Claude Code, OpenCode, Gemini, Antigravity: `/flow-*`; Codex: `$flow-*`):",
    "",
    "```txt",
    'Use /flow-plan to turn an objective into implementation-ready stories.',
    "Use /flow-run to run the next story end-to-end (it picks QUICK..STRICT by risk).",
    "Use /flow-run STRICT for auth, permissions, admin, secrets, payments, uploads, or sensitive data.",
    "Then /flow-review before merge, and /flow-ship to open the PR.",
    "/flow-run captures the verify proof itself — you never run it by hand.",
    "",
    "With the Claude plugin installed the same skills answer to coding-flow:flow-*.",
    "```",
    "",
    "In the terminal:",
    "",
    "```bash",
    ...terminalDaily,
    "```",
    "",
    "That is almost all daily use. Everything below is machinery the skills run for you.",
    "",
    "## Setup And Updates",
    "",
    "```bash",
    ...setupCommands,
    "```",
    "",
    "## Checks And Machinery",
    "",
    "Usually run for you by the skills, CI, or the git hook — rarely typed by hand:",
    "",
    "```bash",
    ...machinery,
    "```",
    "",
    `Full command reference: \`${npxCommand} help --all\``,
    "",
  ].join("\n");
}

function ensureCommandsFile({ dryRun = false, force = false, hasPackageJson = false } = {}) {
  const target = commandsPath();
  const content = buildCommandsMarkdown({ hasPackageJson });
  const exists = fs.existsSync(target);

  if (exists && !force) {
    return "skipped";
  }

  if (!dryRun) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }

  return exists ? "updated" : "created";
}

// The manifests of other ecosystems. A project that has one and no package.json
// is not a Node project: a package.json there exists only to hold `flow:*`
// shortcuts, and it confuses that project's own tooling and reviewers. The CLI
// works the same without it (`ai-flow …` or `npx @landry_pouth/coding-flow …`).
const OTHER_ECOSYSTEM_MANIFESTS = [
  "pyproject.toml",
  "setup.py",
  "requirements.txt",
  "Pipfile",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Gemfile",
  "composer.json",
  "mix.exs",
  "pubspec.yaml",
  "Package.swift",
];

function otherEcosystemManifest() {
  return OTHER_ECOSYSTEM_MANIFESTS.find((name) => fs.existsSync(path.join(cwd, name))) || null;
}

function ensurePackageScripts({ dryRun = false } = {}) {
  const detected = detectProjectPackageJson();
  const foreign = detected.exists ? null : otherEcosystemManifest();
  const result = {
    packageJsonExists: detected.exists,
    packageJsonCreated: !detected.exists && !foreign,
    notNode: foreign,
    added: [],
    existing: [],
    conflicts: [],
  };

  if (foreign) {
    return result;
  }

  if (detected.exists && (!detected.packageJson || typeof detected.packageJson !== "object")) {
    result.conflicts.push({
      script: null,
      current: null,
      expected: null,
      reason: "package.json could not be parsed",
    });
    return result;
  }

  const packageJsonTarget = detected.exists ? detected.packageJson : { private: true };
  const scripts = packageJsonTarget.scripts && typeof packageJsonTarget.scripts === "object"
    ? packageJsonTarget.scripts
    : {};

  for (const [name, value] of Object.entries(flowScripts)) {
    if (!scripts[name]) {
      scripts[name] = value;
      result.added.push(name);
    } else if (scripts[name] === value) {
      result.existing.push(name);
    } else {
      result.conflicts.push({
        script: name,
        current: scripts[name],
        expected: value,
        reason: "existing script uses a different command",
      });
    }
  }

  if (result.added.length > 0 && !dryRun) {
    packageJsonTarget.scripts = scripts;
    writeJson(detected.path, packageJsonTarget);

    if (result.packageJsonCreated) {
      markGeneratedPackageJson();
    }
  }

  return result;
}

function removePackageScripts({ dryRun = false, removeGeneratedPackageJson = false } = {}) {
  const detected = detectProjectPackageJson();
  const result = {
    packageJsonExists: detected.exists,
    packageJsonRemoved: false,
    removed: [],
    skipped: [],
    conflicts: [],
  };

  if (!detected.exists) {
    return result;
  }

  if (!detected.packageJson || typeof detected.packageJson !== "object") {
    result.conflicts.push({
      script: null,
      reason: "package.json could not be parsed",
    });
    return result;
  }

  const packageJsonTarget = detected.packageJson;
  const scripts = packageJsonTarget.scripts && typeof packageJsonTarget.scripts === "object"
    ? packageJsonTarget.scripts
    : {};

  for (const [name, value] of Object.entries(flowScripts)) {
    if (!scripts[name]) {
      continue;
    }

    if (scripts[name] === value) {
      delete scripts[name];
      result.removed.push(name);
    } else {
      result.skipped.push(name);
    }
  }

  if (Object.keys(scripts).length > 0) {
    packageJsonTarget.scripts = scripts;
  } else {
    delete packageJsonTarget.scripts;
  }

  const shouldRemovePackageJson = removeGeneratedPackageJson && isGeneratedPackageJsonRemovable(packageJsonTarget);

  if (shouldRemovePackageJson) {
    result.packageJsonRemoved = true;

    if (!dryRun) {
      fs.unlinkSync(detected.path);
    }
  } else if (result.removed.length > 0 && !dryRun) {
    writeJson(detected.path, packageJsonTarget);
  }

  return result;
}

function isGeneratedPackageJsonRemovable(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const keys = Object.keys(value);
  return keys.length === 1 && value.private === true;
}

function ensureConvenienceFiles({ dryRun = false, force = false } = {}) {
  const scripts = ensurePackageScripts({ dryRun });
  const commandsFile = ensureCommandsFile({
    dryRun,
    force,
    hasPackageJson: scripts.packageJsonExists || scripts.packageJsonCreated,
  });

  return {
    scripts,
    commandsFile,
  };
}

function printConvenienceSummary(convenience, { dryRun = false } = {}) {
  if (convenience.scripts.notNode) {
    log(`Package.json: not created (${convenience.scripts.notNode} found — not a Node project); use \`ai-flow <command>\` or \`${npxCommand} <command>\``);
  }

  if (convenience.scripts.packageJsonCreated) {
    log(`Package.json: ${dryRun ? "would create" : "created"} at project root`);
  }

  if (convenience.scripts.packageJsonExists || convenience.scripts.packageJsonCreated) {
    if (convenience.scripts.added.length > 0) {
      log(`Package scripts: ${dryRun ? "would add" : "added"} ${convenience.scripts.added.join(", ")}`);
    } else {
      log("Package scripts: unchanged");
    }

    if (convenience.scripts.conflicts.length > 0) {
      log(`Package script conflicts: ${convenience.scripts.conflicts.length}`);
      for (const conflict of convenience.scripts.conflicts) {
        if (conflict.script) {
          log(`- ${conflict.script}: kept existing script`);
        } else {
          log(`- ${conflict.reason}`);
        }
      }
    }
  }

  if (convenience.commandsFile === "created") {
    log(dryRun ? "Commands cheat sheet: would create" : "Commands cheat sheet: created");
  } else if (convenience.commandsFile === "updated") {
    log(dryRun ? "Commands cheat sheet: would update" : "Commands cheat sheet: updated");
  } else {
    log("Commands cheat sheet: unchanged");
  }
}

function printPrunedSkills(pruned, { dryRun = false } = {}) {
  if (!pruned) {
    return;
  }

  if (pruned.removed.length > 0) {
    log(`Outdated skills: ${dryRun ? "would remove" : "removed"} ${pruned.removed.length}`);
    for (const file of pruned.removed) {
      log(`- ${file}`);
    }
  }

  if (pruned.skippedModified.length > 0) {
    log(`Outdated skills kept (locally edited): ${pruned.skippedModified.length}`);
    for (const file of pruned.skippedModified) {
      log(`- ${file}`);
    }
    log("Delete them by hand, or re-run with --force.");
  }
}

function copyFileToTarget(source, targetRel, { force = false, dryRun = false } = {}) {
  const target = path.join(cwd, targetRel);
  const targetExists = fs.existsSync(target);

  if (targetExists && !force) {
    return "skipped";
  }

  if (!dryRun) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }

  return targetExists ? "updated" : "copied";
}

// The Codex flavor of the skills: one `.codex/skills/<name>/SKILL.md` per
// coding-flow skill, rendered from the same sources the Claude copy uses. Same
// contract as the Claude templates: an untouched file (its hash matches what the
// manifest recorded) is refreshed, a locally edited one is kept unless forced,
// and an up-to-date one is a no-op.
function hashText(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

// Shared by every rendered flavor: `files` are `{ rel, content }`, and the
// manifest key records what was written so an untouched file can be refreshed.
function syncRendered(files, manifestKey, { force, dryRun }) {
  const written = [];
  const skipped = [];
  const edited = [];
  const manifest = readManifest();
  const recorded = { ...(manifest[manifestKey] || {}) };

  for (const { rel, content } of files) {
    const target = path.join(cwd, rel);
    const renderedHash = hashText(content);

    if (fs.existsSync(target)) {
      const currentHash = hashText(fs.readFileSync(target, "utf8"));

      if (currentHash === renderedHash) {
        recorded[rel] = renderedHash;
        skipped.push(rel);
        continue;
      }

      if (!force && recorded[rel] !== currentHash) {
        skipped.push(rel);
        edited.push(rel);
        continue;
      }
    }

    if (!dryRun) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
      recorded[rel] = renderedHash;
    }

    written.push(rel);
  }

  if (!dryRun) {
    writeJson(manifestPath(), { ...manifest, [manifestKey]: recorded });
  }

  return { written, skipped, edited };
}

// A rendered skill outlives the process that wrote it, and a bare
// `npx @scope/pkg` resolves to whatever npm calls latest at the moment the agent
// runs it — not the version that rendered the skill (npx ignores a global
// install). Pinning keeps `/flow-setup` and the other skills on the release that
// wrote them; `ai-flow upgrade` re-renders with the new pin.
function pinNpx(markdown) {
  const name = packageJson.name.replace(/[/@.]/g, (c) => `\\${c}`);

  return String(markdown).replace(new RegExp(`npx ${name}(?![@\\w-])`, "g"), `npx ${packageJson.name}@${packageJson.version}`);
}

function sourceSkills() {
  ensureTemplatesExist();

  return listTemplateSkillNames().map((name) =>
    pinNpx(fs.readFileSync(path.join(templatesRoot, ".claude", "skills", name, "SKILL.md"), "utf8")),
  );
}

function copyCodexSkills({ force = false, dryRun = false } = {}) {
  ensureTemplatesExist();

  const files = listTemplateSkillNames().map((name) => ({
    rel: `${CODEX_SKILLS_DIR}/${name}/SKILL.md`,
    content: renderCodexSkill(
      pinNpx(fs.readFileSync(path.join(templatesRoot, ".claude", "skills", name, "SKILL.md"), "utf8")),
    ),
  }));

  return syncRendered(files, "codexSkills", { force, dryRun });
}

// The rendered files of one platform, relative to its config directory
// (`.opencode/skills/flow-run/SKILL.md` -> `skills/flow-run/SKILL.md`): the
// global OpenCode install writes them under ~/.config/opencode instead.
function renderPlatformCommands(target) {
  const { render, renderCommand } = COMMAND_PLATFORMS[target];

  return sourceSkills()
    .flatMap((markdown) => (renderCommand ? [render(markdown), renderCommand(markdown)] : [render(markdown)]))
    .map(({ relPath, content }) => ({ rel: relPath.split("/").slice(1).join("/"), content }));
}

// Removes rendered files this install wrote under `prefixes` (manifest entries
// whose file still matches the recorded hash) and forgets them. A file the user
// edited is kept and reported, never deleted.
function retireRendered(prefixes, manifestKey, { dryRun = false } = {}) {
  const manifest = readManifest();
  const recorded = { ...(manifest[manifestKey] || {}) };
  const removed = [];
  const modified = [];

  for (const [rel, hash] of Object.entries(recorded)) {
    if (!prefixes.some((prefix) => rel.startsWith(prefix))) {
      continue;
    }

    const target = path.join(cwd, rel);

    if (!fs.existsSync(target)) {
      delete recorded[rel];
      continue;
    }

    if (hashText(fs.readFileSync(target, "utf8")) !== hash) {
      modified.push(rel);
      continue;
    }

    if (!dryRun) {
      fs.unlinkSync(target);
      removeEmptyDirsUpward(path.dirname(target), cwd, { dryRun });
    }

    delete recorded[rel];
    removed.push(rel);
  }

  if (!dryRun && removed.length > 0) {
    writeJson(manifestPath(), { ...manifest, [manifestKey]: recorded });
  }

  return { removed, modified };
}

// Gemini, OpenCode and Antigravity: same sources, each rendered in its own format.
//
// OpenCode reads `.claude/skills/` too, so when the Claude copy is there it
// serves both agents and nothing is rendered (`servedBy: "claude"`); a copy we
// rendered before that is retired. The `.opencode/command/` files earlier
// versions wrote are retired in every case — the skills replace them.
function copyPlatformCommands(target, { force = false, dryRun = false } = {}) {
  const { render, renderCommand } = COMMAND_PLATFORMS[target];
  let retired = { removed: [], modified: [] };
  let servedBy = null;

  if (target === "opencode") {
    retired = retireRendered([`${OPENCODE_COMMANDS_DIR}/`], "platformCommands", { dryRun });

    if (servedByOpenCodeFromClaude(listTemplateSkillNames())) {
      const own = retireRendered([`${OPENCODE_SKILLS_DIR}/`], "platformCommands", { dryRun });
      retired = { removed: [...retired.removed, ...own.removed], modified: [...retired.modified, ...own.modified] };
      servedBy = "claude";
    }
  }

  const toFile = ({ relPath, content }) => ({ rel: relPath, content });
  const sources = sourceSkills();
  const result = servedBy
    ? { written: [], skipped: [], edited: [] }
    : syncRendered(sources.map(render).map(toFile), "platformCommands", { force, dryRun });

  // The `/` menu entries (OpenCode): written even when the skills come from
  // .claude/skills, since OpenCode's TUI lists no skill under `/`.
  const commands = renderCommand
    ? syncRendered(sources.map(renderCommand).map(toFile), "platformCommands", { force, dryRun })
    : null;

  return { ...result, servedBy, retired, commands };
}

function servedByOpenCodeFromClaude(names) {
  return servedByClaude(cwd, names);
}

// The friction log is the one piece of documentation a minimal install still
// lays down. It is not there to explain the tool — it is the return channel: the
// only place a user who is not the author records a gate that fired on a
// non-risk, and the companion to the machine-collected `ai-flow report`. An
// enforcement layer installed with no way to argue back is how a gate gets
// switched off instead of fixed.
function ensureFrictionLog({ dryRun = false } = {}) {
  const source = path.join(templatesRoot, "docs", "DOGFOODING.md");

  if (!fs.existsSync(source)) {
    return "skipped";
  }

  return copyFileToTarget(source, path.join("docs", "DOGFOODING.md"), { dryRun });
}

// Skill files this project installed that the templates no longer expect —
// either because the skill was renamed, or because the project switched to the
// plugin as its skills channel. Only files that still match their manifest hash
// are removable; anything the user edited is reported, never deleted.
function collectStaleSkillFiles({ includeSkills = true } = {}) {
  const manifest = readManifest();
  const expected = new Set(
    getTemplateSpecs({ includeSkills })
      .filter((spec) => isSkillTarget(spec.targetRel))
      .map((spec) => normalizePortable(spec.targetRel)),
  );

  const removable = [];
  const modified = [];

  for (const [targetRel, entry] of Object.entries(manifest.files || {})) {
    const normalized = normalizePortable(targetRel);

    if (!isSkillTarget(normalized) || expected.has(normalized)) {
      continue;
    }

    const target = path.join(cwd, normalized);

    if (!fs.existsSync(target)) {
      continue;
    }

    if (entry && entry.hash && hashFile(target) !== entry.hash) {
      modified.push(normalized);
      continue;
    }

    removable.push(normalized);
  }

  return { removable: removable.sort(), modified: modified.sort() };
}

function pruneStaleSkills({ dryRun = false, force = false, includeSkills = true } = {}) {
  const { removable, modified } = collectStaleSkillFiles({ includeSkills });
  const targets = force ? [...removable, ...modified] : removable;
  const removed = [];

  for (const targetRel of targets) {
    const target = path.join(cwd, targetRel);

    if (removeFileIfExists(target, { dryRun })) {
      removed.push(targetRel);
      removeEmptyDirsUpward(path.dirname(target), cwd, { dryRun });
    }
  }

  return { removed, skippedModified: force ? [] : modified };
}

function copyTemplates({ force = false, dryRun = false, includeSkills = true, target = "claude" } = {}) {
  ensureTemplatesExist();

  const copied = [];
  const updated = [];
  const skipped = [];
  const unchanged = [];

  for (const spec of getTemplateSpecs({ includeSkills, target })) {
    const result = copyFileToTarget(spec.source, spec.targetRel, { force, dryRun });

    if (result === "copied") {
      copied.push(spec.targetRel);
    } else if (result === "updated") {
      updated.push(spec.targetRel);
    } else if (hashFile(path.join(cwd, spec.targetRel)) === hashFile(spec.source)) {
      // Still exactly what we installed (a second `init` for another agent):
      // not the user's file, so not reported as one kept from them.
      unchanged.push(spec.targetRel);
    } else {
      skipped.push(spec.targetRel);
    }
  }

  // Prune BEFORE the manifest is rewritten: it reads the entries recorded by the
  // previous install to know what it is allowed to remove.
  // A non-Claude install never owns `.claude/skills`: pruning there would delete
  // another platform's commands just because this run did not install them.
  const prunedSkills =
    target === "claude" ? pruneStaleSkills({ dryRun, force, includeSkills }) : { removed: [], skippedModified: [] };

  if (!dryRun) {
    writeManifest(force ? null : readManifest());
  }

  const harnessCreated = ensureHarnessConfig({ dryRun });

  return { copied, updated, skipped, unchanged, harnessCreated, prunedSkills };
}

function upgrade({
  force = false,
  dryRun = false,
  json = false,
  includeSkills = true,
  skillsMode = null,
  platform = "claude",
} = {}) {
  const previous = readManifest();
  const copied = [];
  const updated = [];
  const skippedModified = [];
  const unchanged = [];

  for (const spec of getTemplateSpecs({ includeSkills, target: platform }).filter((item) => item.kind === "template")) {
    const target = path.join(cwd, spec.targetRel);
    const sourceHash = hashFile(spec.source);
    const manifestEntry = previous.files ? previous.files[spec.targetRel] : null;

    if (!fs.existsSync(target)) {
      copied.push(spec.targetRel);

      if (!dryRun) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(spec.source, target);
      }

      continue;
    }

    const currentHash = hashFile(target);

    if (currentHash === sourceHash) {
      unchanged.push(spec.targetRel);
      continue;
    }

    const safeToOverwrite = force || (manifestEntry && manifestEntry.hash === currentHash);

    if (safeToOverwrite) {
      updated.push(spec.targetRel);

      if (!dryRun) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(spec.source, target);
      }
    } else {
      skippedModified.push(spec.targetRel);
    }
  }

  // Renamed skills and a project that moved to the plugin channel both leave
  // orphan skill files behind. Upgrading is exactly when they must go.
  const prunedSkills = pruneStaleSkills({ dryRun, force, includeSkills });

  if (!dryRun) {
    writeManifest(previous);
  }

  const convenience = ensureConvenienceFiles({ dryRun, force: false });

  const result = {
    copied,
    updated,
    skippedModified,
    unchanged,
    skillsMode,
    prunedSkills,
    convenience,
  };

  if (json) {
    log(JSON.stringify(result, null, 2));
    return;
  }

  if (dryRun) {
    log("Upgrade dry run complete.");
  } else {
    log("Coding Flow upgraded.");
  }

  log(`Copied: ${result.copied.length}`);
  log(`Updated: ${result.updated.length}`);
  log(`Unchanged: ${result.unchanged.length}`);
  printPrunedSkills(result.prunedSkills, { dryRun });
  printConvenienceSummary(result.convenience, { dryRun });

  if (result.skippedModified.length > 0) {
    log(`Skipped modified files: ${result.skippedModified.length}`);
    log("Use --force only if you intentionally want to overwrite local edits.");
    for (const file of result.skippedModified) {
      log(`- ${file}`);
    }
  }
}

module.exports = {
  ensureTemplatesExist,
  listTemplateSkillNames,
  getTemplateSpecs,
  isSkillTarget,
  collectStaleSkillFiles,
  pruneStaleSkills,
  printPrunedSkills,
  manifestPath,
  commandsPath,
  readManifest,
  writeManifest,
  detectProjectPackageJson,
  copyTemplates,
  copyCodexSkills,
  copyPlatformCommands,
  retireRendered,
  renderPlatformCommands,
  ensureConvenienceFiles,
  ensureFrictionLog,
  printConvenienceSummary,
  ensurePackageScripts,
  removePackageScripts,
  isGeneratedPackageJsonRemovable,
  upgrade,
};
