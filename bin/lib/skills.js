"use strict";

// Listing of the template skills. The set is small and flat — one skill per stage
// of the workflow — so there is no macro/atomic hierarchy to explain: you pick any
// of these directly. Depth (STANDARD/STRICT modes, deep validators, context scout)
// lives as opt-in sections inside `run` and `review`, not as separate front-door
// skills.

const fs = require("fs");
const path = require("path");

const { templatesRoot } = require("./context");
const { log, parseFrontmatter } = require("./util");
const { ensureTemplatesExist, listTemplateSkillNames } = require("./templates");

// The intended workflow order. Any skill not listed here (e.g. one added later)
// still appears, after these, in alphabetical order.
const WORKFLOW_ORDER = ["flow-setup", "flow-plan", "flow-run", "flow-verify", "flow-review", "flow-ship"];

function readTemplateSkillInfo(name) {
  const file = path.join(templatesRoot, ".claude", "skills", name, "SKILL.md");
  const content = fs.readFileSync(file, "utf8");
  const frontmatter = parseFrontmatter(content) || {};

  return {
    name,
    description: frontmatter.description || "",
  };
}

function orderSkills(skills) {
  return [...skills].sort((a, b) => {
    const ai = WORKFLOW_ORDER.indexOf(a.name);
    const bi = WORKFLOW_ORDER.indexOf(b.name);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.name.localeCompare(b.name);
  });
}

function listSkills({ json = false } = {}) {
  ensureTemplatesExist();

  const skills = orderSkills(listTemplateSkillNames().map(readTemplateSkillInfo));

  if (json) {
    log(JSON.stringify(skills, null, 2));
    return;
  }

  log("The skills, in workflow order. Pick any of them directly — the deeper");
  log("modes and validators live as opt-in sections inside flow-run and flow-review.");
  log("");

  for (const skill of skills) {
    log(`- ${skill.name}: ${skill.description}`);
  }
}

module.exports = { listSkills };
