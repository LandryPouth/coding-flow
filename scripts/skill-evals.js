"use strict";

// Skill evals: does each skill FIRE when it should, and stay distinct from its
// six neighbours?
//
// The engine has 433 tests. Until this file, the skills had none — nothing
// proved that `flow-status` wins "where does the project stand" and loses
// "what should I do next" to `flow-next`. That is the tool's stated first risk:
// a skill nobody triggers is a skill that does not exist.
//
// Two tiers, both deterministic and free, both run by test/skill-evals.test.js
// so they ride the existing `npm test` into CI:
//
//   Tier 1 (lint)    — anatomy: frontmatter, naming, size, required sections.
//   Tier 2 (trigger) — routing: a realistic prompt must rank its owner first,
//                      and no two descriptions may near-collide.
//
// Prior art: the three-tier framing and the positive/negative/`owner` case
// shape are adapted from addyosmani/agent-skills (`evals/`), itself building on
// Anthropic's skill-creator. The behavioural tier (spend tokens, run an agent,
// grade the transcript) is deliberately NOT implemented here — see evals/README.md.
//
// Tier 2 is a LEXICAL approximation of routing, not a semantic one. It cannot
// tell you a description is confusing; it tells you a description is missing
// the words users actually say, or is broad enough to swallow its neighbour's
// prompts. Those are the two failure modes that dominate real trigger bugs.
//
// This file never ships to npm (`files` in package.json covers bin/ and
// templates/ only). It costs users nothing.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SKILLS_DIR = path.join(ROOT, "skills");
const CASES_DIR = path.join(ROOT, "evals", "cases");

// The description is the only part of a skill that sits in context before the
// agent decides, so it has its own budget. The 500-line ceiling on the body is
// NOT checked here: test/ceremony.test.js already owns it, and an invariant
// enforced in two places is an invariant that drifts.
const MAX_DESCRIPTION_CHARS = 1024;

// Cosine similarity between two descriptions. At 0.75 the pair is close enough
// that a router picking between them is coin-flipping; at 0.50 it is worth a
// look but two skills in one workflow family legitimately share vocabulary.
const COLLISION_ERROR = 0.75;
const COLLISION_WARN = 0.5;

// --- reading -----------------------------------------------------------------

// A local 12-line frontmatter reader rather than bin/lib/util.js's. The linter
// is a dev tool with its own lifecycle and the engine is deliberately left
// alone; test/ already re-implements its small helpers the same way.
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);

  if (!match) {
    return null;
  }

  const data = {};

  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");

    if (separator === -1) {
      continue;
    }

    data[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }

  return data;
}

function loadSkills(dir = SKILLS_DIR) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const file = path.join(dir, entry.name, "SKILL.md");
      const content = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;

      return {
        dir: entry.name,
        file,
        content,
        frontmatter: content ? parseFrontmatter(content) : null,
        lines: content ? content.split(/\r?\n/).length : 0,
      };
    })
    .sort((a, b) => a.dir.localeCompare(b.dir));
}

function loadCases(dir = CASES_DIR) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({
      name,
      ...JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")),
    }));
}

// --- Tier 1: anatomy lint ----------------------------------------------------

// Returns a flat list of problems. Empty means the catalog is well-formed.
// Parity between `skills/` and `templates/.claude/skills/` is NOT checked here:
// `ai-flow plugin check` already owns that, and test/plugin.test.js runs it.
function lintSkills(skills = loadSkills()) {
  const problems = [];
  const seenNames = new Map();

  for (const skill of skills) {
    const where = `skills/${skill.dir}/SKILL.md`;

    if (skill.content === null) {
      problems.push(`${where}: missing`);
      continue;
    }

    if (!skill.frontmatter) {
      problems.push(`${where}: no YAML frontmatter`);
      continue;
    }

    const { name, description } = skill.frontmatter;

    if (!name) {
      problems.push(`${where}: frontmatter has no \`name\``);
    } else if (name !== skill.dir) {
      problems.push(`${where}: \`name: ${name}\` does not match the directory \`${skill.dir}\``);
    } else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
      problems.push(`${where}: \`name: ${name}\` is not lowercase-hyphen-separated`);
    }

    if (name && seenNames.has(name)) {
      problems.push(`${where}: duplicate skill name, already used by ${seenNames.get(name)}`);
    } else if (name) {
      seenNames.set(name, where);
    }

    if (!description) {
      problems.push(`${where}: frontmatter has no \`description\``);
    } else {
      if (description.length > MAX_DESCRIPTION_CHARS) {
        problems.push(
          `${where}: description is ${description.length} chars, over the ${MAX_DESCRIPTION_CHARS} budget`,
        );
      }

      // The description is the only part an agent reads before deciding. If it
      // never says when to reach for the skill, the skill is invisible until
      // someone names it by hand.
      if (!/\buse\b/i.test(description)) {
        problems.push(`${where}: description states what the skill does but never when to use it`);
      }
    }

    // Exit criteria are the part a skill is most tempted to leave implicit, and
    // the part that decides whether "done" meant anything.
    if (!/^## Verification$/m.test(skill.content)) {
      problems.push(`${where}: no \`## Verification\` section — the skill has no stated exit criteria`);
    }
  }

  return problems;
}

// Every skill carries a case file, with enough prompts to mean something.
function lintCases(skills = loadSkills(), cases = loadCases()) {
  const problems = [];
  const bySkill = new Map(cases.map((entry) => [entry.skill, entry]));
  const names = new Set(skills.map((skill) => skill.dir));

  for (const skill of skills) {
    const entry = bySkill.get(skill.dir);

    if (!entry) {
      problems.push(`evals/cases/${skill.dir}.json: missing — every skill ships with one`);
      continue;
    }

    const positive = entry.trigger?.positive || [];
    const negative = entry.trigger?.negative || [];

    if (positive.length < 3) {
      problems.push(`evals/cases/${entry.name}: ${positive.length} positive prompts, needs at least 3`);
    }

    if (negative.length < 2) {
      problems.push(`evals/cases/${entry.name}: ${negative.length} negative prompts, needs at least 2`);
    }

    for (const item of negative) {
      // A negative without an owner can pass vacuously: the prompt matches
      // nothing, this skill does not rank first, and no routing was tested.
      // Naming the owner turns it into a real pairwise assertion.
      if (item.owner && !names.has(item.owner)) {
        problems.push(`evals/cases/${entry.name}: negative names unknown owner \`${item.owner}\``);
      }

      if (item.owner === entry.skill) {
        problems.push(`evals/cases/${entry.name}: a negative cannot be owned by the skill under test`);
      }
    }
  }

  for (const entry of cases) {
    if (!names.has(entry.skill)) {
      problems.push(`evals/cases/${entry.name}: \`skill: ${entry.skill}\` matches no skill directory`);
    }
  }

  return problems;
}

// --- Tier 2: lexical routing -------------------------------------------------

const STOPWORDS = new Set(
  ("a an and are as at be been but by can do does for from has have how i if in into is it its me my no not of on"
    + " one only or our so than that the their them then there these they this to up use used uses using want was we"
    + " what when where which who why will with would you your"
    // Filler adverbs. Fixed once as a property of English, never tuned per
    // failing prompt — that would be writing the eval around the answer. They
    // earn their place: "actually" is filler in "make sure the tests actually
    // pass" but load-bearing vocabulary in flow-status's description ("where
    // every epic and story actually stands"), so leaving it in let a status
    // skill win an implementation prompt on a word the user meant as noise.
    + " actually actual also here just okay ok please really now sure very well")
    .split(" "),
);

// Deliberately crude, and applied identically to prompts and descriptions so
// the two sides always meet in the middle. A real stemmer would be a dependency
// and this repo has none.
function stem(word) {
  let out = word;

  if (out.endsWith("'s")) out = out.slice(0, -2);
  if (out.length > 4 && out.endsWith("ies")) return `${out.slice(0, -3)}y`;
  if (out.length > 4 && out.endsWith("sses")) return out.slice(0, -2);
  if (out.length > 5 && out.endsWith("ing")) return out.slice(0, -3);
  if (out.length > 4 && out.endsWith("ed")) return out.slice(0, -2);
  if (out.length > 3 && out.endsWith("s") && !out.endsWith("ss")) return out.slice(0, -1);

  return out;
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word))
    .map(stem);
}

// One document per skill: its name plus its description. Nothing from the body
// — the body is not in context when the router decides, so scoring it would
// measure something the agent never sees.
function buildIndex(skills = loadSkills()) {
  const docs = skills
    .filter((skill) => skill.frontmatter?.description)
    .map((skill) => ({
      skill: skill.dir,
      terms: tokenize(`${skill.dir} ${skill.frontmatter.description}`),
    }));

  const documentFrequency = new Map();

  for (const doc of docs) {
    for (const term of new Set(doc.terms)) {
      documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
    }
  }

  // ln(1 + N/df): a term in every description — "flow", "story", "ai" — lands
  // near zero and stops deciding anything, which is exactly right for a catalog
  // whose skills are all named flow-*.
  const idf = (term) => Math.log(1 + docs.length / (documentFrequency.get(term) || docs.length));

  // lnc weighting: log term frequency, then L2-normalised, so flow-run's longer
  // description cannot outrank flow-setup by sheer word count.
  const vectors = docs.map((doc) => {
    const weights = new Map();

    for (const term of doc.terms) {
      weights.set(term, (weights.get(term) || 0) + 1);
    }

    for (const [term, count] of weights) {
      weights.set(term, (1 + Math.log(count)) * idf(term));
    }

    const norm = Math.sqrt([...weights.values()].reduce((sum, w) => sum + w * w, 0)) || 1;

    for (const [term, weight] of weights) {
      weights.set(term, weight / norm);
    }

    return { skill: doc.skill, weights };
  });

  return { vectors, idf };
}

// Skills ranked best-first for a prompt. Ties break alphabetically, so a run is
// reproducible and a tie never silently favours whichever skill sorted first on
// this filesystem.
function rank(prompt, index) {
  const query = tokenize(prompt);

  return index.vectors
    .map((vector) => ({
      skill: vector.skill,
      score: query.reduce((sum, term) => sum + (vector.weights.get(term) || 0) * index.idf(term), 0),
    }))
    .sort((a, b) => b.score - a.score || a.skill.localeCompare(b.skill));
}

function cosine(a, b) {
  let sum = 0;

  for (const [term, weight] of a.weights) {
    sum += weight * (b.weights.get(term) || 0);
  }

  return sum;
}

function findCollisions(index) {
  const pairs = [];

  for (let i = 0; i < index.vectors.length; i += 1) {
    for (let j = i + 1; j < index.vectors.length; j += 1) {
      const similarity = cosine(index.vectors[i], index.vectors[j]);

      if (similarity >= COLLISION_WARN) {
        pairs.push({
          a: index.vectors[i].skill,
          b: index.vectors[j].skill,
          similarity,
          level: similarity >= COLLISION_ERROR ? "error" : "warn",
        });
      }
    }
  }

  return pairs.sort((x, y) => y.similarity - x.similarity);
}

// Runs every prompt in every case file. `failures` are hard: a positive that
// missed its top_k, or a negative this skill won anyway.
function runTriggerEvals(skills = loadSkills(), cases = loadCases()) {
  const index = buildIndex(skills);
  const failures = [];
  let positives = 0;
  let rank1 = 0;

  for (const entry of cases) {
    for (const item of entry.trigger?.positive || []) {
      const ranked = rank(item.prompt, index);
      const position = ranked.findIndex((row) => row.skill === entry.skill) + 1;
      const topK = item.top_k || 3;

      positives += 1;

      if (position === 1) {
        rank1 += 1;
      }

      if (position === 0 || position > topK) {
        failures.push(
          `${entry.skill} < "${item.prompt}" ranked ${position || "nowhere"} (needed top ${topK}); `
            + `won by ${ranked[0].skill}`,
        );
      }
    }

    for (const item of entry.trigger?.negative || []) {
      const ranked = rank(item.prompt, index);

      if (ranked[0].skill === entry.skill) {
        failures.push(`${entry.skill} > "${item.prompt}" should not rank first (owner: ${item.owner || "another skill"})`);
      }

      if (item.owner) {
        const owner = ranked.findIndex((row) => row.skill === item.owner) + 1;
        const self = ranked.findIndex((row) => row.skill === entry.skill) + 1;

        if (owner === 0 || owner > self) {
          failures.push(`${entry.skill} > "${item.prompt}" — owner ${item.owner} ranked ${owner || "nowhere"}, below ${entry.skill} at ${self}`);
        }
      }
    }
  }

  return {
    positives,
    rank1,
    rank1Rate: positives ? Math.round((rank1 / positives) * 1000) / 10 : 0,
    failures,
    collisions: findCollisions(index),
  };
}

module.exports = {
  MAX_DESCRIPTION_CHARS,
  COLLISION_ERROR,
  COLLISION_WARN,
  loadSkills,
  loadCases,
  lintSkills,
  lintCases,
  tokenize,
  buildIndex,
  rank,
  findCollisions,
  runTriggerEvals,
};

// --- CLI ---------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);
  const floorArg = args.indexOf("--min-rank1");
  const floor = floorArg === -1 ? null : Number(args[floorArg + 1]);
  const skills = loadSkills();
  const problems = [...lintSkills(skills), ...lintCases(skills)];
  const result = runTriggerEvals(skills);

  for (const problem of problems) {
    process.stdout.write(`lint: ${problem}\n`);
  }

  for (const failure of result.failures) {
    process.stdout.write(`trigger: ${failure}\n`);
  }

  for (const collision of result.collisions) {
    process.stdout.write(
      `collision (${collision.level}): ${collision.a} <-> ${collision.b} at ${(collision.similarity * 100).toFixed(0)}%\n`,
    );
  }

  process.stdout.write(
    `\n${skills.length} skills, ${result.positives} positive prompts, rank-1 ${result.rank1Rate}%\n`,
  );

  const blocked =
    problems.length > 0
    || result.failures.length > 0
    || result.collisions.some((c) => c.level === "error")
    || (floor !== null && result.rank1Rate < floor);

  process.exit(blocked ? 1 : 0);
}
