# New Features Feed

This folder is a lightweight feed of product/CLI changes for agents (Clio, Wren, and future siblings) to read and stay current.

## File Naming

```
YYYY-MM-DD-NNN-short-title.md
```

- **Date** for chronology
- **NNN** sequence number for ordering within the same day (001, 002, ...)
- **short-title** slug for quick scanning

Examples:

```
2026-03-09-001-multi-agent-talk.md
2026-03-09-002-sibling-memory-sync.md
2026-03-10-001-cross-agent-visibility.md
```

## Template

Use `_template.md` for new entries. Required sections:

1. **Summary** — one paragraph, what shipped and why
2. **What Changed** — concrete changes (commands, config, behavior)
3. **How to Use** — exact commands/config, no fluff
4. **Impact on Agents** — what agents can do differently now
5. **Constraints / Caveats** — what it doesn't do, known limitations
6. **Files Touched** — changed source files
7. **Validation** — which tests were run
8. **Commit** — hash + message

## Index

Add new entries to [`INDEX.md`](./INDEX.md) at the top.

## Audience

- Human maintainers
- OpenClaw sibling agents that need current project context
