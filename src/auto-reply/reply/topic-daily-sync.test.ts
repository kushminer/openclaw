import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionEntry } from "../../config/sessions.js";
import { linkTopicToMother, listTopicConflictRecords } from "../../topics/branch-sync.js";
import { writeTopicSummaryLayer } from "../../topics/summary-chain.js";
import { maybeRunTopicDailySummarySync } from "./topic-daily-sync.js";

const tempDirs = new Set<string>();

async function createWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-topic-daily-sync-"));
  tempDirs.add(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    tempDirs.delete(dir);
  }
});

describe("maybeRunTopicDailySummarySync", () => {
  it("creates a layered summary and updates in-memory session metadata", async () => {
    const workspaceDir = await createWorkspace();
    const sessionKey = "agent:main:topic:supplements";
    const sessionEntry: SessionEntry = {
      sessionId: "topic-session-1",
      updatedAt: Date.now(),
    };
    const sessionStore: Record<string, SessionEntry> = {
      [sessionKey]: sessionEntry,
    };

    const updated = await maybeRunTopicDailySummarySync({
      sessionKey,
      sessionEntry,
      sessionStore,
      workspaceDir,
      sessionId: "topic-session-1",
      userInput: "Need a summary of supplement decisions.",
      replyPayloads: [{ text: "Creatine 5g daily, magnesium at night." }],
      isHeartbeat: false,
      nowMs: Date.parse("2026-02-20T12:00:00.000Z"),
    });

    expect(updated?.topicLatestSummaryLayer).toBe(1);
    expect(updated?.topicLatestSummaryPath).toContain("memory/topics/supplements/layers/");
    expect(updated?.topicLatestRawPath).toContain("memory/topics/supplements/raw/");
    expect(updated?.topicLastSummarySyncAt).toBe(Date.parse("2026-02-20T12:00:00.000Z"));

    const masterPath = path.join(workspaceDir, "memory", "topics", "MASTER_SUMMARIES.md");
    const master = await fs.readFile(masterPath, "utf-8");
    expect(master).toContain("supplements (L1)");
  });

  it("skips sync when the previous sync is still within 24 hours", async () => {
    const workspaceDir = await createWorkspace();
    const sessionKey = "agent:main:topic:supplements";
    const firstSyncAt = Date.parse("2026-02-20T12:00:00.000Z");
    const sessionEntry: SessionEntry = {
      sessionId: "topic-session-1",
      updatedAt: firstSyncAt,
      topicLastSummarySyncAt: firstSyncAt,
      topicLatestSummaryLayer: 3,
      topicLatestSummaryPath: "memory/topics/supplements/layers/existing-L3.md",
      topicLatestRawPath: "memory/topics/supplements/raw/existing.md",
    };
    const sessionStore: Record<string, SessionEntry> = {
      [sessionKey]: sessionEntry,
    };

    const updated = await maybeRunTopicDailySummarySync({
      sessionKey,
      sessionEntry,
      sessionStore,
      workspaceDir,
      sessionId: "topic-session-1",
      userInput: "Any updates?",
      replyPayloads: [{ text: "No major changes." }],
      isHeartbeat: false,
      nowMs: firstSyncAt + 60_000,
    });

    expect(updated?.topicLatestSummaryLayer).toBe(3);
    const masterPath = path.join(workspaceDir, "memory", "topics", "MASTER_SUMMARIES.md");
    await expect(fs.access(masterPath)).rejects.toThrow();
  });

  it("ingests child sync logs when mother session heartbeats", async () => {
    const workspaceDir = await createWorkspace();
    await linkTopicToMother({ workspaceDir, topicSlug: "supplements" });
    await writeTopicSummaryLayer({
      workspaceDir,
      sessionKey: "agent:main:topic:supplements",
      sessionId: "topic-session-1",
      userInput: "Track magnesium timing.",
      assistantOutput: "Decision: magnesium glycinate after dinner.",
      nowMs: Date.parse("2026-02-20T13:00:00.000Z"),
    });

    const sessionEntry: SessionEntry = {
      sessionId: "main-session-1",
      updatedAt: Date.now(),
    };
    await maybeRunTopicDailySummarySync({
      sessionKey: "agent:main:main",
      sessionEntry,
      workspaceDir,
      sessionId: "main-session-1",
      userInput: "",
      replyPayloads: [],
      isHeartbeat: true,
      mainKey: "main",
      nowMs: Date.parse("2026-02-20T13:05:00.000Z"),
    });

    const pending = await listTopicConflictRecords({ workspaceDir, status: "pending" });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe("supplements:1");
  });
});
