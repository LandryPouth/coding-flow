# Epic 01 - Example Admin Content

## Goal

Show how a small vertical epic should be structured.

## Business Value

The product team can move one hardcoded content section toward admin-managed content without rebuilding the entire CMS.

## Scope

Included:

- [ ] Audit one hardcoded content section.
- [ ] Render the first section from a typed content source.

Excluded:

- [ ] Full CMS.
- [ ] Rich text editing.
- [ ] Role management.
- [ ] Publishing workflow.

## Stories

Backbone: audit the hardcoded section → render it from a real content source

- [ ] story-01-01-audit-hardcoded-content
- [ ] story-01-02-render-dynamic-content

## Context Strategy

- Default execution mode: `STANDARD`
- Stories that need a scout pre-step (the Context Map pass in `/flow-run`): none for this example
- Shared search anchors: `hardcoded`, `Hero`, `content`, `homepage`
- Areas to avoid unless needed: auth, billing, unrelated admin pages

## Architecture Impact

Introduces a small content boundary before any database-backed admin UI. Business rules stay outside UI components.

## Testing Strategy

- Unit: content mapper/normalizer if logic exists.
- Integration: render flow if the framework supports it.
- E2E: not required for this small example unless the app already has homepage E2E coverage.

## Risks

- Risk: changing visible copy unintentionally.
- Risk: overbuilding CMS abstractions before one content type proves value.

## Decisions

- Start with one content section before generalizing.
- Keep content data typed and close to the feature until persistence is introduced.
