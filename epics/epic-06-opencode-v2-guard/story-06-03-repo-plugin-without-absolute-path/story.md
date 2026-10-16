# Story 06-03 — This repository's OpenCode plugin without an absolute path

The tracked `.opencode/plugins/coding-flow-guard.js` contains
`const BINARY = "/home/landry_pouth/dev/tools/coding-flow/bin/ai-flow.js";`.
On any other clone it falls back to the published package pinned in
`FALLBACK`, so a contributor using OpenCode runs the **published** guard, not
the checkout they are editing — the opposite of AGENTS.md's promise that "a
guard change is live as soon as it is saved".

*(QUICK — generation for the self-install case and one regenerated file.)*

## Acceptance Criteria

- [x] Given `ai-flow init`/`upgrade` run inside the coding-flow checkout
      itself (package root === project root), when the plugin is generated,
      then `BINARY` is computed at load time relative to the plugin file
      (`fileURLToPath(new URL("../../bin/ai-flow.js", import.meta.url))`), not
      written as a literal path.
- [x] Given any other project, generation is unchanged (absolute resolved
      binary + pinned fallback).
- [x] The tracked plugin in this repository is regenerated and contains no
      home-directory path (`grep -n "/home/" .opencode/plugins/*.js` is empty).
- [x] Same check for `.claude/settings.json` in this repo: no absolute
      home path in the tracked file (fix the same way if present).

## Notes

`bin/lib/opencode.js` `pluginSource()` (~130) and `settings.js`
`guardBinaryPath()`. Detect self-install by comparing
`path.resolve(__dirname, "../..")` with the project root.

## Result

- `isSelfInstall(root)` in `settings.js` (package root === project root).
  `pluginSource({ self })` writes `fileURLToPath(new URL("../../bin/ai-flow.js",
  import.meta.url))`; `guardCommandString(root)` uses `$CLAUDE_PROJECT_DIR`.
- Tracked plugin and `.claude/settings.json` regenerated with `ai-flow upgrade`;
  no `/home/` left. Tests: `test/self-install-paths.test.js`.

## Known limits

- A git worktree of this repository has a root different from the package
  directory, so `isSelfInstall` is false there and the absolute-path form is
  written (the pre-story behaviour).
- If `$CLAUDE_PROJECT_DIR` is unset, the Claude hook falls back to the published
  npx guard rather than failing.

## Status: done
