# Engineering Tickets

Feature tickets for Codex to implement in `/Users/samuelminer/Documents/openclaw`.

## Format

Each ticket is a markdown file: `NNNN-short-title.md`

### Section 1 — Feature Ticket (filled by requesting agent)

- **Goal**
- **Acceptance criteria** (clear pass/fail behavior)
- **Constraints** (don't touch X, keep backward compatibility, etc.)
- **How to test manually** (preferred flow if any)

### Section 2 — Implementation (filled by Codex)

- Code changes
- Targeted tests first
- Broader checks after

### Section 3 — Validation (filled by Codex)

- `pnpm test:fast` (fast unit pass)
- `pnpm lint`
- `pnpm build`
- If needed: `pnpm test` or `pnpm test:e2e`

### Section 4 — Runtime Smoke Test (filled by Codex)

- Terminal A: `cd /Users/samuelminer/Documents/openclaw && node openclaw.mjs --profile dev gateway run`
- Terminal B: `node openclaw.mjs --profile dev talk clio` or `node openclaw.mjs --profile dev talk wren`
- One-shot: `node openclaw.mjs --profile dev agent --agent main --local --message "ping" --json`

### Section 5 — Handback (filled by Codex)

- What changed
- Which files changed
- What passed/failed
- Any follow-up fixes needed

## Status

Prefix filenames or use a status line at the top of each ticket:

- `OPEN` — ready for implementation
- `IN PROGRESS` — Codex is working on it
- `DONE` — implemented and validated
- `BLOCKED` — needs input
