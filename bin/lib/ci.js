"use strict";

// `ai-flow ci init` : scaffolde un workflow GitHub Actions dans le projet CIBLE
// qui rejoue `harness verify` sur un checkout NEUF, hors de la main de l'agent.
// C'est le gate non-jouable : le pass/fail de la machine, pas l'affirmation de
// l'agent. Porté par le compute GitHub (gratuit), il préserve le budget Claude.
//
// Opt-in par conception : le workflow est écrit à la demande (pas dans templates/,
// pour ne pas l'installer d'office à chaque `init`). Non destructif : n'écrase pas
// un workflow existant sans --force.

const fs = require("fs");
const path = require("path");

const { cwd, packageJson } = require("./context");
const { log, normalizePortable } = require("./util");

function workflowPath(root) {
  return path.join(root, ".github", "workflows", "coding-flow-verify.yml");
}

function workflowContent() {
  const pkg = packageJson.name;

  return `# Généré par \`ai-flow ci init\`. Rejoue la vérification sur un environnement
# neuf : le gate non-jouable (pass/fail de la machine, pas de l'agent).
name: coding-flow verify

on:
  pull_request:
  push:
    branches: [main, master]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          # fetch-depth 0 : diff-coverage éventuel a besoin de l'historique.
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 20.x

      # verify exécute les commandes de validation DÉCLARÉES par le projet
      # (config.validation.commands, puis tests.md, puis scripts package.json).
      # On installe donc les dépendances du projet cible si elles existent.
      - name: Install project dependencies
        run: |
          if [ -f package-lock.json ]; then
            npm ci
          elif [ -f package.json ]; then
            npm install
          else
            echo "No package.json — skipping dependency install."
          fi

      # Clean-room : exécute et CAPTURE l'évidence. Échoue si une commande casse
      # ou si aucune commande n'a tourné ("rien exécuté ≠ vérifié").
      - name: Verify (execute declared validation commands)
        run: npx --yes ${pkg} harness verify

      # Gate : la dernière évidence verify par story doit être verte.
      - name: Audit gate (no green evidence, no merge)
        run: npx --yes ${pkg} audit --check

      # L'évidence reste attachée au run CI (même en cas d'échec), pour l'audit.
      - name: Upload evidence
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: coding-flow-evidence
          path: .coding-flow/runs/
          if-no-files-found: ignore

      # --- Diff-coverage (optionnel) ---------------------------------------
      # Le plancher de couverture DU CODE CHANGÉ (pas la couverture globale,
      # gonflable) est le complément naturel de verify. coding-flow fournit le
      # crochet, pas un runner maison : branche ici ton outil (ex. diff-cover)
      # sur le rapport de couverture produit par tes tests.
      #
      # - name: Diff coverage floor
      #   run: |
      #     git fetch origin \${{ github.base_ref }}
      #     npx --yes diff-cover coverage.xml --compare-branch=origin/\${{ github.base_ref }} --fail-under=80
`;
}

function ciInit({ dryRun = false, force = false } = {}) {
  const target = workflowPath(cwd);
  const rel = normalizePortable(path.relative(cwd, target));
  const exists = fs.existsSync(target);

  if (exists && !force) {
    log(`CI workflow already present: ${rel} (use --force to overwrite).`);
    return { status: "skipped", path: target };
  }

  if (!dryRun) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, workflowContent());
  }

  const verb = dryRun ? "Would write" : exists ? "Overwrote" : "Wrote";
  log(`${verb} clean-room CI workflow: ${rel}`);
  log("It runs `harness verify` + `audit --check` on a fresh checkout for every PR.");
  return { status: exists ? "overwritten" : "created", path: target };
}

function ciCommand({ commandArgs, flags }) {
  const subcommand = commandArgs[0] || "init";

  if (subcommand === "init") {
    ciInit({ dryRun: flags.has("--dry-run"), force: flags.has("--force") });
  } else {
    const { fail } = require("./util");
    fail(`unknown ci command "${subcommand}". Use init.`);
  }
}

module.exports = { ciCommand, workflowContent, workflowPath };
