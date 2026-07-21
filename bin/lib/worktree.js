"use strict";

// Support optionnel des worktrees Git pour le travail parallèle.
//
// Trois sous-commandes, toutes non destructives par defaut :
//   ai-flow worktree add <nom> [--from <ref>] [--deps install|link|skip] [--dry-run]
//   ai-flow worktree list
//   ai-flow worktree remove <nom> [--force] [--dry-run]
//
// Contraintes du projet : zero dependance (uniquement les modules Node integres
// et le binaire `git`), Node >= 18. On sort (shell out) vers git plutot que de
// reimplementer sa plomberie ; git est de toute facon un prerequis.

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function log(message) {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

// Lance git dans `cwd`. Par defaut capture stdout/stderr et echoue proprement.
// allowFail: renvoie { code, stdout, stderr } sans quitter.
// inherit: laisse git ecrire directement sur le terminal (installs, progression).
function git(cwd, gitArgs, { allowFail = false, inherit = false } = {}) {
  try {
    const stdout = execFileSync("git", gitArgs, {
      cwd,
      encoding: "utf8",
      stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout: stdout || "" };
  } catch (err) {
    const stderr = (err.stderr || err.stdout || err.message || "").toString();
    if (allowFail) {
      return { code: err.status ?? 1, stdout: (err.stdout || "").toString(), stderr };
    }
    fail(`git ${gitArgs.join(" ")} a echoue : ${stderr.trim()}`);
    return { code: 1, stdout: "", stderr };
  }
}

// git present + on est bien dans un depot. Renvoie la racine du working tree.
function requireRepo(cwd) {
  if (git(cwd, ["--version"], { allowFail: true }).code !== 0) {
    fail("git est introuvable dans le PATH.");
  }
  const root = git(cwd, ["rev-parse", "--show-toplevel"], { allowFail: true });
  if (root.code !== 0) {
    fail("ce dossier n'est pas un depot git (git rev-parse a echoue).");
  }
  return root.stdout.trim();
}

function assertName(name) {
  if (!name) {
    fail('nom manquant. Exemple : ai-flow worktree add feat/payments');
  }
  if (name.startsWith("-") || name.includes("..") || !/^[A-Za-z0-9._/-]+$/.test(name)) {
    fail(`nom invalide : "${name}". Caracteres autorises : lettres, chiffres, . _ / -`);
  }
}

// Emplacement groupe : ../<repo>-worktrees/<nom>, pour garder le dossier parent
// propre au lieu d'eparpiller des siblings.
function worktreeDest(root, name) {
  const base = path.basename(root);
  return path.join(path.dirname(root), `${base}-worktrees`, name);
}

// Resout un chemin de story (epics/<epic>/story-...) passe via --story. La
// branche/worktree prend le nom du dossier de la story, ce qui rend la
// correspondance worktree<->story deterministe et sans etat (cf. status).
function resolveStory(root, cwd, story) {
  const full = path.resolve(cwd, story);
  const rel = path.relative(root, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    fail(`la story doit etre dans le depot : ${story}`);
  }
  if (!isDir(full)) {
    fail(`story introuvable (un dossier est attendu) : ${story}`);
  }
  return {
    fullPath: full,
    name: path.basename(full),
    rel: rel.split(path.sep).join("/"),
    hasStoryFile: fs.existsSync(path.join(full, "story.md")),
  };
}

const ENV_FILES = [".env", ".env.local"];
// Liens que cette commande cree elle-meme dans un worktree. On les exclut du
// controle "working tree sale" (ce ne sont pas du travail non commite) et on
// les retire avant `git worktree remove` pour ne pas bloquer la suppression
// quand ces chemins ne sont pas gitignores.
const MANAGED_LINKS = [...ENV_FILES, "node_modules"];

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// lstatSync qui ne jette pas (detecte aussi les liens casses).
function lstatSafe(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

// Cree un lien idempotent de srcAbs vers linkAbs (aucune copie).
// - existe deja : on ne touche a rien.
// - dossier sous Windows : jonction (plus fiable que le symlink prive).
// - sinon : symlink relatif, qui survit a un deplacement du parent.
function makeLink(srcAbs, linkAbs) {
  if (fs.existsSync(linkAbs) || lstatSafe(linkAbs)) {
    return "garde";
  }
  fs.mkdirSync(path.dirname(linkAbs), { recursive: true });
  const directory = isDir(srcAbs);
  if (process.platform === "win32" && directory) {
    fs.symlinkSync(srcAbs, linkAbs, "junction");
  } else {
    const target = path.relative(path.dirname(linkAbs), srcAbs);
    fs.symlinkSync(target, linkAbs, directory ? "dir" : "file");
  }
  return "lie";
}

function detectPackageManager(root) {
  const has = (f) => fs.existsSync(path.join(root, f));
  let pm = null;
  if (has("pnpm-lock.yaml")) pm = "pnpm";
  else if (has("yarn.lock")) pm = "yarn";
  else if (has("package-lock.json")) pm = "npm";
  else if (has("package.json")) pm = "npm";

  let workspace = has("pnpm-workspace.yaml");
  if (!workspace && has("package.json")) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
      workspace = Boolean(pkg.workspaces);
    } catch {
      // package.json illisible : on ignore, workspace reste false.
    }
  }
  return { pm, workspace };
}

// Choisit quoi faire de node_modules. Symlinker node_modules est sur pour un
// projet simple (npm) mais CASSE un monorepo pnpm/yarn (virtual store lie a la
// racine du workspace) : dans ce cas on installe plutot.
function resolveDepsStrategy(explicit, { pm, workspace }, hasNodeModules) {
  if (explicit) {
    if (!["install", "link", "skip"].includes(explicit)) {
      fail(`--deps invalide : "${explicit}". Valeurs : install, link, skip.`);
    }
    return explicit;
  }
  if (workspace || pm === "pnpm" || pm === "yarn") return "recommend-install";
  if (hasNodeModules) return "link";
  return "recommend-install";
}

function installCommand(pm) {
  if (pm === "pnpm") return "pnpm install";
  if (pm === "yarn") return "yarn install";
  return "npm install";
}

function worktreeAdd(name, { from, deps, dryRun, cwd, story }) {
  const root = requireRepo(cwd);
  let linkedStory = null;

  if (story) {
    linkedStory = resolveStory(root, cwd, story);
    if (name && name !== linkedStory.name) {
      fail(
        `conflit de nom : "${name}" vs story "${linkedStory.name}". ` +
          "Donne soit <nom>, soit --story, mais pas les deux avec des noms differents.",
      );
    }
    name = linkedStory.name;
  }

  assertName(name);
  const dest = worktreeDest(root, name);

  if (fs.existsSync(dest)) {
    fail(`la cible existe deja : ${dest}`);
  }

  const branchExists =
    git(root, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`], { allowFail: true }).code === 0;

  const addArgs = ["worktree", "add"];
  if (branchExists) {
    addArgs.push(dest, name);
  } else {
    addArgs.push(dest, "-b", name);
    if (from) addArgs.push(from);
  }

  const { pm, workspace } = detectPackageManager(root);
  const hasNodeModules = isDir(path.join(root, "node_modules"));
  const strategy = resolveDepsStrategy(deps, { pm, workspace }, hasNodeModules);
  const envToLink = ENV_FILES.filter((f) => fs.existsSync(path.join(root, f)));

  if (dryRun) {
    log("Dry run — rien n'est ecrit.");
    log(`  worktree : git ${addArgs.join(" ")}`);
    log(`  branche  : ${branchExists ? `${name} (existante)` : `${name} (nouvelle, depuis ${from || "HEAD"})`}`);
    if (linkedStory) log(`  story    : ${linkedStory.rel}${linkedStory.hasStoryFile ? "" : " (pas de story.md)"}`);
    for (const f of envToLink) log(`  lien     : ${f}`);
    log(`  deps     : ${describeStrategy(strategy, pm, hasNodeModules)}`);
    return;
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  git(root, addArgs);
  log(`Worktree cree : ${dest}`);
  log(`Branche : ${name}${branchExists ? " (existante)" : ""}`);
  if (linkedStory) {
    log(`Story liee : ${linkedStory.rel}${linkedStory.hasStoryFile ? "" : " (pas de story.md)"}`);
  }

  for (const f of envToLink) {
    const status = makeLink(path.join(root, f), path.join(dest, f));
    log(`  ${status} ${f}`);
  }

  applyDeps(strategy, { pm, root, dest, hasNodeModules });

  log("");
  log("Prochaine etape :");
  log(`  cd ${path.relative(cwd, dest) || dest}`);
  if (linkedStory) {
    log(`  ai-flow harness preflight --story ${linkedStory.rel}`);
  }
}

function describeStrategy(strategy, pm, hasNodeModules) {
  if (strategy === "link") return "symlink de node_modules";
  if (strategy === "install") return `${installCommand(pm)} dans le worktree`;
  if (strategy === "skip") return "ignore (--deps skip)";
  return `a installer (${installCommand(pm)}) — monorepo/pnpm, symlink deconseille`;
}

function applyDeps(strategy, { pm, root, dest, hasNodeModules }) {
  if (strategy === "skip") return;

  if (strategy === "link") {
    if (!hasNodeModules) {
      log(`  node_modules absent a la racine — rien a lier, lance : ${installCommand(pm)}`);
      return;
    }
    const status = makeLink(path.join(root, "node_modules"), path.join(dest, "node_modules"));
    log(`  ${status} node_modules`);
    return;
  }

  if (strategy === "install") {
    log(`  ${installCommand(pm)} ...`);
    const bin = pm || "npm";
    try {
      execFileSync(bin, ["install"], { cwd: dest, stdio: "inherit" });
    } catch {
      log(`  echec de "${installCommand(pm)}" — a relancer manuellement dans le worktree.`);
    }
    return;
  }

  // recommend-install
  log(`  deps : lance "${installCommand(pm)}" dans le worktree (symlink deconseille pour ce projet).`);
}

function parseWorktrees(root) {
  return parseWorktreesFrom(git(root, ["worktree", "list", "--porcelain"]).stdout);
}

// Parseur pur de la sortie `git worktree list --porcelain` (sans I/O).
function parseWorktreesFrom(out) {
  const blocks = out.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((block) => {
    const entry = { path: null, head: null, branch: null, detached: false, bare: false };
    for (const line of block.split(/\n/)) {
      if (line.startsWith("worktree ")) entry.path = line.slice("worktree ".length);
      else if (line.startsWith("HEAD ")) entry.head = line.slice("HEAD ".length, "HEAD ".length + 7);
      else if (line.startsWith("branch ")) entry.branch = line.slice("branch ".length).replace("refs/heads/", "");
      else if (line === "detached") entry.detached = true;
      else if (line === "bare") entry.bare = true;
    }
    return entry;
  });
}

function worktreeList({ cwd }) {
  const root = requireRepo(cwd);
  const entries = parseWorktrees(root);
  if (entries.length === 0) {
    log("Aucun worktree.");
    return;
  }
  for (const e of entries) {
    const label = e.bare ? "(bare)" : e.detached ? `(detache @${e.head})` : e.branch || "(?)";
    const links = ENV_FILES.filter((f) => lstatSafe(path.join(e.path, f))).join(", ");
    const suffix = links ? `  liens: ${links}` : "";
    log(`${label.padEnd(24)} ${e.path}${suffix}`);
  }
}

// Lignes `git status --porcelain` en excluant nos liens geres : ce qui reste
// est du vrai travail (fichiers suivis modifies, ou fichiers non geres).
function realDirtyLines(wtPath) {
  return git(wtPath, ["status", "--porcelain"], { allowFail: true })
    .stdout.split("\n")
    .filter(Boolean)
    .filter((line) => {
      const p = line.slice(3).replace(/\/$/, "").replace(/^"|"$/g, "");
      return !MANAGED_LINKS.includes(p);
    });
}

// Retire uniquement les symlinks que l'on a poses (jamais un vrai fichier).
function removeManagedLinks(wtPath) {
  for (const name of MANAGED_LINKS) {
    const p = path.join(wtPath, name);
    const st = lstatSafe(p);
    if (st && st.isSymbolicLink()) {
      fs.unlinkSync(p);
    }
  }
}

function worktreeRemove(name, { force, dryRun, cwd }) {
  assertName(name);
  const root = requireRepo(cwd);
  const dest = worktreeDest(root, name);

  const entries = parseWorktrees(root);
  const match =
    entries.find((e) => e.path === dest) ||
    entries.find((e) => path.basename(e.path) === name) ||
    entries.find((e) => e.branch === name);

  if (!match) {
    fail(`worktree introuvable pour "${name}". Voir : ai-flow worktree list`);
  }

  // git worktree remove CONSERVE la branche : aucun commit n'est perdu. Le seul
  // risque reel est le travail non commite (working tree sale) — hors nos liens.
  const dirty = realDirtyLines(match.path);
  if (dirty.length && !force) {
    fail(
      `le worktree "${name}" a des modifications non commitees. ` +
        "Commit/stash d'abord, ou force avec --force (perte des changements non commites).",
    );
  }

  if (dryRun) {
    log("Dry run — rien n'est supprime.");
    log(`  liens geres retires : ${MANAGED_LINKS.join(", ")}`);
    log(`  git worktree remove ${force ? "--force " : ""}${match.path}`);
    log("  git worktree prune");
    log(`  branche ${match.branch || name} : conservee`);
    return;
  }

  // On retire nos symlinks avant, sinon git worktree remove peut refuser a cause
  // de fichiers non suivis quand ces chemins ne sont pas gitignores.
  removeManagedLinks(match.path);

  const removeArgs = ["worktree", "remove"];
  if (force) removeArgs.push("--force");
  removeArgs.push(match.path);
  git(root, removeArgs);
  git(root, ["worktree", "prune"]);

  log(`Worktree retire : ${match.path}`);
  if (match.branch) {
    log(`Branche conservee : ${match.branch} (git branch -D ${match.branch} pour la supprimer).`);
  }
}

// Liste non-fatale des worktrees, utilisable hors du contexte worktree (ex.
// `status`). Ne quitte jamais : renvoie { isRepo:false, entries:[] } si git est
// absent ou si on n'est pas dans un depot, au lieu de tuer le process.
function collectWorktrees(cwd) {
  if (git(cwd, ["--version"], { allowFail: true }).code !== 0) {
    return { isRepo: false, root: null, entries: [] };
  }
  const root = git(cwd, ["rev-parse", "--show-toplevel"], { allowFail: true });
  if (root.code !== 0) {
    return { isRepo: false, root: null, entries: [] };
  }
  const repoRoot = root.stdout.trim();
  const list = git(repoRoot, ["worktree", "list", "--porcelain"], { allowFail: true });
  if (list.code !== 0) {
    return { isRepo: true, root: repoRoot, entries: [] };
  }
  return { isRepo: true, root: repoRoot, entries: parseWorktreesFrom(list.stdout) };
}

// Extrait les arguments positionnels en ignorant les flags et la valeur des
// flags qui en prennent une (--from/--deps/--story). Sans ca, `add --story x`
// prendrait "--story" comme nom positionnel.
function positionalArgs(args) {
  const valueFlags = new Set(["--from", "--deps", "--story"]);
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token.startsWith("-")) {
      if (!token.includes("=") && valueFlags.has(token)) {
        i += 1;
      }
      continue;
    }
    out.push(token);
  }
  return out;
}

function worktreeCommand({ commandArgs, from, deps, dryRun, force, cwd, story }) {
  const sub = commandArgs[0];
  const name = positionalArgs(commandArgs.slice(1))[0];

  if (sub === "add") {
    worktreeAdd(name, { from, deps, dryRun, cwd, story });
  } else if (sub === "list" || sub === "ls") {
    worktreeList({ cwd });
  } else if (sub === "remove" || sub === "rm") {
    worktreeRemove(name, { force, dryRun, cwd });
  } else {
    fail(`sous-commande worktree inconnue : "${sub || ""}". Utilise add, list ou remove.`);
  }
}

module.exports = { worktreeCommand, collectWorktrees };
