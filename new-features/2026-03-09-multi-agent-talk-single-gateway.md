# 2026-03-09 - Multi-agent talk over a single gateway

## Summary

Added multi-agent terminal launch support so multiple sibling agents can run concurrently on one gateway.

## Why it matters

You can now run Clio, Wren, and other siblings at the same time without separate gateway instances.

## How to use

```bash
# Start one gateway (Terminal A)
node openclaw.mjs --profile dev gateway run

# Launch all configured agents in separate terminals (Terminal B)
node openclaw.mjs --profile dev talk --all

# Launch one agent in a new terminal
node openclaw.mjs --profile dev talk clio --spawn

# Keep existing behavior in current terminal
node openclaw.mjs --profile dev talk wren
```

## Behavior details

- `talk --all` launches one terminal per configured agent.
- `talk --spawn` launches the selected agent in a new terminal.
- Spawned commands now preserve active profile (`--profile dev`, `--profile main`, etc.).
- Topic terminal launching now uses the same profile-aware terminal launcher.

## Files touched

- `src/cli/talk-cli.ts`
- `src/cli/topic-cli.ts`
- `src/cli/terminal-launch.ts`
- `src/cli/talk-cli.test.ts`
- `src/cli/terminal-launch.test.ts`

## Validation

- `pnpm lint`
- `pnpm vitest run src/cli/talk-cli.test.ts src/cli/terminal-launch.test.ts`
- `pnpm build`

## Commit

- `248f2cf78` (`feat(talk): launch siblings concurrently via shared terminal runner`)
