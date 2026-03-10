# 2026-03-09 - Sibling agents on one gateway (deep dive)

## Summary

OpenClaw now supports launching multiple sibling agents (for example Clio, Wren, and others) concurrently against a single running gateway process via `talk --all` and `talk --spawn`.

## Problem solved

Before this change, opening sibling sessions often required manually juggling terminals and could accidentally cross profiles (`dev` vs `main`) when new terminals were spawned. That caused confusing auth/session behavior and made parallel sibling workflows unreliable.

## What changed

- Added shared terminal launch utility for CLI-spawned sessions.
- Added `talk --all` to launch one terminal per configured agent.
- Added `talk --spawn` to launch one selected agent in a new terminal window.
- Preserved existing default behavior (`talk <agent>` stays in current terminal).
- Refactored `topic` terminal launching to use the same profile-aware launcher.

## Key CLI behavior

### 1) Current behavior retained

```bash
node openclaw.mjs --profile dev talk clio
```

- Runs in the current terminal.
- Connects to the active profile gateway.

### 2) Spawn one sibling in new terminal

```bash
node openclaw.mjs --profile dev talk wren --spawn
```

- Opens a new terminal window/tab.
- Preserves profile (`--profile dev`) automatically.

### 3) Spawn all configured siblings

```bash
node openclaw.mjs --profile dev talk --all
```

- Opens one terminal per configured agent.
- Useful for operating Clio/Wren and additional siblings in parallel.

## Acceptance criteria implemented

- `talk --all` launches one terminal per configured agent.
- `talk --spawn` launches the selected agent in a new terminal.
- `talk <agent>` remains backward-compatible in current terminal.
- `talk <agent> --all` fails with clear error (invalid combination).
- Spawned commands include active profile automatically (unless explicit `--profile`/`--dev` already provided).

## Constraints respected

- No config schema or state format changes.
- No gateway protocol changes.
- No breaking changes to existing single-agent usage.
- Profile handling remains explicit and deterministic.

## Architecture notes

A shared terminal runner now centralizes:

- shell escaping,
- per-platform terminal launch strategy,
- profile injection for spawned commands,
- local repo CLI execution preference (`node ./openclaw.mjs` when available).

This removed duplicated launcher logic in `topic` and keeps future spawn behavior consistent across commands.

## Files touched

- `src/cli/terminal-launch.ts`
- `src/cli/talk-cli.ts`
- `src/cli/topic-cli.ts`
- `src/cli/terminal-launch.test.ts`
- `src/cli/talk-cli.test.ts`

## Validation performed

- `pnpm lint`
- `pnpm vitest run src/cli/talk-cli.test.ts src/cli/terminal-launch.test.ts`
- `pnpm build`
- `node openclaw.mjs talk --help`

### Additional follow-up validation

Unexpected duplicate files found locally (untracked):

- `src/cli/talk-cli.test 2.ts`
- `src/cli/terminal-launch 2.ts`
- `src/cli/terminal-launch.test 2.ts`

Validation outcome:

- They are byte-identical duplicates of canonical files (matching SHA-256 values).
- They pass `oxlint --type-aware`.
- They are intentionally left uncommitted in this docs-only commit.

## Operational test flow (manual)

```bash
# Terminal A
cd /Users/samuelminer/Documents/openclaw
node openclaw.mjs --profile dev gateway run

# Terminal B
cd /Users/samuelminer/Documents/openclaw
node openclaw.mjs --profile dev talk --all
```

Then in spawned terminals:

- Send `ping` from each sibling.
- Confirm each agent has its own `agent:<id>:main` session key.
- Confirm all clients are connected to the same gateway URL/port for the profile.

## Known caveats

- `talk --all` depends on platform terminal launcher availability.
- If automatic terminal open fails, the CLI prints manual commands to run.
- Keep gateway and clients on the same profile (`dev` or `main`) to avoid auth/session mismatches.

## Commit

- `248f2cf78` (`feat(talk): launch siblings concurrently via shared terminal runner`)
