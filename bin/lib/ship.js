"use strict";

// `ai-flow ship` : depuis la branche courante (typiquement dans un worktree),
// pousse la branche et ouvre/mets a jour UNE pull request vers la base. Une
// feature = une branche = une PR. Idempotent : si la PR existe deja, le push
// suffit a la mettre a jour, on ne recree rien.
//
// Choix de conception :
//   - explicite (commande), jamais un pre-push hook : ouvrir une PR est un effet
//     de bord sortant qui n'a rien a faire dans un hook (doublons, echecs CI...).
//   - la logique est branchee sur la BRANCHE, pas sur le layout local (worktree
//     ou non) : le push ne transmet jamais le layout, seulement des commits.
//   - zero dependance : shell-out vers `git` (requis) et `gh` (optionnel). Sans
//     `gh`, on pousse et on affiche l'URL de comparaison a ouvrir a la main.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// Marqueurs idempotents : la section évidence est remplacée entre eux, jamais
// le texte humain autour. Ship peut ainsi rafraîchir la preuve sans écraser la
// description de la PR.
const EVIDENCE_START = "<!-- coding-flow:evidence:start -->";
const EVIDENCE_END = "<!-- coding-flow:evidence:end -->";

function log(message) {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

function git(cwd, gitArgs, { allowFail = false } = {}) {
  try {
    const stdout = execFileSync("git", gitArgs, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
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

function gh(ghArgs, cwd, { allowFail = true } = {}) {
  try {
    const stdout = execFileSync("gh", ghArgs, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout: stdout || "" };
  } catch (err) {
    const stderr = (err.stderr || err.stdout || err.message || "").toString();
    if (allowFail) {
      return { code: err.status ?? 1, stdout: (err.stdout || "").toString(), stderr };
    }
    fail(`gh ${ghArgs.join(" ")} a echoue : ${stderr.trim()}`);
    return { code: 1, stdout: "", stderr };
  }
}

function requireRepo(cwd) {
  if (git(cwd, ["--version"], { allowFail: true }).code !== 0) {
    fail("git est introuvable dans le PATH.");
  }
  const root = git(cwd, ["rev-parse", "--show-toplevel"], { allowFail: true });
  if (root.code !== 0) {
    fail("ce dossier n'est pas un depot git.");
  }
  return root.stdout.trim();
}

function currentBranch(root) {
  const res = git(root, ["rev-parse", "--abbrev-ref", "HEAD"], { allowFail: true });
  const branch = res.stdout.trim();
  if (res.code !== 0 || branch === "HEAD") {
    fail("HEAD est detache : place-toi sur une branche avant de ship.");
  }
  return branch;
}

// Base par defaut : la branche par defaut du remote (origin/HEAD), sinon main,
// sinon master.
function defaultBase(root) {
  const sym = git(root, ["symbolic-ref", "refs/remotes/origin/HEAD"], { allowFail: true });
  if (sym.code === 0 && sym.stdout.trim()) {
    return sym.stdout.trim().replace("refs/remotes/origin/", "");
  }
  for (const candidate of ["main", "master"]) {
    if (git(root, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`], { allowFail: true }).code === 0) {
      return candidate;
    }
  }
  return "main";
}

function localRefExists(root, ref) {
  return git(root, ["rev-parse", "--verify", "--quiet", ref], { allowFail: true }).code === 0;
}

function isGitHubRemote(url) {
  return /github\.com/i.test(url);
}

// Normalise une URL de remote git en URL web GitHub (sans .git).
function remoteToHttps(url) {
  let clean = url.trim().replace(/\.git$/, "");
  const sshMatch = clean.match(/^git@github\.com:(.+)$/i);
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}`;
  }
  clean = clean.replace(/^ssh:\/\/git@github\.com\//i, "https://github.com/");
  return clean;
}

function ghAvailable() {
  return (() => {
    try {
      execFileSync("gh", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
      return true;
    } catch {
      return false;
    }
  })();
}

// Dernière évidence `harness verify` du dépôt, best-effort. Absente/illisible → null.
function latestVerifyEvidence(root) {
  const runsDir = path.join(root, ".coding-flow", "runs");

  if (!fs.existsSync(runsDir)) {
    return null;
  }

  const files = fs
    .readdirSync(runsDir)
    .filter((name) => name.endsWith("-verify.json"))
    .sort();

  if (files.length === 0) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(path.join(runsDir, files[files.length - 1]), "utf8"));
  } catch {
    return null;
  }
}

// Construit la section markdown d'évidence (entre marqueurs) à partir du JSON verify.
function buildEvidenceBlock(evidence) {
  const lines = [EVIDENCE_START, "### 🔬 Coding Flow — verify evidence", ""];

  const source = evidence.commandSource || "n/a";
  const count = evidence.commandsFound != null ? evidence.commandsFound : (evidence.results || []).length;
  lines.push(`**Result:** ${evidence.ok ? "✅ passed" : "❌ FAILED"} — ${count} command(s), source: \`${source}\``);

  const git = evidence.provenance && evidence.provenance.git;
  if (git) {
    const author = git.author && git.author.name ? git.author.name : "unknown";
    const dirty = git.dirty ? " (dirty tree)" : "";
    lines.push(`**Commit:** \`${git.shortCommit || git.commit}\`${dirty} · **Author:** ${author}`);
  }
  if (evidence.story) {
    lines.push(`**Story:** \`${evidence.story}\``);
  }
  lines.push(`**When:** ${evidence.generatedAt || "n/a"}`);
  lines.push("");

  const results = Array.isArray(evidence.results) ? evidence.results : [];
  if (results.length > 0) {
    lines.push("| Command | Result | Duration |", "| --- | --- | --- |");
    for (const item of results) {
      const status = item.ok ? "✅ exit 0" : item.timedOut ? "⏱ timeout" : `❌ exit ${item.exitCode}`;
      lines.push(`| \`${item.command}\` | ${status} | ${item.durationMs}ms |`);
    }
    lines.push("");
  }

  lines.push("_Generated by `ai-flow ship` from `.coding-flow/runs`._", EVIDENCE_END);
  return lines.join("\n");
}

// Insère ou remplace la section évidence dans un corps de PR, sans toucher au reste.
function upsertEvidenceBlock(body, block) {
  const current = body || "";
  const startIndex = current.indexOf(EVIDENCE_START);
  const endIndex = current.indexOf(EVIDENCE_END);

  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    const before = current.slice(0, startIndex);
    const after = current.slice(endIndex + EVIDENCE_END.length);
    return `${before}${block}${after}`;
  }

  return current.trim() ? `${current.trim()}\n\n${block}\n` : `${block}\n`;
}

// Rafraîchit la section évidence dans le corps de la PR (gh requis).
function syncEvidenceIntoPr(root, branch, block) {
  const view = gh(["pr", "view", branch, "--json", "body"], root);
  let body = "";

  if (view.code === 0) {
    try {
      body = JSON.parse(view.stdout).body || "";
    } catch {
      body = "";
    }
  }

  const next = upsertEvidenceBlock(body, block);
  const edit = gh(["pr", "edit", branch, "--body", next], root);
  return edit.code === 0;
}

function ship({ base = null, draft = false, title = null, web = false, dryRun = false, includeEvidence = true, cwd }) {
  const root = requireRepo(cwd);
  const branch = currentBranch(root);
  const targetBase = base || defaultBase(root);

  if (branch === targetBase) {
    fail(`tu es sur la base "${targetBase}". Place-toi sur une branche de feature avant de ship.`);
  }

  const originUrl = git(root, ["remote", "get-url", "origin"], { allowFail: true });
  if (originUrl.code !== 0) {
    fail("aucun remote 'origin'. Ajoute-le avec : git remote add origin <url>.");
  }
  const remoteUrl = originUrl.stdout.trim();

  // Commits a shipper : au-dessus de la base (locale si presente, sinon origin).
  const baseRef = localRefExists(root, targetBase)
    ? targetBase
    : localRefExists(root, `origin/${targetBase}`)
      ? `origin/${targetBase}`
      : targetBase;
  const ahead = git(root, ["rev-list", "--count", `${baseRef}..HEAD`], { allowFail: true });
  if (ahead.code === 0 && ahead.stdout.trim() === "0") {
    fail(`aucun commit a shipper : "${branch}" n'a rien au-dessus de "${targetBase}".`);
  }

  const dirty = git(root, ["status", "--porcelain"], { allowFail: true }).stdout.trim().length > 0;
  const github = isGitHubRemote(remoteUrl);
  const canPr = github && ghAvailable();
  const evidence = includeEvidence ? latestVerifyEvidence(root) : null;

  if (dryRun) {
    log("Dry run — rien n'est pousse.");
    log(`  branche : ${branch}`);
    log(`  base    : ${targetBase}`);
    log(`  push    : git push -u origin ${branch}`);
    if (dirty) log("  note    : working tree sale (les changements non commites ne seront pas pousses).");
    if (canPr) {
      log(`  PR      : ${draft ? "brouillon " : ""}${targetBase} <- ${branch} (creee si absente, sinon mise a jour)`);
    } else if (github) {
      log("  PR      : gh absente — l'URL de comparaison sera affichee.");
    } else {
      log("  PR      : remote non-GitHub — PR non geree, push uniquement.");
    }
    if (includeEvidence && canPr) {
      if (evidence) {
        log(`  evidence: dernier verify (${evidence.ok ? "passed" : "FAILED"}) sera attache au corps de la PR.`);
      } else {
        log("  evidence: aucune (lance `ai-flow harness verify` avant de ship pour attacher la preuve).");
      }
    }
    return;
  }

  if (dirty) {
    log("Note : working tree sale — seuls les commits sont pousses, pas les changements non commites.");
  }

  const push = git(root, ["push", "-u", "origin", branch], { allowFail: true });
  if (push.code !== 0) {
    fail(`echec du push : ${push.stderr.trim()}`);
  }
  log(`Pousse : origin/${branch}`);

  if (!github) {
    log("Remote non-GitHub : branche poussee, PR non geree.");
    return;
  }

  if (!canPr) {
    const compare = `${remoteToHttps(remoteUrl)}/compare/${targetBase}...${branch}?expand=1`;
    log("gh CLI absente : ouvre la PR ici :");
    log(`  ${compare}`);
    return;
  }

  // Attache/rafraîchit la preuve verify dans le corps de la PR (idempotent).
  function attachEvidence() {
    if (!includeEvidence) {
      return;
    }
    if (!evidence) {
      log("Note : aucune évidence verify — lance `ai-flow harness verify` avant de ship pour attacher la preuve.");
      return;
    }
    if (syncEvidenceIntoPr(root, branch, buildEvidenceBlock(evidence))) {
      log(`Évidence verify (${evidence.ok ? "passed" : "FAILED"}) attachée au corps de la PR.`);
    }
  }

  // gh present : PR existante ? (idempotent — le push l'a deja mise a jour)
  const existing = gh(["pr", "view", branch, "--json", "url,state"], root);
  if (existing.code === 0) {
    let url = "";
    try {
      url = JSON.parse(existing.stdout).url || "";
    } catch {
      url = "";
    }
    log(`PR deja ouverte (mise a jour par le push)${url ? ` : ${url}` : "."}`);
    attachEvidence();
    if (web && url) {
      gh(["pr", "view", branch, "--web"], root);
    }
    return;
  }

  // Creation de la PR.
  const createArgs = ["pr", "create", "--base", targetBase, "--head", branch];
  if (title) {
    createArgs.push("--title", title, "--body", "");
  } else {
    createArgs.push("--fill");
  }
  if (draft) {
    createArgs.push("--draft");
  }
  const created = gh(createArgs, root);
  if (created.code !== 0) {
    fail(`echec de la creation de PR : ${created.stderr.trim()}`);
  }
  const url = created.stdout.trim().split(/\s+/).find((token) => token.startsWith("http")) || created.stdout.trim();
  log(`PR ${draft ? "(brouillon) " : ""}creee : ${url}`);
  attachEvidence();
  if (web && url) {
    gh(["pr", "view", branch, "--web"], root);
  }
}

function shipCommand({ getFlagValue, flags, cwd }) {
  ship({
    base: getFlagValue("--base", null),
    title: getFlagValue("--title", null),
    draft: flags.has("--draft"),
    web: flags.has("--web"),
    dryRun: flags.has("--dry-run"),
    includeEvidence: !flags.has("--no-evidence"),
    cwd,
  });
}

module.exports = { shipCommand, buildEvidenceBlock, upsertEvidenceBlock, latestVerifyEvidence };
