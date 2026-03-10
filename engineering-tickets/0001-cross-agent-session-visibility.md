# 0001 — Cross-Agent Session Visibility

**Status:** IMPLEMENTED (awaiting review)
**Filed by:** Clio (main)
**Date:** 2026-03-10

---

## 1. Feature Ticket

### Goal

Allow sibling agents (e.g. Clio, Wren) to send messages to each other's sessions via `sessions_send`. Currently this returns `forbidden` with the message: _"Session send visibility is restricted. Set tools.sessions.visibility=all to allow cross-agent access."_

The goal is to make cross-agent messaging work by default for sibling agents on the same gateway, without requiring manual config changes.

### Acceptance Criteria

- Sibling agents on the same gateway can use `sessions_send` to message each other's sessions without error.
- A new config option (e.g. `tools.sessions.visibility`) controls this behavior with a sensible default:
  - `"siblings"` (default) — agents in the same config's `agents.list` can message each other
  - `"all"` — any session can message any other session
  - `"none"` — current restrictive behavior (backward compatible fallback)
- When visibility is `"siblings"`, agents NOT in the same `agents.list` are still blocked.
- The `forbidden` error message is clear about what config to change if the user wants different behavior.
- **Live terminal view:** When agent A initiates a conversation with agent B via `sessions_send`, a new terminal window automatically spawns showing agent B's session (similar to `talk --spawn` behavior). This lets the human observe the sibling conversation in real time.

### Constraints

- No breaking changes to existing single-agent setups (they should keep working identically).
- No gateway protocol changes.
- No config schema migration required — the new key should be optional with a sensible default.
- Don't change how `sessions_list` visibility works (that's a separate concern).

### How to Test Manually

1. Start gateway: `node openclaw.mjs --profile dev gateway run`
2. Launch both agents: `node openclaw.mjs --profile dev talk --all`
3. From Clio's session, run: `sessions_send(sessionKey="agent:wren:main", message="ping")`
4. Confirm Wren receives the message and can respond.
5. Confirm the reverse direction also works (Wren → Clio).

---

## 2. Implementation

Implemented in the sessions visibility guard + sessions tools wiring:

- Added new visibility modes to runtime config typing/schema/help:
  - `"siblings"` (new default for session tools visibility resolution)
  - `"none"` (explicitly deny cross-agent send)
  - existing `"self" | "tree" | "agent" | "all"` preserved
- Added sibling resolution from configured agents:
  - `resolveConfiguredSiblingAgentIds(cfg)` reads `cfg.agents.list` IDs
  - fallback includes `"main"` when list is missing
- Updated cross-agent authorization in `createSessionVisibilityGuard`:
  - `sessions_send` cross-agent is allowed when:
    - `visibility="all"` (any cross-agent send), or
    - `visibility="siblings"` and both source/target agent IDs are configured siblings
  - cross-agent send is denied for non-siblings with a dedicated forbidden message
  - same-agent behavior remains tree-like for restrictive modes (`none`/`siblings`)
  - list/history cross-agent rules remain unchanged (`all` + `agentToAgent`)
- Updated `sessions_send` execution flow:
  - removed early label-based cross-agent gate so authorization is consistently guard-driven
  - passes sibling IDs into guard
  - added best-effort auto terminal spawn hook for cross-agent sends:
    - launches target session in terminal using existing terminal launch helper
    - debounced per target session key (30s)
    - disabled in tests and when `OPENCLAW_DISABLE_A2A_TERMINAL_SPAWN=1`

## 3. Validation

Targeted tests (pass):

- `pnpm vitest run --config vitest.unit.config.ts src/agents/tools/sessions-access.test.ts src/config/config-misc.test.ts`
- `pnpm vitest run --config vitest.e2e.config.ts src/agents/tools/sessions.e2e.test.ts src/agents/openclaw-tools.sessions-visibility.e2e.test.ts src/agents/openclaw-tools.sessions.e2e.test.ts`

Broader checks (pass):

- `pnpm test:fast` -> PASS (`801` files, `6634` tests)
- `pnpm lint` -> PASS (`0` warnings, `0` errors)
- `pnpm build` -> PASS

Notes:

- One lint regression in `src/agents/tools/sessions.e2e.test.ts` (`no-base-to-string`) was fixed by replacing `String(...)` coercion with an explicit string type guard.

## 4. Runtime Smoke Test

Executed on this machine:

1. Started gateway:
   - `node openclaw.mjs --profile dev gateway run`
   - result: PASS (gateway listened on `ws://127.0.0.1:19001`)
2. Gateway-routed agent call:
   - `node openclaw.mjs --profile dev agent --agent dev --message "ping" --json`
   - result: gateway required pairing (`code=1008: pairing required`), CLI fell back to embedded, returned `Pong!`
3. Local embedded call:
   - `node openclaw.mjs --profile dev agent --agent dev --local --message "ping" --json`
   - result: PASS

Environment caveat:

- Current local `dev` profile only has one configured agent (`dev`) from `agents list`; `clio`/`wren` are not present in this profile on this machine, so live sibling-to-sibling terminal verification could not be executed here.

## 5. Handback

What changed:

- Implemented sibling-aware cross-agent send defaults and guard logic.
- Added explicit config support for `"siblings"` and `"none"` visibility modes.
- Added guarded auto terminal spawn for cross-agent send targets.
- Added/updated unit + e2e coverage for sibling-default cross-agent send behavior.

Files changed:

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

Pass/fail summary:

- Pass: targeted unit/e2e, `test:fast`, `lint`, `build`
- Partial runtime: gateway starts, but gateway command execution is blocked by local pairing requirement in this environment; local embedded execution passes

Follow-up needed:

- Pair this machine to the local gateway and ensure `clio`/`wren` exist in the active profile to run final live sibling terminal verification (`talk --all` + `sessions_send` both directions).
