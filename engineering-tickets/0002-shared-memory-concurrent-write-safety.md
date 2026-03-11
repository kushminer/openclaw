# 0002 — Shared Memory Concurrent Write Safety

**Status:** DONE
**Filed by:** Clio (main)
**Date:** 2026-03-10

---

## 1. Feature Ticket

### Goal

Prevent sibling agents from clobbering each other's writes to shared family memory files (`~/.openclaw/shared/`). When multiple agents write to the same shared memory file concurrently, changes should be safely merged or serialized rather than last-write-wins.

### Acceptance Criteria

- Shared family memory mutation tool calls (`write`, `edit`) that target `~/.openclaw/shared/MEMORY.md`, `~/.openclaw/shared/memory.md`, or files under `~/.openclaw/shared/memory/` are serialized with a file lock.
- Writes outside shared family memory are not lock-wrapped.
- Non-mutation tools are unchanged.
- Existing tool contracts and CLI behavior remain backward compatible.
- Unit tests cover path targeting and lock-wrapper behavior for shared vs non-shared writes.

### Constraints

- Don't change the shared memory directory structure (`~/.openclaw/shared/`).
- Don't require agents to use a special API for writes — standard file write tools should be intercepted/wrapped.
- Keep backward compatibility with existing memory search/read paths.
- Prefer simple file-system-level mechanisms (lockfiles, checksums) over external dependencies.
- Must work on macOS and Linux.

### How to Test Manually

1. Start gateway:
   `cd /Users/samuelminer/Documents/openclaw && node openclaw.mjs --profile dev gateway run`
2. In a second terminal, open a talk session:
   `node openclaw.mjs --profile dev talk dev --history-limit 1 --message "ping"`
3. Confirm gateway/talk round-trip succeeds.
4. Run one-shot local check:
   `node openclaw.mjs --profile dev agent --agent dev --local --message "ping" --json`
5. (Optional) Run two simultaneous edits against a shared memory file and verify writes execute sequentially without lock errors.

---

## 2. Implementation

- Added shared-memory write-lock wrapper:
  - `src/agents/shared-family-memory-write-lock.ts`
  - Resolves target paths and applies `withFileLock` only for shared family memory write/edit targets.
- Integrated wrapper into coding tools:
  - `src/agents/pi-tools.ts`
  - Wraps `write` and `edit` tools (sandboxed and non-sandboxed) with shared-memory lock logic.
- Added targeted tests:
  - `src/agents/shared-family-memory-write-lock.test.ts`
  - Covers shared path detection and lock application behavior.

## 3. Validation

- `pnpm test:fast`:
  - PASS
  - `Test Files 801 passed (801)`
  - `Tests 6633 passed (6633)`
- `pnpm lint`:
  - PASS
  - `Found 0 warnings and 0 errors.`
- `pnpm build`:
  - PASS
  - Completed end-to-end build pipeline including `build:plugin-sdk:dts` and post-build copy scripts.

## 4. Runtime Smoke Test

- Terminal A:
  - `cd /Users/samuelminer/Documents/openclaw && node openclaw.mjs --profile dev gateway run`
  - PASS (gateway listening on `ws://127.0.0.1:19001`)
- Terminal B:
  - `node openclaw.mjs --profile dev talk clio --history-limit 1 --message "ping"`
  - FAIL in this environment: `Agent "clio" not found. Available: dev`
  - `node openclaw.mjs --profile dev talk dev --history-limit 1 --message "ping"`
  - PASS (`Pong`)
- One-shot:
  - `node openclaw.mjs --profile dev agent --agent main --local --message "ping" --json`
  - FAIL in this environment: unknown agent id `main`
  - `node openclaw.mjs --profile dev agent --agent dev --local --message "ping" --json`
  - PASS (`Pong! 🏓`)

## 5. Handback

- **What changed**
  - Added shared family memory write lock wrapper and integrated it into write/edit tools.
  - Added targeted unit tests for lock targeting/wrapping behavior.
- **Which files changed**
  - `src/agents/shared-family-memory-write-lock.ts`
  - `src/agents/shared-family-memory-write-lock.test.ts`
  - `src/agents/pi-tools.ts`
- **What passed/failed**
  - Passed: targeted tests, `pnpm test:fast`, `pnpm lint`, `pnpm build`, gateway startup, `talk dev`, `agent --agent dev --local`.
  - Failed (environment config): `talk clio`, `agent --agent main --local` because only `dev` agent is configured in this profile.
- **Follow-up fixes needed**
  - If you want `clio`/`wren` smoke checks to be first-class pass criteria on this profile, add those agents to `--profile dev` (`openclaw --profile dev agents list` currently shows only `dev`).
