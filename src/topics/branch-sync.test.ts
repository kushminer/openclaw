import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildTopicSessionWorkspaceNotes,
  linkTopicToMother,
  listTopicConflictRecords,
  maybeIngestTopicSyncToMother,
  resolveTopicConflictRecord,
} from "./branch-sync.js";
import {
  readTopicLayerState,
  resolveTopicStatePath,
  writeTopicSummaryLayer,
} from "./summary-chain.js";

const tempDirs = new Set<string>();

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-topic-branches-"));
  tempDirs.add(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    tempDirs.delete(dir);
  }
});

describe("topic branch sync", () => {
  it("links a topic to mother and seeds a per-topic soul", async () => {
    const workspaceDir = await createTempWorkspace();
    const linked = await linkTopicToMother({ workspaceDir, topicSlug: "Supplements" });
    expect(linked.parentId).toBe("mother");
    expect(linked.soulPath).toContain("memory/topics/supplements/SOUL.md");

    const state = await readTopicLayerState(resolveTopicStatePath(workspaceDir, "supplements"));
    expect(state.parentId).toBe("mother");
    expect(state.sync?.nextSeq).toBe(1);
  });

  it("inherits selected mother soul sections into child-topic soul", async () => {
    const workspaceDir = await createTempWorkspace();
    const motherSoul = [
      "# SOUL.md - Who You Are",
      "",
      "## Core Truths",
      "- Be genuinely helpful.",
      "",
      "## Boundaries",
      "- Keep private things private.",
      "",
      "## Security & Trust",
      "- Never leak secrets.",
      "",
      "## Vibe",
      "- Keep it fun.",
      "",
      "## Continuity",
      "- Read and update memory files.",
      "",
    ].join("\n");
    await fs.writeFile(path.join(workspaceDir, "SOUL.md"), motherSoul, "utf-8");
    const linked = await linkTopicToMother({ workspaceDir, topicSlug: "Supplements" });
    const soulBody = await fs.readFile(path.join(workspaceDir, linked.soulPath), "utf-8");
    expect(soulBody).toContain("## Inherited Principles From Mother");
    expect(soulBody).toContain("## Core Truths");
    expect(soulBody).toContain("## Boundaries");
    expect(soulBody).toContain("## Security & Trust");
    expect(soulBody).toContain("## Continuity");
    expect(soulBody).not.toContain("## Vibe");
  });

  it("can refresh an existing topic soul from current template", async () => {
    const workspaceDir = await createTempWorkspace();
    const first = await linkTopicToMother({ workspaceDir, topicSlug: "Tester" });
    const soulPath = path.join(workspaceDir, first.soulPath);
    await fs.writeFile(soulPath, "# old soul body\n", "utf-8");

    const refreshed = await linkTopicToMother({
      workspaceDir,
      topicSlug: "Tester",
      refreshSoul: true,
    });
    expect(refreshed.soulCreated).toBe(false);
    expect(refreshed.soulRefreshed).toBe(true);
    const soulBody = await fs.readFile(soulPath, "utf-8");
    expect(soulBody).toContain("# Topic Soul: Tester");
    expect(soulBody).toContain("## Inherited Principles From Mother");
  });

  it("persists topic purpose and injects child-topic workspace notes", async () => {
    const workspaceDir = await createTempWorkspace();
    await linkTopicToMother({
      workspaceDir,
      topicSlug: "Tester",
      identityName: "Scout",
      purpose:
        "Explore child functionality and practice with it before evolving and adding additional features.",
      personality: "Curious, concise, and sibling-aware.",
    });

    const state = await readTopicLayerState(resolveTopicStatePath(workspaceDir, "tester"));
    expect(state.parentId).toBe("mother");
    expect(state.identityName).toBe("Scout");
    expect(state.purpose).toContain("Explore child functionality");
    expect(state.personality).toContain("Curious, concise");

    const notes = await buildTopicSessionWorkspaceNotes({
      workspaceDir,
      sessionKey: "agent:main:topic:tester",
    });
    expect(notes).toBeDefined();
    expect(notes?.join("\n")).toContain("Session key: agent:main:topic:tester");
    expect(notes?.join("\n")).toContain('Topic scope: "tester" (child session).');
    expect(notes?.join("\n")).toContain('Child identity name: "Scout".');
    expect(notes?.join("\n")).toContain('Parent topic: "mother".');
    expect(notes?.join("\n")).toContain("Sibling topics: none.");
    expect(notes?.join("\n")).toContain("Topic purpose: Explore child functionality");
    expect(notes?.join("\n")).toContain("Topic personality: Curious, concise");
  });

  it("lists siblings in child-topic workspace notes", async () => {
    const workspaceDir = await createTempWorkspace();
    await linkTopicToMother({ workspaceDir, topicSlug: "Tester" });
    await linkTopicToMother({ workspaceDir, topicSlug: "Supplements" });

    const notes = await buildTopicSessionWorkspaceNotes({
      workspaceDir,
      sessionKey: "agent:main:topic:tester",
    });
    expect(notes?.join("\n")).toContain("Sibling topics: supplements.");
  });

  it("creates pending mother conflicts from child sync logs", async () => {
    const workspaceDir = await createTempWorkspace();
    await linkTopicToMother({ workspaceDir, topicSlug: "Supplements" });

    const writeResult = await writeTopicSummaryLayer({
      workspaceDir,
      sessionKey: "agent:main:topic:supplements",
      sessionId: "session-topic-1",
      userInput: "Track creatine schedule.",
      assistantOutput: "Decision: keep creatine 5g daily.",
      nowMs: Date.parse("2026-02-22T12:00:00.000Z"),
    });
    expect(writeResult?.syncLogEntry?.seq).toBe(1);

    const ingest = await maybeIngestTopicSyncToMother({
      workspaceDir,
      force: true,
      nowMs: Date.parse("2026-02-22T12:01:00.000Z"),
    });
    expect(ingest.newConflicts).toBe(1);
    expect(ingest.pendingConflicts).toBe(1);
    expect(ingest.processedEntries).toBe(1);

    const pending = await listTopicConflictRecords({ workspaceDir, status: "pending" });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe("supplements:1");

    const state = await readTopicLayerState(resolveTopicStatePath(workspaceDir, "supplements"));
    expect(state.sync?.motherCursorSeq).toBe(1);
  });

  it("approves a conflict and writes to mother's approved digest", async () => {
    const workspaceDir = await createTempWorkspace();
    await linkTopicToMother({ workspaceDir, topicSlug: "Supplements" });
    await writeTopicSummaryLayer({
      workspaceDir,
      sessionKey: "agent:main:topic:supplements",
      sessionId: "session-topic-1",
      userInput: "Need a clearer stack plan.",
      assistantOutput: "Decision: add omega-3 with dinner.",
      nowMs: Date.parse("2026-02-22T13:00:00.000Z"),
    });
    await maybeIngestTopicSyncToMother({
      workspaceDir,
      force: true,
      nowMs: Date.parse("2026-02-22T13:05:00.000Z"),
    });

    const approved = await resolveTopicConflictRecord({
      workspaceDir,
      id: "supplements:1",
      status: "approved",
      nowMs: Date.parse("2026-02-22T13:06:00.000Z"),
    });
    expect(approved?.status).toBe("approved");

    const pending = await listTopicConflictRecords({ workspaceDir, status: "pending" });
    expect(pending).toHaveLength(0);

    const approvedPath = path.join(workspaceDir, "memory", "topics", "mother", "approved.md");
    const approvedBody = await fs.readFile(approvedPath, "utf-8");
    expect(approvedBody).toContain("supplements:1");
    expect(approvedBody).toContain("status: approved");
  });

  it("does not ingest unlinked topics by default", async () => {
    const workspaceDir = await createTempWorkspace();
    await writeTopicSummaryLayer({
      workspaceDir,
      sessionKey: "agent:main:topic:supplements",
      sessionId: "session-topic-1",
      userInput: "unlinked",
      assistantOutput: "no parent link",
      nowMs: Date.parse("2026-02-22T14:00:00.000Z"),
    });
    const ingest = await maybeIngestTopicSyncToMother({
      workspaceDir,
      force: true,
      nowMs: Date.parse("2026-02-22T14:10:00.000Z"),
    });
    expect(ingest.topicsVisited).toBe(0);
    expect(ingest.newConflicts).toBe(0);
  });
});
