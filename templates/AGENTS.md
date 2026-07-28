# Agent Instructions

This project uses Coding Flow.

Before implementation work, read:

- `PROJECT_RULES.md`
- `AGENT_RULES.md`

Project skills live in:

- `.claude/skills/`

Use the lightest workflow that protects the change:

- `/quick-story` for tiny isolated changes.
- `/run-story FAST` for simple story work.
- `/run-story STANDARD` for normal features.
- `/run-story STRICT` or `/run-story-secure` for auth, permissions, payments, migrations, or sensitive data.
- `/agent-context-scout` only when edit points are unclear or broad codebase exploration would otherwise be needed.

Keep implementation one-shot once scope and edit points are clear:

```txt
understand scope -> locate edit points -> implement -> test -> validate -> document
```

Do not broadly inspect the repository when targeted files, search anchors, or a Context Map are available.
