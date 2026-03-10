import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  TOPIC_DAILY_SYNC_INTERVAL_MS,
  shouldRunTopicDailySync,
  writeTopicSummaryLayer,
} from "./summary-chain.js";

const tempDirs = new Set<string>();

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-topic-sync-"));
  tempDirs.add(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    tempDirs.delete(dir);
  }
});

describe("topic summary chain", () => {
  it("enforces 24h daily sync interval by default", () => {
    const now = Date.now();
    expect(
      shouldRunTopicDailySync({ lastSyncedAt: now - TOPIC_DAILY_SYNC_INTERVAL_MS - 1, nowMs: now }),
    ).toBe(true);
    expect(
      shouldRunTopicDailySync({ lastSyncedAt: now - TOPIC_DAILY_SYNC_INTERVAL_MS + 1, nowMs: now }),
    ).toBe(false);
  });

  it("writes layered summaries with previous-layer links", async () => {
    const workspaceDir = await createTempWorkspace();
    const first = await writeTopicSummaryLayer({
      workspaceDir,
      sessionKey: "agent:main:topic:supplements",
      sessionId: "session-1",
      userInput: "Track creatine and magnesium schedule.",
      assistantOutput: "We agreed to 5g creatine daily and magnesium glycinate at night.",
      nowMs: Date.parse("2026-02-20T10:00:00.000Z"),
    });
    expect(first).not.toBeNull();
    expect(first?.layer).toBe(1);
    if (!first) {
      throw new Error("expected first layer");
    }

    const second = await writeTopicSummaryLayer({
      workspaceDir,
      sessionKey: "agent:main:topic:supplements",
      sessionId: "session-1",
      userInput: "Add omega-3 and monitor stomach tolerance.",
      assistantOutput: "Added omega-3 with meal guidance and side-effect tracking.",
      nowMs: Date.parse("2026-02-21T10:00:00.000Z"),
    });
    expect(second).not.toBeNull();
    expect(second?.layer).toBe(2);
    expect(second?.summaryPath).toContain("/layers/");
    expect(second?.rawPath).toContain("/raw/");

    const latestPath = path.join(workspaceDir, "memory", "topics", "supplements", "LATEST.md");
    const latest = await fs.readFile(latestPath, "utf-8");
    expect(latest).toContain("latest_layer: L2");
    expect(latest).toContain("previous_summary:");

    const secondSummaryAbs = path.join(workspaceDir, second!.summaryPath);
    const secondSummary = await fs.readFile(secondSummaryAbs, "utf-8");
    expect(secondSummary).toContain("previous_layer:");
    expect(secondSummary).toContain(first.summaryPath);

    const masterPath = path.join(workspaceDir, "memory", "topics", "MASTER_SUMMARIES.md");
    const master = await fs.readFile(masterPath, "utf-8");
    expect(master).toContain("# Topic Summaries");
    expect(master).toContain("supplements (L1)");
    expect(master).toContain("supplements (L2)");
  });

  it("returns null for non-topic session keys", async () => {
    const workspaceDir = await createTempWorkspace();
    const result = await writeTopicSummaryLayer({
      workspaceDir,
      sessionKey: "agent:main:main",
      userInput: "hello",
      assistantOutput: "world",
    });
    expect(result).toBeNull();
  });
});
