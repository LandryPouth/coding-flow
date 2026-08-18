# Multi-agent install: Claude / Codex detection, no shared mirror

> Next feature. Turn coding-flow into a **dual-target** tool: at install time we
> **detect** whether the agent is Claude Code or Codex, and write **only** that
> agent's files (`.claude/…` **or** `.codex/…`). The package maintains **two file
> sets** (Claude + Codex); the install pulls only the relevant set. We **remove**
> the shared `.agents/` mirror: a source of confusion, replaced by a clear
> per-agent target.

## Thesis

A neutral `.agents/skills/` mirror blends conventions and forces every agent to
"guess" what concerns it. We invert that: **two explicit sources** in the
package, **a single installed target** in the project. The user picks their tool,
the install lays down exactly that tool's files, nothing else. Fluid, unambiguous,
no catch-all directory.

## Host capabilities, verified 2026-08-18

This plan was written assuming a Codex `PreToolUse` with a `matcher` of
`apply_patch|Bash`, by analogy with Claude Code. **That assumption was false when
it was written and is true now** — which is the whole reason the port is worth
doing today and was not worth doing in April. Check these again before starting;
all three hosts are moving.

| | Wiring | Fires on a file write? | How a refusal is expressed |
|---|---|---|---|
| **Claude Code** | `.claude/settings.json` → `PreToolUse`, shell command | yes — `Write` `Edit` `MultiEdit` `NotebookEdit`, plus `Bash` | exit 2, and/or `permissionDecision: "deny"` on stdout |
| **Codex CLI** (≥ 0.123.0) | `~/.codex/hooks.json` → `PreToolUse`, **plus a feature flag** | yes — `apply_patch` since 0.123.0 (2026-04-23), plus the shell tool | `permissionDecision: "deny"` + `permissionDecisionReason` on stdout |
| **OpenCode** | a TypeScript plugin exporting `tool.execute.before` | yes — `write` / `edit` | `throw` inside the hook |

### What changed, and the receipts

- Until April 2026, Codex `PreToolUse` fired **only for the shell tool**.
  `apply_patch` — the way Codex actually edits files — emitted nothing, so a guard
  installed there would have caught `> .env` and let every ordinary edit through.
  Fixed by PR #18391, shipped in **Codex 0.123.0 (2026-04-23)**; `ApplyPatchHandler`
  now emits `PreToolUse`/`PostToolUse` with the correct `tool_name`
  ([openai/codex#16732](https://github.com/openai/codex/issues/16732), closed).
- OpenCode plugin hooks did not intercept tool calls made by **subagents**, so any
  policy built on them was bypassable
  ([anomalyco/opencode#5894](https://github.com/anomalyco/opencode/issues/5894),
  closed 2026-04-15).
- Still open on Codex: coverage is per-handler and incomplete — `read_file`, `grep`
  and MCP calls emit nothing
  ([openai/codex#20204](https://github.com/openai/codex/issues/20204)). Irrelevant
  to a **write** guard, so it does not block this plan, but it does mean "hook
  parity" is not a thing to claim.

### The one that must not be missed

**Codex hooks are silent no-ops unless `[features].codex_hooks = true` is set in
`~/.codex/config.toml`.** No error, no log. An `ai-flow init --target codex` would
succeed, print "guard wired", and protect nothing.

That is the exact failure mode `docs/agent-contract.md` refuses under *the core
stays boring*: a protection that is absent rather than loud. So `doctor` must read
`~/.codex/config.toml`, and an install whose flag is missing must report the guard
as **not active** — not as installed-with-a-warning. Treat this as a required part
of the Codex lot, not a refinement.

### What this means for the work

The CLI does not change: all three hosts end up invoking `ai-flow guard` with JSON
on stdin. What differs is narrow and known.

1. **Payload normalisation.** `WRITE_TOOLS` in `bin/lib/guard.js` is a hardcoded set
   of four Claude tool names, and `targetPath` reads `file_path` / `notebook_path`.
   Codex sends `apply_patch` with the patch body as `tool_input.command`; OpenCode
   sends `write` / `edit`. One normaliser in front of `decide`, and `decide` itself
   stays untouched — it is the part under test.
2. **Three wiring emitters**, one per host, each idempotent and `--dry-run`-able.
3. **Refusal expression per host**: exit 2 / JSON deny / thrown error.
4. **Per-host `doctor`**, including the Codex feature flag above.
5. **Tests on all three payload shapes**, against `decide` and end-to-end.

Nothing here is taken from `addyosmani/agent-skills`: their multi-agent story is the
same markdown in different envelopes, and they ship no enforcement layer, so there
is no equivalent to the only hard part of this.

### Sequencing

Codex first and alone. It is closest to Claude Code (same `PreToolUse` shape, same
JSON), so it forces the normaliser and the target detection while keeping one
variable at a time. OpenCode second: a TypeScript plugin is a genuinely different
shape and a far harder test of whether the contract holds.

**Not started as of 0.8.0**, deliberately. There is no evidence yet that anyone
using this tool wants Codex or OpenCode — and there is now a channel that would say
so (`ai-flow report`, `docs/DOGFOODING.md`). Wait for it.

---

## Inherited constraints (non-negotiable)

- **Zero runtime dependency.** `node:*` only. `git`/`gh` = optional shell-out.
- **Idempotence + `--dry-run` everywhere.** Non-destructive settings merge.
- **Nothing blocking by surprise.** The hard hook is active only when it is wired
  into the target agent's config; by default we signal.
- **Behavioral tests** in `node:test` on disposable git repos (`mktemp -d`): we
  check the observable (files laid down, exit codes, content), never the narrative.
- File deletion via `trash`, never `rm`.

## Design decisions

### 1. Two source file sets (end of the mirror)

Reorganize `templates/` to carry **both** agents **explicitly**:

```
templates/
  shared/                      # genuinely identical content (SKILL.md, docs, examples)
    skills/<skill>/SKILL.md
    docs/…
    epics/… examples/…
  claude/                      # Claude Code-specific
    settings.json (hook fragment)     # PreToolUse wiring
  codex/                       # Codex-specific
    hooks.json (hook fragment)        # PreToolUse wiring; see the capability table above
```

- **Skill content** lives once in `templates/shared/skills` (source of truth), but
  is **materialized into the chosen agent's target** (`.claude/skills/` or
  `.codex/skills/`) — never into a shared `.agents/`.
- **Wiring** (hooks, settings, plugin manifest) is **duplicated and specific** per
  agent: that is where the real differences are.
- Decision to settle: if a `/skill` invocation convention differs between Claude
  and Codex, plan a transformation pass at materialization time (otherwise
  `shared` is enough as-is). → see "Open questions".

### 2. Agent detection

Resolution order (first to answer wins):

1. **Explicit flag**: `ai-flow init --target claude|codex`.
2. **Env variable** injected by the host agent (e.g. `CLAUDE_CODE=1`, or a Codex
   `CODEX_*` marker) — to be confirmed on the Codex side.
3. **Existing config presence**: `.claude/` in the project **or** `~/.claude/`
   → claude; `~/.codex/` (or `.codex/`) → codex.
4. **Interactive fallback**: prompt "Claude Code or Codex?" (and if non-TTY / CI:
   a clear error asking for `--target`).

No `both` by default: **a single agent laid down** per install. `--target both`
may exist but stays an explicit opt-in (lays down both `.claude/` **and** `.codex/`).

### 3. Targeted installation

`init` copies only the resolved agent's set:

| Agent | Files laid down | Hook wiring | Plugin manifest |
|-------|-----------------|-------------|-----------------|
| claude | `.claude/skills/`, docs, rules | `.claude/settings.json` (PreToolUse) | `.claude-plugin/` |
| codex  | `.codex/skills/`, docs, rules | Codex hooks config (`~/.codex/hooks.json` or project) | `.codex-plugin/` |

**Agnostic** files (`PROJECT_RULES.md`, `AGENT_RULES.md`, `docs/*`, `epics/`,
`.coding-flow/`) are laid down in **both** cases, at the root — they do not depend
on the agent.

### 4. Removing the `.agents/` mirror

- Remove `.agents/skills/` generation from `templates.js` (`kind:"mirror"` spec,
  ~L63 and ~L460).
- Remove the `.agents` desync check from `doctor.js`.
- `templates/.agents/README.md` → deleted (via `trash`).
- **Migration**: if a project already has `.agents/skills/`, `doctor`/`fix` offers
  to remove it and lay down the detected agent target instead (non-destructive: we
  warn, we don't break anything).

## Per-file impact

- `bin/ai-flow.js` — `init`: resolve the target, wire the targeted install; add
  `--target`.
- `bin/lib/templates.js` — new `shared/ + claude/ + codex/` structure;
  materialization into `.claude/skills` **or** `.codex/skills` depending on target;
  removal of the `.agents` specs.
- `bin/lib/detect.js` **(new)** — agent detection logic + `resolveTarget()`.
- `bin/lib/settings.js` — stays for Claude (`.claude/settings.json`).
- `bin/lib/codex-settings.js` **(new)** — non-destructive merge of the hook into
  the Codex config; matcher `Bash|apply_patch|mcp__.*` (⚠ see guard note).
- `bin/lib/guard.js` — extend `WRITE_TOOLS` with `apply_patch` + handle the Codex
  `tool_input` shape; **detail handled in a separate guard plan** (Bash parsing /
  apply_patch bug #16732). Here we only do the wiring.
- `bin/lib/plugin.js` — generate `.claude-plugin/` **and/or** `.codex-plugin/`
  depending on target; `pluginSync`/`pluginCheck` become parameterized per agent.
- `bin/lib/doctor.js` — remove the `.agents` check; verify the consistency of the
  installed agent target.
- `README.md` — document `--target` and the per-agent install (install section).

## Implementation order (TODO)

- [ ] **1. Detection** — `bin/lib/detect.js`: `resolveTarget({flags, env, cwd})`
      → `"claude" | "codex"`, with order flag > env > existing config > prompt.
      Tests: each resolution source + non-TTY CI case (explicit error).
- [ ] **2. Restructure the templates** — `templates/{shared,claude,codex}/`;
      migrate the skill content into `shared/`. No behavior change yet (just the
      move + `plugin sync` following the new source).
- [ ] **3. Targeted install** — `templates.js` lays down `.claude/skills` **or**
      `.codex/skills` depending on target; agnostic files always laid down.
      Tests: `init --target claude` does not create `.codex/` and vice versa.
- [ ] **4. Per-agent hook wiring** — `settings.js` (claude) + `codex-settings.js`
      (codex); `init` wires the target's one. Tests: hook present in the right
      config, absent from the other, idempotent merge.
- [ ] **5. Per-agent plugin packaging** — `plugin.js` generates `.claude-plugin/`
      or `.codex-plugin/`; `plugin check` per agent (drift). Sync tests.
- [ ] **6. Remove `.agents/`** — remove mirror specs + doctor check + README;
      `trash templates/.agents`. `doctor`/`fix` migration for existing projects.
- [ ] **7. Multi-agent doctor** — detect the installed target, verify its
      consistency, no longer demand the mirror.
- [ ] **8. README** — updated install section (`--target`, detection, per-agent
      table).

## Dependencies with other plans

- The **content** of the guard on Codex (`apply_patch`/Bash, bug #16732,
  pre-commit fallback) is **out of scope** for this plan → to be handled in
  `docs/plans/guard-codex.md`. Here we only guarantee that **the right hook is
  wired into the right config** depending on the agent.

## Open questions (to settle before impl)

1. **Codex detection env**: what reliable marker does Codex expose (variable,
   file)? To be confirmed — otherwise we rely on `--target` + existing config.
2. **`/skill` invocation**: does Codex resolve `/flow-run-story` like Claude? If not,
   the `shared → .codex/skills` materialization must transform the references.
3. **Codex hook config**: is a **project** level possible, or only user level
   (`~/.codex/hooks.json`)? Impacts idempotence and wiring scope.
4. **`--target both`**: do we expose it now or keep it in reserve?
