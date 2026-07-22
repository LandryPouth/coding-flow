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
    hooks.json (hook fragment)        # PreToolUse/PostToolUse wiring, matcher apply_patch|Bash
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
2. **`/skill` invocation**: does Codex resolve `/run-story` like Claude? If not,
   the `shared → .codex/skills` materialization must transform the references.
3. **Codex hook config**: is a **project** level possible, or only user level
   (`~/.codex/hooks.json`)? Impacts idempotence and wiring scope.
4. **`--target both`**: do we expose it now or keep it in reserve?
