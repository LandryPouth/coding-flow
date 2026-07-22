"use strict";

// Brownfield scan: detects frameworks, scripts, directories, tests, and writes
// docs/bootstrap-scan.md to seed the project context.

const fs = require("fs");
const path = require("path");

const { cwd } = require("./context");
const { log, toPortable, readJson, findDirectories } = require("./util");

function detectPackageJson() {
  const packagePath = path.join(cwd, "package.json");

  if (!fs.existsSync(packagePath)) {
    return null;
  }

  return readJson(packagePath, {});
}

function bootstrapScan({ json = false, dryRun = false } = {}) {
  const pkg = detectPackageJson();
  const rootFiles = fs.readdirSync(cwd, { withFileTypes: true });
  const topDirectories = rootFiles
    .filter((entry) => entry.isDirectory() && ![".git", "node_modules"].includes(entry.name))
    .map((entry) => entry.name)
    .sort();

  const configFiles = rootFiles
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /(^\.env|config|tsconfig|vite|next|nuxt|svelte|tailwind|eslint|prettier|docker|render|vercel|package\.json|pnpm-lock|yarn\.lock|package-lock)/i.test(name))
    .sort();

  const testDirs = findDirectories(cwd, (_fullPath, name) => /^(test|tests|__tests__|e2e|specs?)$/i.test(name), 3)
    .map((dir) => toPortable(path.relative(cwd, dir)));

  const deps = pkg ? Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).sort() : [];
  const scripts = pkg && pkg.scripts ? pkg.scripts : {};
  const frameworks = [];

  for (const [name, pattern] of [
    ["Next.js", /^next$/],
    ["React", /^react$/],
    ["Vue", /^vue$/],
    ["Svelte", /^svelte$/],
    ["Express", /^express$/],
    ["Prisma", /^prisma$|^@prisma\/client$/],
    ["Tailwind", /^tailwindcss$/],
    ["Vitest", /^vitest$/],
    ["Jest", /^jest$/],
    ["Playwright", /^@playwright\/test$|^playwright$/],
  ]) {
    if (deps.some((dep) => pattern.test(dep))) {
      frameworks.push(name);
    }
  }

  const scan = {
    generatedAt: new Date().toISOString(),
    root: cwd,
    packageName: pkg ? pkg.name || null : null,
    detectedFrameworks: frameworks,
    scripts,
    topDirectories,
    configFiles,
    testDirectories: testDirs,
    recommendedNextPrompt:
      "Use /bootstrap-brownfield with docs/bootstrap-scan.md to fill project context, architecture, conventions, and roadmap. Do not modify application code.",
  };

  if (json) {
    log(JSON.stringify(scan, null, 2));
  }

  const output = [
    "# Bootstrap Scan",
    "",
    `Generated: ${scan.generatedAt}`,
    "",
    "## Package",
    "",
    `- Name: ${scan.packageName || "unknown"}`,
    `- Detected frameworks: ${scan.detectedFrameworks.length ? scan.detectedFrameworks.join(", ") : "unknown"}`,
    "",
    "## Scripts",
    "",
    ...Object.entries(scripts).map(([name, value]) => `- ${name}: \`${value}\``),
    ...(Object.keys(scripts).length === 0 ? ["- none detected"] : []),
    "",
    "## Top Directories",
    "",
    ...topDirectories.map((name) => `- ${name}/`),
    "",
    "## Config Files",
    "",
    ...configFiles.map((name) => `- ${name}`),
    ...(configFiles.length === 0 ? ["- none detected"] : []),
    "",
    "## Test Directories",
    "",
    ...testDirs.map((name) => `- ${name}/`),
    ...(testDirs.length === 0 ? ["- none detected"] : []),
    "",
    "## Recommended Next Prompt",
    "",
    "```txt",
    scan.recommendedNextPrompt,
    "```",
    "",
  ].join("\n");

  const outputPath = path.join(cwd, "docs", "bootstrap-scan.md");

  if (!dryRun) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, output);
  }

  if (!json) {
    if (dryRun) {
      log(output);
    } else {
      log("Bootstrap scan written to docs/bootstrap-scan.md");
      log("");
      log(scan.recommendedNextPrompt);
    }
  }
}

module.exports = { bootstrapScan };
