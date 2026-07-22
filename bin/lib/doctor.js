"use strict";

// Installation diagnostic: required files, skill frontmatter, .agents mirror,
// manifest, and (in strict mode) a quick harness check. `--fix` restores.

const fs = require("fs");
const path = require("path");

const { cwd, packageJson } = require("./context");
const { log, toPortable, parseFrontmatter, readJson, hashFile } = require("./util");
const {
  ensureTemplatesExist,
  listTemplateSkillNames,
  getTemplateSpecs,
  manifestPath,
  copyTemplates,
  syncAgentsMirror,
  writeManifest,
  readManifest,
  ensureConvenienceFiles,
} = require("./templates");
const { collectHarnessReport } = require("./harness");

function collectDoctorReport({ strict = false } = {}) {
  ensureTemplatesExist();

  const skillNames = listTemplateSkillNames();
  const required = [
    "PROJECT_RULES.md",
    "AGENT_RULES.md",
    "AGENTS.md",
    ".agents/README.md",
    "docs/project-context.md",
    "docs/architecture.md",
    "docs/conventions.md",
    "docs/roadmap.md",
    "CLAUDE.md",
  ];

  const errors = [];
  const warnings = [];

  for (const spec of getTemplateSpecs()) {
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
    const agentsSkill = path.join(cwd, ".agents", "skills", name, "SKILL.md");

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

    if (fs.existsSync(agentsSkill) && hashFile(claudeSkill) !== hashFile(agentsSkill)) {
      errors.push({
        code: "mirror_mismatch",
        file: toPortable(path.relative(cwd, agentsSkill)),
        message: `${toPortable(path.relative(cwd, agentsSkill))} does not match ${toPortable(path.relative(cwd, claudeSkill))}`,
      });
    }
  }

  const agentsRoot = path.join(cwd, ".agents", "skills");

  if (fs.existsSync(agentsRoot)) {
    for (const entry of fs.readdirSync(agentsRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && !skillNames.includes(entry.name)) {
        warnings.push({
          code: "extra_mirror_skill",
          file: `.agents/skills/${entry.name}`,
          message: `.agents/skills/${entry.name} is not part of the installed template skill set`,
        });
      }
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

  return {
    ok: errors.length === 0,
    root: cwd,
    version: packageJson.version,
    strict,
    skills: skillNames,
    errors,
    warnings,
  };
}

function doctor({ fix = false, json = false, strict = false } = {}) {
  if (fix) {
    copyTemplates({ force: false, dryRun: false });
    syncAgentsMirror({ dryRun: false });
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
    log("Run `ai-flow doctor --fix` to restore missing files and resync the .agents mirror.");
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
}

module.exports = { doctor };
