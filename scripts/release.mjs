#!/usr/bin/env node
// Tag and GitHub release for a version the maintainer already published on npm.
// Never runs `npm publish`. Idempotent: every step checks before it acts.
//
//   npm run release              # tag + push + gh release
//   npm run release -- --dry-run # print the plan, change nothing

import { execFileSync, spawnSync } from "node:child_process";
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
if (section === null) fail(`CHANGELOG.md has no "## [${version}]" section — write it first`);
if (section === "") fail(`CHANGELOG.md "## [${version}]" section is empty — write the notes first`);

// npm is npm.cmd on Windows, which only a shell can spawn.
const npmShell = process.platform === "win32";
const npmView = spawnSync("npm", ["view", `${pkg.name}@${version}`, "version"], { cwd: root, encoding: "utf8", shell: npmShell });
if (npmView.error || (npmView.status !== 0 && !/E404/.test(npmView.stderr || ""))) {
  fail(`could not ask npm whether ${pkg.name}@${version} is published: ${(npmView.error?.message || npmView.stderr || "").trim()}`);
}
if ((npmView.stdout || "").trim() !== version) {
  fail(`${pkg.name}@${version} is not published on npm — run \`npm publish\` first (this script never does)`);
}

const remoteTagExists = sh("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`]) !== "";
let tagExists = sh("git", ["tag", "-l", tag]) === tag;
if (!tagExists && remoteTagExists && !dryRun) {
  // Never mint a second tag on HEAD when origin already has one: adopt it.
  sh("git", ["fetch", "origin", `refs/tags/${tag}:refs/tags/${tag}`]);
  tagExists = true;
}
const releaseExists = sh("gh", ["release", "view", tag], { allowFail: true }) !== null;

const plan = [];
if (!tagExists && remoteTagExists) plan.push(`fetch tag ${tag} from origin`);
if (!tagExists && !remoteTagExists) plan.push(`create annotated tag ${tag} on ${sh("git", ["rev-parse", "--short", "HEAD"])}`);
if (!remoteTagExists) plan.push(`push tag ${tag} to origin`);
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
  // The tag lands on HEAD: refuse a checkout that is not what was published.
  if (sh("git", ["status", "--porcelain", "-uno"]) !== "") {
    fail("the working tree has uncommitted changes — tag from a clean checkout of the published commit");
  }
  if (sh("git", ["branch", "-r", "--contains", "HEAD"]) === "") {
    fail("HEAD is not on any remote branch — check out the commit you published, pushed to origin");
  }
  // npm records the commit it was published from; tag that one, not whatever is checked out.
  const gitHead = spawnSync("npm", ["view", `${pkg.name}@${version}`, "gitHead"], { cwd: root, encoding: "utf8", shell: npmShell }).stdout?.trim();
  if (gitHead && gitHead !== sh("git", ["rev-parse", "HEAD"])) {
    fail(`npm published ${version} from ${gitHead.slice(0, 7)}, but HEAD is ${sh("git", ["rev-parse", "--short", "HEAD"])} — check out ${gitHead.slice(0, 7)} first`);
  }
  sh("git", ["tag", "-a", tag, "-m", `${pkg.name} ${version}`]);
  console.log(`release: tagged ${tag}`);
}
if (!remoteTagExists) {
  sh("git", ["push", "origin", tag]);
  console.log(`release: pushed ${tag}`);
}
if (!releaseExists) {
  sh("gh", ["release", "create", tag, "--title", tag, "--notes", section]);
  console.log(`release: created GitHub release ${tag}`);
}
