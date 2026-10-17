# Story 06-01 — Plan

## Implementation Context

- **Execution mode**: STRICT.
- **Scout pre-step**: no.
- **Likely files**:
  - `bin/lib/opencode.js` — `PLUGIN_BODY` (lines ~33–124): `toPayloads`
    (~66), the exported `CodingFlowGuard` (~110). Append `setup` and the
    default export at the end of the template string.
  - `test/opencode.test.js` (or the existing OpenCode plugin test — grep
    `coding-flow-guard` under `test/`) — it already writes the generated
    plugin to a temp dir and imports it; add a V2 fake-ctx case next to the
    V1 one.
  - `CHANGELOG.md` `[Unreleased]`.
- **Search anchors**: `toPayloads`, `CodingFlowGuard`, `MARKER`,
  `pluginSource`.
- **Areas to avoid**: `bin/lib/guard.js` — `decide` stays the single place the
  decision is made; this story only translates inputs.

## Technical Notes

Prototype validated on 1.19.0 and 2.0.30 (2026-10-16), appended to the current
body with the four mapping changes above:

```js
async function setup(ctx) {
  if (!ctx || !ctx.tool || typeof ctx.tool.hook !== "function") return;
  const directory = (ctx.location && ctx.location.directory) || process.cwd();
  const hooks = await CodingFlowGuard({ directory });
  await ctx.tool.hook("execute.before", (event) =>
    hooks["tool.execute.before"]({ tool: event.tool }, { args: event.input }));
}
export default { id: "coding-flow.guard", server: CodingFlowGuard, setup };
```

with `const CodingFlowGuard = …` (no `export`). V2 event fields observed:
`tool`, `sessionID`, `agent`, `messageID`, `id`, `input`. V2 tool inputs:
write `{path, content}`, edit `{path, oldString, newString}`, shell
`{command}`, patch `{patchText}`.

Real-host check, reproducible without touching the user's install:

```bash
# V2 binary: npm pack @opencode/cli-linux-x64@<2.x> and extract (the
# @opencode/cli postinstall download is unreliable on slow networks)
export HOME=$(mktemp -d) XDG_CONFIG_HOME=$HOME/.config OPENCODE_DISABLE_MODELS_FETCH=1
# V2 runs a background service: use --standalone, or `opencode service set port <free>`
```

## Decisions

- The ID `coding-flow.guard` follows V2's dotted-ID convention; V2's
  `"plugins": ["-coding-flow.*"]` can then disable it explicitly — that is the
  user's call, and it is visible, unlike a load failure.
