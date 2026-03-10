# 2026-03-10-001 - Sibling Cross-Agent Session Visibility

## Summary

OpenClaw now supports sibling-to-sibling `sessions_send` by default when agents are configured together. This removes the previous need to force `tools.sessions.visibility=all` just to let sibling agents collaborate.

## What Changed

- Added two session visibility modes: `siblings` and `none`.
- Changed default session visibility resolution to `siblings`.
- Added configured sibling detection from `agents.list`.
- Updated `sessions_send` authorization:
  - `siblings`: allow cross-agent sends only between configured siblings.
  - `all`: allow any cross-agent send.
  - restrictive modes deny with clear guidance.
- Kept cross-agent `sessions_list` and `sessions_history` behavior unchanged.
- Added best-effort auto terminal spawn on cross-agent `sessions_send` (debounced, test-safe).

## How to Use

```bash
# Start gateway
node openclaw.mjs --profile dev gateway run

# Open sibling terminals
node openclaw.mjs --profile dev talk --all

# Send from one sibling session to another
# Example session key target used by sessions_send:
# agent:wren:main
```

```yaml
# Optional explicit config
tools:
  sessions:
    visibility: siblings # default behavior
```

## Impact on Agents

How this affects sibling agents (Clio, Wren, etc.):

- New capabilities unlocked:
  - sibling agents can coordinate directly over `sessions_send` without `visibility=all`.
- Behavior changes to be aware of:
  - cross-agent send to non-siblings is still blocked in `siblings` mode.
- Config to update (if any):
  - set `tools.sessions.visibility=all` only if you want fully open cross-agent sends.

## Constraints / Caveats

- `sessions_list` and `sessions_history` cross-agent rules are intentionally unchanged.
- Auto terminal spawn is best-effort and can be disabled with `OPENCLAW_DISABLE_A2A_TERMINAL_SPAWN=1`.
- Gateway pairing/auth requirements still apply at runtime.

## Files Touched

- `src/agents/tools/sessions-access.ts`
- `src/agents/tools/sessions-access.test.ts`
- `src/agents/tools/sessions-helpers.ts`
- `src/agents/tools/sessions-list-tool.ts`
- `src/agents/tools/sessions-history-tool.ts`
- `src/agents/tools/sessions-send-tool.ts`
- `src/agents/tools/sessions.e2e.test.ts`
- `src/config/types.tools.ts`
- `src/config/zod-schema.agent-runtime.ts`
- `src/config/schema.help.ts`

## Validation

- `pnpm test:fast` (pass)
- `pnpm lint` (pass)
- `pnpm build` (pass)

## Commit

- `<pending>`
