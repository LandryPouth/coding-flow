#!/usr/bin/env node
// Tag and GitHub release for a version the maintainer already published on npm.
// Never runs `npm publish`. Idempotent: every step checks before it acts.
//
//   npm run release              # tag + push + gh release
//   npm run release -- --dry-run # print the plan, change nothing

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");

function sh(cmd, args, { allowFail = false } = {}) {
  try {
    return execFileSync(cmd, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (err) {
    if (allowFail) return null;
    const detail = `${err.stderr || err.message}`.trim();
    fail(`\`${cmd} ${args.join(" ")}\` failed${detail ? `: ${detail}` : ""}`);
  }
}

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function changelogSection(text, version) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start === -1) return null;
  let end = lines.findIndex((line, i) => i > start && line.startsWith("## ["));
  if (end === -1) end = lines.length;
  return lines.slice(start + 1, end).join("\n").trim();
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;
const tag = `v${version}`;

const section = changelogSection(fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8"), version);
if (!section) fail(`CHANGELOG.md has no "## [${version}]" section — write it first`);

if (sh("npm", ["view", `${pkg.name}@${version}`, "version"], { allowFail: true }) !== version) {
  fail(`${pkg.name}@${version} is not published on npm — run \`npm publish\` first (this script never does)`);
}

const tagExists = sh("git", ["tag", "-l", tag]) === tag;
const releaseExists = sh("gh", ["release", "view", tag], { allowFail: true }) !== null;

const plan = [];
if (!tagExists) plan.push(`create annotated tag ${tag}`, `push tag ${tag} to origin`);
if (!releaseExists) plan.push(`gh release create ${tag} with the CHANGELOG ${version} section`);

if (plan.length === 0) {
  console.log(`release: ${tag} already has a tag and a release — nothing to do`);
  process.exit(0);
}

if (dryRun) {
  console.log(`release (dry run) — would:\n${plan.map((step) => `  - ${step}`).join("\n")}`);
  process.exit(0);
}

if (!tagExists) {
  sh("git", ["tag", "-a", tag, "-m", `${pkg.name} ${version}`]);
  sh("git", ["push", "origin", tag]);
  console.log(`release: tagged and pushed ${tag}`);
}
if (!releaseExists) {
  sh("gh", ["release", "create", tag, "--title", tag, "--notes", section]);
  console.log(`release: created GitHub release ${tag}`);
}
