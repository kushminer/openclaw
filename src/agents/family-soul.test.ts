import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import {
  buildAgentFamilyWorkspaceNotes,
  normalizeAgentSoulPurpose,
  resolveAgentFamilyInfo,
  upsertAgentFamilySoulFile,
} from "./family-soul.js";

const tempDirs = new Set<string>();

const asConfig = (cfg: OpenClawConfig): OpenClawConfig => cfg;

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-family-soul-"));
  tempDirs.add(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    tempDirs.delete(dir);
  }
});

describe("family soul", () => {
  it("resolves child/root/sibling family metadata", () => {
    const cfg = asConfig({
      agents: {
        list: [
          { id: "main", default: true },
          { id: "tester", model: "openai/gpt-5-mini" },
          { id: "writer" },
        ],
      },
    });
    const child = resolveAgentFamilyInfo(cfg, "tester");
    expect(child.rootAgentId).toBe("main");
    expect(child.isRootAgent).toBe(false);
    expect(child.siblingAgentIds).toEqual(["main", "writer"]);
    expect(child.hasExplicitCapabilityOverrides).toBe(true);

    const root = resolveAgentFamilyInfo(cfg, "main");
    expect(root.isRootAgent).toBe(true);
    expect(root.siblingAgentIds).toEqual(["tester", "writer"]);
  });

  it("normalizes purpose text", () => {
    expect(normalizeAgentSoulPurpose(undefined)).toBeUndefined();
    expect(normalizeAgentSoulPurpose("   ")).toBeUndefined();
    expect(normalizeAgentSoulPurpose("  focus on testing family flow  ")).toBe(
      "focus on testing family flow",
    );
  });

  it("writes and updates the family SOUL block while preserving birth timestamp", async () => {
    const workspaceDir = await makeWorkspace();
    const soulPath = path.join(workspaceDir, "SOUL.md");
    await fs.writeFile(soulPath, "# SOUL.md\n\nBaseline content.\n", "utf-8");
    const cfg = asConfig({
      agents: {
        list: [{ id: "main", default: true }, { id: "tester" }],
      },
    });

    const first = await upsertAgentFamilySoulFile({
      workspaceDir,
      config: cfg,
      agentId: "tester",
      purpose: "Explore child functionality before adding more features.",
      bornAtIso: "2026-02-23T00:00:00.000Z",
      isNewborn: true,
    });
    const firstContent = await fs.readFile(soulPath, "utf-8");
    expect(first.bornAtIso).toBe("2026-02-23T00:00:00.000Z");
    expect(firstContent).toContain("OPENCLAW_AGENT_FAMILY_START");
    expect(firstContent).toContain("Birth state: Freshly born.");
    expect(firstContent).toContain(
      "Purpose: Explore child functionality before adding more features.",
    );

    const second = await upsertAgentFamilySoulFile({
      workspaceDir,
      config: cfg,
      agentId: "tester",
      purpose: "Practice sibling coordination and memory sharing.",
      isNewborn: false,
    });
    const secondContent = await fs.readFile(soulPath, "utf-8");
    expect(second.bornAtIso).toBe("2026-02-23T00:00:00.000Z");
    expect(secondContent).toContain("Purpose: Practice sibling coordination and memory sharing.");
    expect(secondContent).toContain("Birth state: Ongoing family member.");
    expect(secondContent.match(/OPENCLAW_AGENT_FAMILY_START/g)?.length).toBe(1);
  });

  it("builds family workspace notes for prompts", () => {
    const cfg = asConfig({
      agents: {
        list: [{ id: "main", default: true }, { id: "tester" }],
      },
    });
    const notes = buildAgentFamilyWorkspaceNotes({ config: cfg, agentId: "tester" });
    expect(notes).toBeTruthy();
    expect(notes?.join("\n")).toContain("child/sibling agent");
    expect(notes?.join("\n")).toContain("Fresh-boot rule");
    expect(notes?.join("\n")).toContain("shared family defaults");
  });
});
