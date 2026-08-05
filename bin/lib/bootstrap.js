"use strict";

// Brownfield scan: detects frameworks, scripts, directories, and tests.
//
// The scan is mechanical — readdir plus a few regexes over package.json deps. It
// understands nothing about the code, costs milliseconds, and is always true at
// the moment it runs. So it is a *function*, not an artifact: `init` calls
// scanProject() to tell the user whether this is a brownfield repo, and writes
// nothing. Only the explicit `bootstrap --scan` command materializes a document,
// for humans and CI who want one.

const fs = require("fs");
const path = require("path");

const { cwd } = require("./context");
const { log, toPortable, readJson, findDirectories } = require("./util");

// Directories Coding Flow itself installs, plus the usual noise. They say nothing
// about whether the repo holds code — and `init` runs the scan *after* laying
// docs/ and epics/ down, so counting them would make every project look alive.
const NON_CODE_DIRECTORIES = new Set([
  ".git",
  ".github",
  ".claude",
  ".coding-flow",
  "node_modules",
  "docs",
  "epics",
  "examples",
]);

// `init` writes its own flow:* scripts into package.json before the scan runs, so
// counting them would make an empty repo look like a live project. Same reason we
// drop docs/ and epics/ above: never read our own scaffold back as project signal.
const OWN_SCRIPT = /^flow(:|$)/;

const FRAMEWORK_DETECTORS = [
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
];

const RECOMMENDED_NEXT_PROMPT =
  "Use /flow-plan (its Brownfield Bootstrap section) to turn this scan into project context, architecture, conventions, and roadmap. Do not modify application code.";

// A plain object, or null for anything else. JSON.parse happily returns arrays,
// strings, and numbers; every reader below assumes key/value pairs.
function asObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

// Did the project put anything of its own in this package.json? `init` writes
// only flow:* scripts, so a dependency or any foreign script means the file now
// describes the project — even though we were the one who created it.
function hasProjectSignal(pkg) {
  const dependencies = asObject(pkg.dependencies) || {};
  const devDependencies = asObject(pkg.devDependencies) || {};

  if (Object.keys(dependencies).length + Object.keys(devDependencies).length > 0) {
    return true;
  }

  return Object.keys(asObject(pkg.scripts) || {}).some((name) => !OWN_SCRIPT.test(name));
}

// The project's own package.json, or null. `init` creates a minimal one when the
// repo has none, so a bare existence check would report every Python or Go repo as
// JavaScript the moment we scaffolded it. The manifest records that authorship —
// but only until the project fills the file in, otherwise a greenfield repo that
// later becomes a real Next.js app would stay invisible to the scan forever.
function detectProjectPackageJson() {
  const packagePath = path.join(cwd, "package.json");

  if (!fs.existsSync(packagePath)) {
    return { pkg: null, unreadable: false };
  }

  const pkg = asObject(readJson(packagePath, null));

  if (pkg === null) {
    // Present but not parseable as an object — a merge conflict, a truncated
    // write. Silently scanning to "no JavaScript signal" would blame the stack
    // for a broken file, so the scan reports this case in its own right.
    return { pkg: null, unreadable: true };
  }

  const manifest = asObject(readJson(path.join(cwd, ".coding-flow", "manifest.json"), null)) || {};

  if (manifest.packageJsonCreated === true && !hasProjectSignal(pkg)) {
    return { pkg: null, unreadable: false };
  }

  return { pkg, unreadable: false };
}

// `rich`/`thin`/`empty` is the answer to "did the scan understand this project?".
// It matters because every detector here is JavaScript: a Django, Go, or Rust repo
// scans to nothing and would otherwise be indistinguishable from a fresh project.
// `looksLikeCode` is what separates those two cases.
function classifyScan(scan) {
  const hasFrameworks = scan.detectedFrameworks.length > 0;
  // Member scripts count: in a monorepo the root manifest is often a shell, and
  // classifying it `empty` would send /flow-plan in blind on a live codebase.
  const hasScripts =
    Object.keys(scan.scripts).length > 0 || (scan.workspace && scan.workspace.memberScriptCount > 0);

  // Only package.json evidence counts. A `tests/` directory is a stack-agnostic
  // directory name — it fires on Python and Go too, so letting it lift the verdict
  // would report a stack we did not recognize as one we partly did.
  if (!hasFrameworks && !hasScripts) {
    return "empty";
  }

  return hasFrameworks && hasScripts ? "rich" : "thin";
}

// One level of glob, no recursion, and a hard cap. The scan runs on every `init`
// now, so it does not get to walk a large repository looking for manifests.
const MAX_WORKSPACE_MEMBERS = 50;

// Which file declares this repo a JS workspace, and the patterns it declares.
// pnpm's YAML is parsed by regex on purpose: a workspace list is a flat sequence
// of quoted strings, and the zero-dependency rule is not worth breaking for it.
function detectWorkspace(pkg) {
  if (pkg && Array.isArray(pkg.workspaces)) {
    return { marker: "package.json", patterns: pkg.workspaces.filter((p) => typeof p === "string") };
  }

  // npm also accepts { packages: [...] } under `workspaces`.
  if (pkg && asObject(pkg.workspaces) && Array.isArray(pkg.workspaces.packages)) {
    return {
      marker: "package.json",
      patterns: pkg.workspaces.packages.filter((p) => typeof p === "string"),
    };
  }

  const pnpmPath = path.join(cwd, "pnpm-workspace.yaml");

  if (fs.existsSync(pnpmPath)) {
    const patterns = [];

    for (const line of readTextSafely(pnpmPath).split(/\r?\n/)) {
      const match = /^\s*-\s*["']?([^"'#]+?)["']?\s*$/.exec(line);

      if (match) {
        patterns.push(match[1].trim());
      }
    }

    return { marker: "pnpm-workspace.yaml", patterns };
  }

  for (const name of ["lerna.json", "turbo.json", "nx.json"]) {
    if (fs.existsSync(path.join(cwd, name))) {
      const config = asObject(readJson(path.join(cwd, name), null)) || {};
      const patterns = Array.isArray(config.packages)
        ? config.packages.filter((p) => typeof p === "string")
        : [];

      return { marker: name, patterns };
    }
  }

  return { marker: null, patterns: [] };
}

function readTextSafely(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

// Resolves `packages/*`, `apps/*`, or a literal directory to member manifests.
// Anything more exotic (`**`, negations, nested workspaces) is skipped rather
// than half-supported: the workspace marker alone is already enough to stop the
// scan from claiming a foreign stack.
function readWorkspaceMembers(patterns) {
  const members = [];
  const seen = new Set();

  for (const pattern of patterns) {
    if (members.length >= MAX_WORKSPACE_MEMBERS) {
      break;
    }

    const normalized = pattern.replace(/\/+$/, "");
    const starIndex = normalized.indexOf("*");
    let candidates = [];

    if (starIndex === -1) {
      candidates = [normalized];
    } else if (normalized.endsWith("/*") && !normalized.slice(0, -2).includes("*")) {
      const parent = path.join(cwd, normalized.slice(0, -2));

      if (fs.existsSync(parent)) {
        candidates = fs
          .readdirSync(parent, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => path.join(normalized.slice(0, -2), entry.name));
      }
    }

    for (const candidate of candidates) {
      if (members.length >= MAX_WORKSPACE_MEMBERS || seen.has(candidate)) {
        continue;
      }

      seen.add(candidate);
      const memberPkg = asObject(readJson(path.join(cwd, candidate, "package.json"), null));

      if (memberPkg) {
        members.push({ dir: toPortable(candidate), pkg: memberPkg });
      }
    }
  }

  return members;
}

function dependencyNames(pkg) {
  return Object.keys({
    ...(asObject(pkg.dependencies) || {}),
    ...(asObject(pkg.devDependencies) || {}),
  });
}

function scanProject() {
  const { pkg, unreadable } = detectProjectPackageJson();
  const rootFiles = fs.readdirSync(cwd, { withFileTypes: true });
  const topDirectories = rootFiles
    .filter((entry) => entry.isDirectory() && ![".git", "node_modules"].includes(entry.name))
    .map((entry) => entry.name)
    .sort();

  const codeDirectories = topDirectories.filter((name) => !NON_CODE_DIRECTORIES.has(name));

  const configFiles = rootFiles
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /(^\.env|config|tsconfig|vite|next|nuxt|svelte|tailwind|eslint|prettier|docker|render|vercel|package\.json|pnpm-lock|yarn\.lock|package-lock)/i.test(name))
    .sort();

  const testDirectories = findDirectories(cwd, (_fullPath, name) => /^(test|tests|__tests__|e2e|specs?)$/i.test(name), 3)
    .map((dir) => toPortable(path.relative(cwd, dir)));

  // The root package.json of a monorepo is usually empty of dependencies — the
  // signal lives in the members. `/flow-plan` asks "what is this built with", and
  // the answer must not depend on which manifest happens to hold the dependency.
  const workspaceConfig = detectWorkspace(pkg);
  const members = workspaceConfig.marker ? readWorkspaceMembers(workspaceConfig.patterns) : [];
  const memberScriptCount = members.reduce(
    (total, member) => total + Object.keys(asObject(member.pkg.scripts) || {}).length,
    0,
  );

  const deps = [
    ...new Set([
      ...(pkg ? dependencyNames(pkg) : []),
      ...members.flatMap((member) => dependencyNames(member.pkg)),
    ]),
  ].sort();
  // Root scripts only: these are the commands a user can actually run from here.
  const scripts = Object.fromEntries(
    Object.entries(pkg ? asObject(pkg.scripts) || {} : {})
      .filter(([name]) => !OWN_SCRIPT.test(name))
      .filter(([, value]) => typeof value === "string"),
  );
  const detectedFrameworks = FRAMEWORK_DETECTORS
    .filter(([, pattern]) => deps.some((dep) => pattern.test(dep)))
    .map(([name]) => name);

  const scan = {
    generatedAt: new Date().toISOString(),
    root: cwd,
    packageName: pkg && typeof pkg.name === "string" ? pkg.name : null,
    hasProjectPackageJson: pkg !== null,
    packageJsonUnreadable: unreadable,
    workspace: {
      marker: workspaceConfig.marker,
      patterns: workspaceConfig.patterns,
      memberCount: members.length,
      memberScriptCount,
    },
    detectedFrameworks,
    scripts,
    topDirectories,
    codeDirectories,
    configFiles,
    testDirectories,
    // Source directories are the tell for a stack we cannot detect: a repo with
    // src/, app/, or cmd/ and no JavaScript signal is not empty, it is foreign.
    looksLikeCode: codeDirectories.length > 0,
    recommendedNextPrompt: RECOMMENDED_NEXT_PROMPT,
  };

  scan.classification = classifyScan(scan);

  return scan;
}

function formatScanMarkdown(scan) {
  const scriptEntries = Object.entries(scan.scripts);

  return [
    "# Bootstrap Scan",
    "",
    `Generated: ${scan.generatedAt}`,
    "",
    "A mechanical inventory of this repository — directories, scripts, and declared",
    "dependencies. It is not an analysis of the code.",
    "",
    "## Package",
    "",
    `- Name: ${scan.packageName || "unknown"}`,
    `- Detected frameworks: ${scan.detectedFrameworks.length ? scan.detectedFrameworks.join(", ") : "unknown"}`,
    `- Signal: ${scan.classification}`,
    ...(scan.packageJsonUnreadable
      ? ["- package.json: present but not parseable as JSON, so it was skipped"]
      : []),
    ...(scan.workspace.marker
      ? [`- Workspace: ${scan.workspace.marker}, ${scan.workspace.memberCount} member package(s)`]
      : []),
    "",
    "## Scripts",
    "",
    ...scriptEntries.map(([name, value]) => `- ${name}: \`${value}\``),
    ...(scriptEntries.length === 0 ? ["- none detected"] : []),
    "",
    "## Top Directories",
    "",
    ...scan.topDirectories.map((name) => `- ${name}/`),
    "",
    "## Config Files",
    "",
    ...scan.configFiles.map((name) => `- ${name}`),
    ...(scan.configFiles.length === 0 ? ["- none detected"] : []),
    "",
    "## Test Directories",
    "",
    ...scan.testDirectories.map((name) => `- ${name}/`),
    ...(scan.testDirectories.length === 0 ? ["- none detected"] : []),
    "",
    "## Recommended Next Prompt",
    "",
    "```txt",
    scan.recommendedNextPrompt,
    "```",
    "",
  ].join("\n");
}

// Naming a stack ("likely Python, Go, Rust") is a claim, and it is only honest
// when nothing JavaScript is present at all. A workspace marker or a framework
// found in a member manifest is enough to make that claim false — which is what
// it was on any pnpm monorepo without a root manifest.
function hasAnyJavaScriptSignal(scan) {
  return (
    scan.hasProjectPackageJson ||
    Boolean(scan.workspace && scan.workspace.marker) ||
    scan.detectedFrameworks.length > 0
  );
}

// What `init` says about the repo it just scaffolded. The deliverable here is the
// *pointer*, not the scan: folding the scan into setup is only a win if the user
// still learns that the expensive half of brownfield onboarding has not run yet.
function printProjectScanSummary(scan, { dryRun = false } = {}) {
  if (!scan.looksLikeCode && scan.classification === "empty" && !scan.packageJsonUnreadable) {
    // A genuinely fresh repo. Nothing to report, no noise.
    return;
  }

  log("");

  // A broken package.json is a scan that failed, not a project without JS. Say
  // which one it is, or the user reads "no JavaScript signal" and goes looking
  // for the wrong problem.
  if (scan.packageJsonUnreadable) {
    log("package.json exists but could not be parsed as JSON — the scan skipped it.");
    log("Fix the file and re-run, or expect the project docs to be written by hand.");
  } else if (!hasAnyJavaScriptSignal(scan) && scan.looksLikeCode) {
    // No JavaScript signal anywhere in a repo that holds source directories is the
    // crisp tell for a stack these detectors cannot read. A `tests/` directory
    // alone does not clear it: directory names are stack-agnostic, dependency
    // detection is not.
    log("Existing code detected, but the scan found no JavaScript signal.");
    log(`Directories: ${scan.codeDirectories.join(", ")}`);
    log("The detectors only cover the JS ecosystem, so this stack is likely");
    log("Python, Go, Rust, or similar. Expect to write the project docs by hand.");
  } else {
    const parts = [];

    if (scan.detectedFrameworks.length > 0) {
      parts.push(scan.detectedFrameworks.join(", "));
    }

    const scriptCount = Object.keys(scan.scripts).length;

    if (scriptCount > 0) {
      parts.push(`${scriptCount} script${scriptCount === 1 ? "" : "s"}`);
    }

    if (scan.workspace.memberCount > 0) {
      parts.push(`${scan.workspace.memberCount} workspace package${scan.workspace.memberCount === 1 ? "" : "s"}`);
    }

    if (scan.testDirectories.length > 0) {
      parts.push(`${scan.testDirectories.length} test director${scan.testDirectories.length === 1 ? "y" : "ies"}`);
    }

    if (parts.length === 0) {
      if (scan.workspace.marker) {
        // A declared workspace whose members we could not read: say what we know
        // rather than fall back to guessing the stack.
        log(`Workspace declared in ${scan.workspace.marker}, but no member manifest could be read.`);
        log("The scan cannot describe this project — read it before planning.");
      } else {
        log("Existing files detected, but no framework, script, or test signal.");
        log("The scan cannot describe this project — read it before planning.");
      }
    } else {
      log(`Existing codebase detected: ${parts.join(" — ")}.`);

      if (scan.workspace.marker) {
        log(`Workspace monorepo (${scan.workspace.marker}) — the frameworks above include member packages.`);
      }

      if (scan.classification !== "rich") {
        log("The signal is partial, so treat the scan as a starting point.");
      }
    }
  }

  log("");
  log(
    dryRun
      ? "Project docs would still be empty. Next: /flow-plan bootstrap"
      : "Project docs are still empty. Next: /flow-plan bootstrap",
  );
}

function bootstrapScan({ json = false, dryRun = false, force = false } = {}) {
  const scan = scanProject();

  // --json is the machine path (skills, CI): it returns the data and writes
  // nothing. The document is for humans who explicitly asked for one.
  if (json) {
    log(JSON.stringify(scan, null, 2));
    return;
  }

  const output = formatScanMarkdown(scan);
  const outputPath = path.join(cwd, "docs", "bootstrap-scan.md");
  const exists = fs.existsSync(outputPath);
  // Same contract as every other file this tool writes: never clobber by default.
  const skipped = exists && !force;

  if (!dryRun && !skipped) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, output);
  }

  if (dryRun) {
    log(output);
    return;
  }

  if (skipped) {
    log("docs/bootstrap-scan.md already exists — kept. Use --force to overwrite.");
  } else {
    log("Bootstrap scan written to docs/bootstrap-scan.md");
  }

  log("");
  log(`Signal: ${scan.classification}`);

  if (scan.workspace.marker) {
    log(
      `Workspace: ${scan.workspace.marker} — ${scan.workspace.memberCount} member manifest(s) read.`,
    );
  }

  if (scan.packageJsonUnreadable) {
    log("package.json exists but could not be parsed as JSON — the scan skipped it.");
  } else if (!hasAnyJavaScriptSignal(scan) && scan.looksLikeCode) {
    log("No JavaScript signal found in a repository that holds code — the");
    log("detectors only cover the JS ecosystem. Expect to fill the docs by hand.");
  }

  log("");
  log(scan.recommendedNextPrompt);
}

module.exports = {
  scanProject,
  classifyScan,
  formatScanMarkdown,
  printProjectScanSummary,
  bootstrapScan,
};
