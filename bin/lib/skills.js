"use strict";

// Listing of the template skills, grouped by category.

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

  // Make the hierarchy obvious: you pick a handful of macro skills; the rest are
  // run for you by /plan-epic and /run-story when a story needs them. This is the
  // whole point — you should not have to chain the atomic skills by hand.
  const groupHint = {
    Macro: "Macro — you pick these",
    Planning: "Planning — used while planning an epic",
    Implementation: "Implementation — run for you by run-story",
    Validation: "Validation — run for you by run-story",
    Other: "Other",
  };

  log("You pick the Macro skills below. Everything else is run for you by");
  log("/plan-epic and /run-story — you don't chain the atomic skills by hand.");
  log("");

  for (const group of ["Macro", "Planning", "Implementation", "Validation", "Other"]) {
    const items = groups.get(group) || [];

    if (items.length === 0) {
      continue;
    }

    log(`${groupHint[group] || group}:`);
    for (const skill of items) {
      log(`- ${skill.name}: ${skill.description}`);
    }
    log("");
  }
}

module.exports = { listSkills };
