# Submitting to the official Claude Code plugin directory

> Status: **ready to submit**, not submitted. The form asks for an identity, so it
> is the maintainer's to send.

The highest-intent discovery channel for this tool is the `/plugin > Discover` tab
in Claude Code: everyone browsing it already has the problem *and* the host. As of
2026-08-19 the directory carries **286 plugins**, 118 of them under `development`.

## The channel is a form, not a pull request

`anthropics/claude-plugins-official` accepts external plugins through the
[plugin directory submission form](https://clau.de/plugin-directory-submission),
not through PRs — the repo carries ~900 open issues and its README routes third
parties to the form. Do not open a PR against their `marketplace.json`; Anthropic
writes the entry.

Their stated bar: *"External plugins must meet quality and security standards for
approval."* For this plugin the security question is not incidental — see below.

## Submission payload

| Field | Value |
| --- | --- |
| Plugin name (immutable slug) | `coding-flow` |
| Category | `development` |
| Repository | https://github.com/LandryPouth/coding-flow |
| Homepage | https://github.com/LandryPouth/coding-flow#readme |
| License | MIT |
| Author | Landry Pouth |
| Version at submission | 0.8.3 (`3429745f28d059f73c814337e21b142f1b68f613`) |

The entry Anthropic would write resolves to a plain git source, because the plugin
manifest sits at the repository root:

```json
{
  "name": "coding-flow",
  "description": "Executed proof that the tests actually ran and passed, not the agent's word: a deterministic guard hook that refuses secrets and protected files before they reach disk, a coverage gate that rejects a risky change carrying no test, and an audit trail for teams that need one.",
  "author": { "name": "Landry Pouth" },
  "category": "development",
  "source": {
    "source": "git",
    "url": "https://github.com/LandryPouth/coding-flow.git",
    "ref": "main",
    "sha": "3429745f28d059f73c814337e21b142f1b68f613"
  },
  "homepage": "https://github.com/LandryPouth/coding-flow#readme"
}
```

The slug is **immutable** once published — users install under it, and renaming
breaks their install. `coding-flow` matches the npm package, the repo, and
`.claude-plugin/plugin.json`, so there is no reason it would ever need to change.

## The security answer, prepared

This plugin registers a `PreToolUse` hook that runs a bundled binary before every
`Write`, `Edit`, `MultiEdit`, `NotebookEdit` and `Bash`. That is the most
invasive thing a plugin can do, and it is what a reviewer will look at. The honest
answers:

- **It runs the copy it ships with**, via `${CLAUDE_PLUGIN_ROOT}/bin/ai-flow.js` —
  no `npx`, no registry fetch at hook time, no version skew between the plugin a
  user audited and the code that executes.
- **Zero dependencies.** Nothing is installed, nothing is fetched. The whole guard
  is readable in one sitting.
- **It only ever denies.** The hook's outputs are `deny` or nothing; it cannot
  approve a write that Claude Code would otherwise have blocked, and it never
  modifies the tool input.
- **No network, no telemetry.** Nothing leaves the machine. `ai-flow report`
  writes a local file and redacts by default — paths made relative, home and
  username masked, and a matched secret's *value* is never recorded, only the name
  of the pattern that fired.
- **The policy is the project's, not ours.** Patterns live in the project's own
  `harness.json` in full, readable and editable.

## Pre-submission check (re-run before sending)

A reviewer's first act is a clean install. Verified 2026-08-19 from a fresh
`--depth 1` clone:

```bash
git clone --depth 1 https://github.com/LandryPouth/coding-flow.git
cd coding-flow
# manifests a loader needs
test -f .claude-plugin/plugin.json && test -f .claude-plugin/hooks/hooks.json
# the hook's binary exists in the bundle
node -e "const h=require('./.claude-plugin/hooks/hooks.json');console.log(h.hooks.PreToolUse[0].hooks[0].args)"
# the guard actually denies
echo '{"tool_name":"Write","tool_input":{"file_path":".env","content":"AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY"}}' \
  | node bin/ai-flow.js guard   # -> permissionDecision "deny", exit 2
```

All three passed. `test/plugin.test.js` pins the manifest shape in CI, so a
regression here fails the build rather than the review.

## Second channel

[claudemarketplaces.com](https://claudemarketplaces.com/) is a third-party directory
that ranks by installs and GitHub stars. Lower intent than the official Discover
tab and it feeds on signals we do not have yet (0 stars at time of writing), so it
is worth doing *after* the official submission, not instead of it.
