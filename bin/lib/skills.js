"use strict";

// Listing des skills de template, groupes par categorie.

const fs = require("fs");
const path = require("path");

const { templatesRoot } = require("./context");
const { log, parseFrontmatter } = require("./util");
const { ensureTemplatesExist, listTemplateSkillNames } = require("./templates");

function readTemplateSkillInfo(name) {
  const file = path.join(templatesRoot, ".claude", "skills", name, "SKILL.md");
  const content = fs.readFileSync(file, "utf8");
  const frontmatter = parseFrontmatter(content) || {};

  return {
    name,
    description: frontmatter.description || "",
  };
}

function skillGroup(name) {
  if (["quick-story", "plan-epic", "run-story", "run-story-secure"].includes(name)) {
    return "Macro";
  }

  if (name.startsWith("blueprint-") || ["agent-planner", "bootstrap-brownfield", "grill-me", "write-story"].includes(name)) {
    return "Planning";
  }

  if (name.includes("validator") || name.endsWith("-check") || name === "review-codebase") {
    return "Validation";
  }

  if (name.startsWith("agent-worker") || ["agent-context-scout", "implement-slice", "tdd"].includes(name)) {
    return "Implementation";
  }

  return "Other";
}

function listSkills({ json = false } = {}) {
  ensureTemplatesExist();

  const skills = listTemplateSkillNames().map(readTemplateSkillInfo);

  if (json) {
    log(JSON.stringify(skills, null, 2));
    return;
  }

  const groups = new Map();

  for (const skill of skills) {
    const group = skillGroup(skill.name);

    if (!groups.has(group)) {
      groups.set(group, []);
    }

    groups.get(group).push(skill);
  }

  for (const group of ["Macro", "Planning", "Implementation", "Validation", "Other"]) {
    const items = groups.get(group) || [];

    if (items.length === 0) {
      continue;
    }

    log(`${group}:`);
    for (const skill of items) {
      log(`- ${skill.name}: ${skill.description}`);
    }
    log("");
  }
}

module.exports = { listSkills };
