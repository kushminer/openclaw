# 2026-03-09 - Sibling memory sharing and topic sync baseline

## Summary

OpenClaw added sibling-level shared memory defaults and topic daily sync behavior so Clio, Wren, and other siblings can share context and keep topic summaries current.

## Why it matters

- Shared memory gives sibling agents a common knowledge surface.
- Topic sync keeps long-running topic threads summarized without manual note wrangling.
- The behavior is profile-consistent and works with the same single-gateway sibling workflow.

## What shipped

### 1) Shared family memory defaults

Default extra memory search paths now include:

- `~/.openclaw/shared/MEMORY.md`
- `~/.openclaw/shared/memory.md`
- `~/.openclaw/shared/memory/`

These are wired via `resolveSharedDir()` + `resolveDefaultExtraPaths()` and show up in memory status output.

### 2) Topic daily sync (24h cadence)

- Topic summaries sync automatically on a daily cadence (24h interval).
- Manual sync is available via `openclaw topic sync [name]`.
- `--force` bypasses cadence checks.
- Mother-topic conflict intake and triage run through `topic conflicts`.

Important: this is topic summary sync behavior, not cron scheduler sync.

## How to use

```bash
# Inspect memory wiring (includes shared defaults)
node openclaw.mjs --profile dev memory status

# Manually sync all topics for an agent
node openclaw.mjs --profile dev topic sync --agent dev

# Force a sync for one topic
node openclaw.mjs --profile dev topic sync launch-plan --agent dev --force

# Review and triage mother-topic conflicts
node openclaw.mjs --profile dev topic conflicts list --agent dev
```

## Files touched

- `src/agents/workspace.ts`
- `src/agents/memory-search.ts`
- `src/agents/tools/memory-tool.ts`
- `src/topics/summary-chain.ts`
- `src/auto-reply/reply/topic-daily-sync.ts`
- `src/cli/topic-cli.ts`
- `docs/cli/memory.md`

## Validation

- `src/agents/memory-search.e2e.test.ts`
- `src/auto-reply/reply/topic-daily-sync.test.ts`
- `src/topics/summary-chain.test.ts`
- `src/topics/branch-sync.test.ts`

## Commit

- `ad161e4bc` (`feat(agents): stabilize family/topic multi-agent workflow baseline`)
