"use strict";

// Installation diagnostic: required files, skill frontmatter, manifest, and (in
// strict mode) a quick harness check. `--fix` restores.

const fs = require("fs");
const path = require("path");

const { cwd, packageJson } = require("./context");
const { log, toPortable, parseFrontmatter, readJson, hashFile, isCommandAvailable, binaryPathNote } = require("./util");
const {
  ensureTemplatesExist,
  listTemplateSkillNames,
  getTemplateSpecs,
  manifestPath,
  copyTemplates,
  writeManifest,
  readManifest,
  ensureConvenienceFiles,
} = require("./templates");
const { collectHarnessReport } = require("./harness");
const { readConfig } = require("./config");
const { scanProject } = require("./bootstrap");
const { getStorage } = require("./storage");

// Past this many stories, an epic is no longer one shippable capability (see
// the WIP-limit heuristic in `/flow-plan`) — it also sits open longer before
// auto-merge sees every story proven, so a bloated epic is slower to land, not
// just harder to reason about.
const EPIC_STORY_SOFT_LIMIT = 7;

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

// The epic/story number is picked from a local, unsynced scan of `epics/` at
// plan time. Two people branching from the same base can independently land
// on `epic-05-` (or the same story number inside one epic) with different
// slugs — no Git conflict, since the directory names differ, but the number
// stops being unique the moment both branches merge. Nothing can prevent that
// race without a shared counter this tool deliberately does not have, so
// `doctor` catches it mechanically right after the merge instead, while a
// rename is still a one-line fix.
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

function collectDoctorReport({ strict = false } = {}) {
  ensureTemplatesExist();

  // The install recorded which channel serves its skills. Doctor must judge the
  // project against THAT decision, not against whether this particular machine
  // happens to have the plugin.
  const skillsMode = readConfig(cwd).skills;
  const includeSkills = skillsMode === "project";
  const skillNames = listTemplateSkillNames();
  const required = [
    "RULES.md",
    "docs/project-context.md",
    "docs/architecture.md",
    "docs/conventions.md",
    "docs/roadmap.md",
    "CLAUDE.md",
  ];

  const errors = [];
  const warnings = [];

  for (const spec of getTemplateSpecs({ includeSkills })) {
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
  checkOversizedEpics(warnings);
  checkDuplicateNumbering(warnings);

  return {
    ok: errors.length === 0,
    root: cwd,
    version: packageJson.version,
    strict,
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
  };
}

function doctor({ fix = false, json = false, strict = false } = {}) {
  if (fix) {
    copyTemplates({
      force: false,
      dryRun: false,
      includeSkills: readConfig(cwd).skills === "project",
    });
    writeManifest(readManifest());
    ensureConvenienceFiles({ dryRun: false, force: false });
  }

  const report = collectDoctorReport({ strict });

  if (json) {
    log(JSON.stringify(report, null, 2));
  } else if (report.ok) {
    log("Coding Flow is installed correctly.");

    if (report.warnings.length > 0) {
      log("");
      log("Warnings:");
      for (const warning of report.warnings) {
        log(`- ${warning.message}`);
      }
    }

    log("");
    log(binaryPathNote(report.binaryOnPath));
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

    log("");
    log("Run `ai-flow doctor --fix` to restore missing files.");
    log("");
    log(binaryPathNote(report.binaryOnPath));
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
}

module.exports = { doctor };
