# 2026-03-10 - Shared family memory concurrent write safety

## Summary

OpenClaw now serializes shared family memory writes so sibling agents do not clobber each other when writing at the same time.

## Why it matters

- Prevents silent last-write-wins overwrites in shared memory files.
- Keeps sibling workflows safe when Clio, Wren, and other agents run concurrently.
- Preserves existing behavior for non-shared writes and single-agent flows.

## How to use

```bash
# No new command is required; existing write/edit flows are now lock-protected
# when targeting shared family memory paths.

# Optional smoke checks:
cd /Users/samuelminer/Documents/openclaw
node openclaw.mjs --profile dev gateway run
node openclaw.mjs --profile dev talk dev --history-limit 1 --message "ping"
node openclaw.mjs --profile dev agent --agent dev --local --message "ping" --json
```

## Behavior details

- Locking is applied only to `write` and `edit` tool calls.
- Lock targets are only shared family memory paths:
  - `~/.openclaw/shared/MEMORY.md`
  - `~/.openclaw/shared/memory.md`
  - `~/.openclaw/shared/memory/**`
- Non-shared paths are not lock-wrapped.
- Non-mutation tools are unchanged.
- Works for both sandboxed and non-sandboxed coding tool wiring.

## Files touched

- `src/agents/shared-family-memory-write-lock.ts`
- `src/agents/shared-family-memory-write-lock.test.ts`
- `src/agents/pi-tools.ts`

## Validation

- `pnpm vitest run src/agents/shared-family-memory-write-lock.test.ts src/agents/pi-tools.sandbox-mounted-paths.workspace-only.test.ts` (pass)
- `pnpm test:fast` (pass)
- `pnpm lint` (pass)
- `pnpm build` (pass)

## Commit

- Pending (not committed yet)
