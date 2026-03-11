# 2026-03-10 - Terminal spawn auto-greeting

## Summary

Spawned agent terminals now automatically send a short greeting prompt so the agent responds immediately after launch. This removes the blank-start experience when using sibling terminal spawn flows.

## What Changed

- `openclaw talk <agent> --spawn` now injects a default `--message` when none is provided.
- `openclaw talk --all` now injects a per-agent default greeting for each spawned terminal.
- Explicit `--message` values are still respected and are not overridden.

## How to Use

```bash
# Spawns a new terminal and auto-sends a greeting prompt
node openclaw.mjs --profile main talk clio --spawn

# Spawns one terminal per configured agent, each with an auto greeting
node openclaw.mjs --profile main talk --all

# Override the default greeting
node openclaw.mjs --profile main talk wren --spawn --message "Daily check-in?"
```

## Impact on Agents

How this affects sibling agents (Clio, Wren, etc.):

- New capabilities unlocked
  Spawned terminals immediately start with a live agent response.
- Behavior changes to be aware of
  Spawned sessions now include an initial user message if none is passed explicitly.
- Config to update (if any)
  None.

## Constraints / Caveats

- Default greeting applies only to spawned terminal flows (`--spawn`, `--all`).
- Non-spawn interactive `talk` behavior is unchanged.
- If you pass `--message`, that value is used instead of the default greeting.

## Files Touched

- `src/cli/talk-cli.ts`
- `src/cli/talk-cli.test.ts`

## Validation

- `pnpm vitest run src/cli/talk-cli.test.ts src/cli/terminal-launch.test.ts`
- `pnpm lint`
- `pnpm build`

## Commit

- `<pending>` (`feat(talk): auto-greet agents in spawned terminals`)
