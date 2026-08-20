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
  ["SvelteKit", /^@sveltejs\/kit$/],
  ["Angular", /^@angular\/core$/],
  ["Astro", /^astro$/],
  ["Remix", /^@remix-run\/(react|node|serve)$/],
  ["Nuxt", /^nuxt$/],
  ["Express", /^express$/],
  ["Fastify", /^fastify$/],
  ["NestJS", /^@nestjs\/core$/],
  ["Koa", /^koa$/],
  ["Hono", /^hono$/],
  ["Prisma", /^prisma$|^@prisma\/client$/],
  ["Drizzle", /^drizzle-orm$/],
  ["TypeORM", /^typeorm$/],
  ["Mongoose", /^mongoose$/],
  ["GraphQL", /^graphql$/],
  ["Apollo Server", /^@apollo\/server$|^apollo-server/],
  ["tRPC", /^@trpc\/(server|client)$/],
  ["Tailwind", /^tailwindcss$/],
  ["Vitest", /^vitest$/],
  ["Jest", /^jest$/],
  ["Mocha", /^mocha$/],
  ["Playwright", /^@playwright\/test$|^playwright$/],
  ["Cypress", /^cypress$/],
  ["Storybook", /^storybook$|^@storybook\/core$/],
];

// The same idea as FRAMEWORK_DETECTORS, one list per non-JS ecosystem. Matched
// against dependency names extracted from that ecosystem's own manifest format
// (see extractForeignDependencies below) — never against JS package names, so
// this never fires on a JS repo.
const FOREIGN_FRAMEWORK_DETECTORS = {
  go: [
    ["Gin", /gin-gonic\/gin/],
    ["Echo", /labstack\/echo/],
    ["Fiber", /gofiber\/fiber/],
    ["Chi", /go-chi\/chi/],
    ["gRPC", /google\.golang\.org\/grpc/],
  ],
  rust: [
    ["Actix Web", /^actix-web$/],
    ["Axum", /^axum$/],
    ["Rocket", /^rocket$/],
    ["Tokio", /^tokio$/],
    ["Serde", /^serde$/],
    ["Diesel", /^diesel$/],
    ["SQLx", /^sqlx$/],
  ],
  python: [
    ["Django", /^django$/i],
    ["Flask", /^flask$/i],
    ["FastAPI", /^fastapi$/i],
    ["Pytest", /^pytest$/i],
    ["SQLAlchemy", /^sqlalchemy$/i],
    ["Celery", /^celery$/i],
    ["Pydantic", /^pydantic$/i],
  ],
  java: [
    ["Spring Boot", /spring-boot/],
    ["Spring", /^spring-(?!boot)/],
    ["JUnit", /^junit/],
    ["Hibernate", /hibernate/],
    ["Quarkus", /^quarkus-/],
  ],
};

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
// `looksLikeCode` is the fallback for a stack no detector below covers at all.
function classifyScan(scan) {
  const hasFrameworks = scan.detectedFrameworks.length > 0;
  // Member scripts count: in a monorepo the root manifest is often a shell, and
  // classifying it `empty` would send /flow-plan in blind on a live codebase.
  const hasScripts =
    Object.keys(scan.scripts).length > 0 || (scan.workspace && scan.workspace.memberScriptCount > 0);
  const hasForeignSignal = Boolean(scan.foreignStack);

  // Only manifest evidence counts. A `tests/` directory is a stack-agnostic
  // directory name — it fires on Python and Go too, so letting it lift the verdict
  // would report a stack we did not recognize as one we partly did.
  if (!hasFrameworks && !hasScripts && !hasForeignSignal) {
    return "empty";
  }

  // A recognized Go/Rust/Python/Java manifest is real signal on its own — but
  // this scanner has no notion of that ecosystem's scripts/build commands, so
  // `rich` (script signal + frameworks together) never applies to it. `thin`
  // says exactly that: something real was found, not the whole picture.
  if (hasForeignSignal) {
    return "thin";
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

// Resolves `packages/*`, `apps/*`, or a literal directory to a list of member
// directories (not yet read). Anything more exotic (`**`, negations, nested
// workspaces) is skipped rather than half-supported: the workspace marker
// alone is already enough to stop the scan from claiming a foreign stack.
// Shared by every ecosystem below — Cargo's `members = ["crates/*"]` and npm's
// `workspaces: ["packages/*"]` are the same glob shape, just different files.
function resolveWorkspaceMemberDirs(patterns) {
  const dirs = [];
  const seen = new Set();

  for (const pattern of patterns) {
    if (dirs.length >= MAX_WORKSPACE_MEMBERS) {
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
      if (dirs.length >= MAX_WORKSPACE_MEMBERS || seen.has(candidate)) {
        continue;
      }

      seen.add(candidate);
      dirs.push(candidate);
    }
  }

  return dirs;
}

// JS members: read as JSON, kept as a parsed object (dependencyNames below
// reads `.dependencies`/`.devDependencies` off it directly).
function readWorkspaceMembers(patterns) {
  const members = [];

  for (const candidate of resolveWorkspaceMemberDirs(patterns)) {
    const memberPkg = asObject(readJson(path.join(cwd, candidate, "package.json"), null));

    if (memberPkg) {
      members.push({ dir: toPortable(candidate), pkg: memberPkg });
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

// --- non-JS ecosystems -------------------------------------------------------
//
// Same posture as the JS detectors above: zero dependencies (regex over the
// manifest's own text, no TOML/XML/YAML parser), one level of glob, no
// recursion, MAX_WORKSPACE_MEMBERS cap, and never asserted unless a real
// manifest was read. A marker here only ever *adds* signal — detectWorkspace()
// and a real package.json always run first and win, so a JS repo's behavior is
// untouched by any of this.

// TOML array reader for the two conventional layouts:
//   members = ["a", "b"]
// or
//   members = [
//     "a",
//     "b",
//   ]
// `\b` keeps `workspace_members` from matching a lookup for `members`.
function readTomlArray(text, key) {
  const match = new RegExp(`\\b${key}\\s*=\\s*\\[([^\\]]*)\\]`, "s").exec(text);

  if (!match) {
    return null;
  }

  return match[1]
    .split(",")
    .map((entry) => entry.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

// go.work: `use ./a` lines, or a `use ( ./a\n ./b )` block. Paths are literal
// directories, never globs — Go workspaces do not have a glob syntax.
function detectGoWorkspace() {
  const filePath = path.join(cwd, "go.work");

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const text = readTextSafely(filePath);
  const patterns = [];
  const block = /use\s*\(([^)]*)\)/s.exec(text);

  if (block) {
    for (const line of block[1].split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) patterns.push(trimmed);
    }
  }

  for (const line of text.split(/\r?\n/)) {
    const single = /^\s*use\s+(\S+)\s*$/.exec(line);
    if (single) patterns.push(single[1]);
  }

  return { marker: "go.work", ecosystem: "go", patterns, memberManifest: "go.mod" };
}

// Cargo.toml: `[workspace]` with `members = [...]`, globs allowed (`crates/*`).
function detectRustWorkspace() {
  const filePath = path.join(cwd, "Cargo.toml");

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const text = readTextSafely(filePath);

  if (!/\[workspace\]/.test(text)) {
    return null;
  }

  const patterns = readTomlArray(text, "members") || [];
  return { marker: "Cargo.toml", ecosystem: "rust", patterns, memberManifest: "Cargo.toml" };
}

// pyproject.toml: uv and rye both declare `[tool.<x>.workspace]` with a
// `members` array. Poetry has no equivalent single-repo workspace convention
// widely enough adopted to be worth a branch here.
function detectPythonWorkspace() {
  const filePath = path.join(cwd, "pyproject.toml");

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const text = readTextSafely(filePath);

  if (!/\[tool\.(uv|rye)\.workspace\]/.test(text)) {
    return null;
  }

  const patterns = readTomlArray(text, "members") || [];
  return { marker: "pyproject.toml", ecosystem: "python", patterns, memberManifest: "pyproject.toml" };
}

// Maven `<modules>` and Gradle `include(...)` both declare literal module
// names, not globs — the folder-per-module convention is assumed, which is the
// default for both tools but not guaranteed; a mismatch just reads as zero
// members (readForeignWorkspaceMembers skips a directory it cannot find).
function detectJavaWorkspace() {
  const pomPath = path.join(cwd, "pom.xml");

  if (fs.existsSync(pomPath)) {
    const modulesBlock = /<modules>([\s\S]*?)<\/modules>/.exec(readTextSafely(pomPath));
    const patterns = modulesBlock
      ? [...modulesBlock[1].matchAll(/<module>\s*([^<\s]+)\s*<\/module>/g)].map((m) => m[1])
      : [];

    if (patterns.length > 0) {
      return { marker: "pom.xml", ecosystem: "java", patterns, memberManifest: "pom.xml" };
    }
  }

  for (const name of ["settings.gradle.kts", "settings.gradle"]) {
    const gradlePath = path.join(cwd, name);

    if (fs.existsSync(gradlePath)) {
      const patterns = [...readTextSafely(gradlePath).matchAll(/include\s*\(?\s*["']:?([^"']+)["']/g)].map((m) =>
        m[1].replace(/:/g, "/"),
      );

      if (patterns.length > 0) {
        return { marker: name, ecosystem: "java", patterns, memberManifest: "pom.xml" };
      }
    }
  }

  return null;
}

// First match wins — a repo mixing ecosystems (e.g. a Rust backend embedded in
// a Go workspace) is out of scope, same call the JS/foreign split above makes.
function detectForeignWorkspace() {
  return detectGoWorkspace() || detectRustWorkspace() || detectPythonWorkspace() || detectJavaWorkspace() || null;
}

// The root manifest for a single (non-workspace) foreign project — or the
// shell manifest a workspace root often carries alongside its member list.
function detectForeignProject() {
  const goModPath = path.join(cwd, "go.mod");
  if (fs.existsSync(goModPath)) {
    return { ecosystem: "go", manifest: "go.mod", text: readTextSafely(goModPath) };
  }

  const cargoPath = path.join(cwd, "Cargo.toml");
  if (fs.existsSync(cargoPath)) {
    return { ecosystem: "rust", manifest: "Cargo.toml", text: readTextSafely(cargoPath) };
  }

  const pyprojectPath = path.join(cwd, "pyproject.toml");
  if (fs.existsSync(pyprojectPath)) {
    return { ecosystem: "python", manifest: "pyproject.toml", text: readTextSafely(pyprojectPath) };
  }

  const requirementsPath = path.join(cwd, "requirements.txt");
  if (fs.existsSync(requirementsPath)) {
    return { ecosystem: "python", manifest: "requirements.txt", text: readTextSafely(requirementsPath) };
  }

  const pomPath = path.join(cwd, "pom.xml");
  if (fs.existsSync(pomPath)) {
    return { ecosystem: "java", manifest: "pom.xml", text: readTextSafely(pomPath) };
  }

  for (const name of ["build.gradle.kts", "build.gradle"]) {
    const gradlePath = path.join(cwd, name);
    if (fs.existsSync(gradlePath)) {
      return { ecosystem: "java", manifest: name, text: readTextSafely(gradlePath) };
    }
  }

  return null;
}

// Foreign members are read as raw text, not JSON — each ecosystem's manifest
// format is parsed by its own extractor (extractForeignDependencies below).
function readForeignWorkspaceMembers(patterns, memberManifestName) {
  const members = [];

  for (const candidate of resolveWorkspaceMemberDirs(patterns)) {
    const manifestPath = path.join(cwd, candidate, memberManifestName);

    if (fs.existsSync(manifestPath)) {
      members.push({ dir: toPortable(candidate), text: readTextSafely(manifestPath) });
    }
  }

  return members;
}

function extractGoDependencies(text) {
  const names = [];
  const block = /require\s*\(([\s\S]*?)\)/.exec(text);

  if (block) {
    for (const line of block[1].split(/\r?\n/)) {
      const name = line.trim().split(/\s+/)[0];
      if (name) names.push(name);
    }
  }

  for (const m of text.matchAll(/^require\s+(\S+)\s+\S+/gm)) {
    names.push(m[1]);
  }

  return names;
}

function extractRustDependencies(text) {
  const section = /\[dependencies\]([\s\S]*?)(\n\[|$)/.exec(text);
  if (!section) return [];
  return [...section[1].matchAll(/^([A-Za-z0-9_-]+)\s*=/gm)].map((m) => m[1]);
}

function extractPythonDependencies(text) {
  const names = new Set();

  for (const entry of readTomlArray(text, "dependencies") || []) {
    const match = /^[A-Za-z0-9_.-]+/.exec(entry);
    if (match) names.add(match[0]);
  }

  const poetrySection = /\[tool\.poetry\.dependencies\]([\s\S]*?)(\n\[|$)/.exec(text);
  if (poetrySection) {
    for (const m of poetrySection[1].matchAll(/^([A-Za-z0-9_.-]+)\s*=/gm)) {
      if (m[1] !== "python") names.add(m[1]);
    }
  }

  return [...names];
}

function extractRequirementsTxtDependencies(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.split("#")[0].trim())
    .map((line) => /^[A-Za-z0-9_.-]+/.exec(line))
    .filter(Boolean)
    .map((m) => m[0]);
}

function extractJavaDependencies(text) {
  const names = new Set();
  for (const m of text.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)) names.add(m[1]);
  for (const m of text.matchAll(/(?:implementation|api|testImplementation)\s*\(?["']([^"':]+):([^"':]+)/g)) {
    names.add(m[2]);
  }
  return [...names];
}

function extractForeignDependencies(ecosystem, manifestName, text) {
  if (ecosystem === "go") return extractGoDependencies(text);
  if (ecosystem === "rust") return extractRustDependencies(text);
  if (ecosystem === "python") {
    return manifestName === "requirements.txt" ? extractRequirementsTxtDependencies(text) : extractPythonDependencies(text);
  }
  if (ecosystem === "java") return extractJavaDependencies(text);
  return [];
}

// Runs only when there is no real JS package.json (`pkg === null`): a project
// with genuine JS signal always wins, so a polyglot repo (e.g. a Rust backend
// next to a JS frontend) reports as JS, not as both — the same one-ecosystem
// call every function above already makes.
function scanForeignEcosystem() {
  const foreignWorkspace = detectForeignWorkspace();
  const rootProject = detectForeignProject();
  const ecosystem = foreignWorkspace ? foreignWorkspace.ecosystem : rootProject ? rootProject.ecosystem : null;

  if (!ecosystem) {
    return { foreignStack: null, workspace: null, memberCount: 0, frameworks: [] };
  }

  const rootDeps =
    rootProject && rootProject.ecosystem === ecosystem
      ? extractForeignDependencies(ecosystem, rootProject.manifest, rootProject.text)
      : [];

  let members = [];
  if (foreignWorkspace) {
    members = readForeignWorkspaceMembers(foreignWorkspace.patterns, foreignWorkspace.memberManifest);
  }
  const memberDeps = members.flatMap((m) => extractForeignDependencies(ecosystem, foreignWorkspace.memberManifest, m.text));

  const allDeps = [...new Set([...rootDeps, ...memberDeps])];
  const frameworks = (FOREIGN_FRAMEWORK_DETECTORS[ecosystem] || [])
    .filter(([, pattern]) => allDeps.some((dep) => pattern.test(dep)))
    .map(([name]) => name);

  return {
    foreignStack: { ecosystem, manifest: rootProject && rootProject.ecosystem === ecosystem ? rootProject.manifest : null },
    workspace: foreignWorkspace,
    memberCount: members.length,
    frameworks,
  };
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

  // Foreign (non-JS) ecosystems only get a look when there is no real JS
  // package.json — see scanForeignEcosystem's own comment for why.
  const foreign = pkg ? { foreignStack: null, workspace: null, memberCount: 0, frameworks: [] } : scanForeignEcosystem();

  const detectedFrameworks = [
    ...FRAMEWORK_DETECTORS.filter(([, pattern]) => deps.some((dep) => pattern.test(dep))).map(([name]) => name),
    ...foreign.frameworks,
  ];

  const scan = {
    generatedAt: new Date().toISOString(),
    root: cwd,
    packageName: pkg && typeof pkg.name === "string" ? pkg.name : null,
    hasProjectPackageJson: pkg !== null,
    packageJsonUnreadable: unreadable,
    workspace: {
      marker: workspaceConfig.marker || (foreign.workspace ? foreign.workspace.marker : null),
      patterns: workspaceConfig.marker ? workspaceConfig.patterns : foreign.workspace ? foreign.workspace.patterns : [],
      memberCount: workspaceConfig.marker ? members.length : foreign.memberCount,
      memberScriptCount,
      ecosystem: foreign.workspace ? foreign.workspace.ecosystem : null,
    },
    foreignStack: foreign.foreignStack,
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
    ...(scan.foreignStack
      ? [`- Ecosystem: ${scan.foreignStack.ecosystem}${scan.foreignStack.manifest ? ` (${scan.foreignStack.manifest})` : ""} — JS detectors do not apply`]
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

const ECOSYSTEM_LABELS = { go: "Go", rust: "Rust", python: "Python", java: "Java" };

// Naming a stack ("likely Python, Go, Rust") without evidence is a claim, and
// it is only honest when nothing was actually read at all. A workspace marker,
// a framework found in a member manifest, or a recognized foreign manifest
// (go.mod, Cargo.toml, pyproject.toml, pom.xml/build.gradle) is enough to make
// that claim false — which is what it was on any pnpm monorepo without a root
// manifest, and would now also be true of a real Go or Rust project.
function hasAnyRecognizedSignal(scan) {
  return (
    scan.hasProjectPackageJson ||
    Boolean(scan.workspace && scan.workspace.marker) ||
    scan.detectedFrameworks.length > 0 ||
    Boolean(scan.foreignStack)
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
  } else if (scan.foreignStack) {
    const { ecosystem, manifest } = scan.foreignStack;
    const label = ECOSYSTEM_LABELS[ecosystem] || ecosystem;
    const parts = [];

    if (scan.detectedFrameworks.length > 0) parts.push(scan.detectedFrameworks.join(", "));
    if (scan.workspace.memberCount > 0) {
      parts.push(`${scan.workspace.memberCount} workspace package${scan.workspace.memberCount === 1 ? "" : "s"}`);
    }

    log(`Existing ${label} codebase detected${manifest ? ` (${manifest})` : ""}${parts.length ? `: ${parts.join(" — ")}` : ""}.`);

    if (scan.workspace.marker && scan.workspace.ecosystem === ecosystem) {
      log(`Workspace monorepo (${scan.workspace.marker}).`);
    }

    log("The JS detectors do not apply here — treat this as a starting point, not a full picture.");
  } else if (!hasAnyRecognizedSignal(scan) && scan.looksLikeCode) {
    // No signal anywhere in a repo that holds source directories is the crisp
    // tell for a stack these detectors cannot read at all. A `tests/` directory
    // alone does not clear it: directory names are stack-agnostic, dependency
    // detection is not.
    log("Existing code detected, but the scan found no recognized signal.");
    log(`Directories: ${scan.codeDirectories.join(", ")}`);
    log("The detectors cover JavaScript, Go, Rust, Python, and Java, so this stack is likely");
    log("something else. Expect to write the project docs by hand.");
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

  if (scan.foreignStack) {
    const label = ECOSYSTEM_LABELS[scan.foreignStack.ecosystem] || scan.foreignStack.ecosystem;
    log(`Ecosystem: ${label}${scan.foreignStack.manifest ? ` (${scan.foreignStack.manifest})` : ""} — the JS detectors do not apply.`);
  }

  if (scan.packageJsonUnreadable) {
    log("package.json exists but could not be parsed as JSON — the scan skipped it.");
  } else if (!hasAnyRecognizedSignal(scan) && scan.looksLikeCode) {
    log("No recognized signal found in a repository that holds code — the detectors");
    log("cover JavaScript, Go, Rust, Python, and Java. Expect to fill the docs by hand.");
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
