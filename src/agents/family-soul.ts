import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { listAgentIds, resolveAgentConfig, resolveDefaultAgentId } from "./agent-scope.js";
import { DEFAULT_SOUL_FILENAME } from "./workspace.js";

const FAMILY_SOUL_START = "<!-- OPENCLAW_AGENT_FAMILY_START -->";
const FAMILY_SOUL_END = "<!-- OPENCLAW_AGENT_FAMILY_END -->";
const PURPOSE_MAX_CHARS = 600;

export type AgentFamilyInfo = {
  agentId: string;
  rootAgentId: string;
  siblingAgentIds: string[];
  isRootAgent: boolean;
  hasExplicitCapabilityOverrides: boolean;
};

type ExistingFamilySoulMetadata = {
  bornAtIso?: string;
  purpose?: string;
};

export function normalizeAgentSoulPurpose(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, PURPOSE_MAX_CHARS);
}

function detectAgentCapabilityOverrides(cfg: OpenClawConfig, agentId: string): boolean {
  const entry = resolveAgentConfig(cfg, agentId);
  if (!entry) {
    return false;
  }
  return Boolean(
    entry.model ||
    entry.skills ||
    entry.memorySearch ||
    entry.groupChat ||
    entry.sandbox ||
    entry.tools ||
    entry.humanDelay ||
    entry.heartbeat,
  );
}

export function resolveAgentFamilyInfo(cfg: OpenClawConfig, agentIdRaw: string): AgentFamilyInfo {
  const agentId = normalizeAgentId(agentIdRaw);
  const rootAgentId = normalizeAgentId(resolveDefaultAgentId(cfg));
  const siblingAgentIds = listAgentIds(cfg).filter((id) => normalizeAgentId(id) !== agentId);
  return {
    agentId,
    rootAgentId,
    siblingAgentIds,
    isRootAgent: agentId === rootAgentId,
    hasExplicitCapabilityOverrides: detectAgentCapabilityOverrides(cfg, agentId),
  };
}

export function buildAgentFamilyWorkspaceNotes(params: {
  config?: OpenClawConfig;
  agentId?: string;
}): string[] | undefined {
  if (!params.config || !params.agentId) {
    return undefined;
  }
  const info = resolveAgentFamilyInfo(params.config, params.agentId);
  const roleLine = info.isRootAgent
    ? `Family role: you are the root/mother agent (${info.rootAgentId}).`
    : `Family role: you are a child/sibling agent in the ${info.rootAgentId} family.`;
  const siblings =
    info.siblingAgentIds.length > 0 ? info.siblingAgentIds.join(", ") : "none configured";
  const baseline = info.hasExplicitCapabilityOverrides
    ? "Capability baseline: family defaults define tools/capabilities/models, but this agent has explicit capability overrides configured."
    : "Capability baseline: use shared family defaults for tools, capabilities, and models.";
  return [
    `Agent id: ${info.agentId}.`,
    roleLine,
    `Sibling agents: ${siblings}.`,
    baseline,
    "Fresh-boot rule: when context is sparse, treat yourself as freshly born and ask focused clarifying questions before making assumptions.",
  ];
}

function normalizeIsoTimestamp(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  const stamp = new Date(trimmed);
  if (!Number.isFinite(stamp.getTime())) {
    return undefined;
  }
  return stamp.toISOString();
}

function extractFamilySoulBlock(content: string): string | undefined {
  const start = content.indexOf(FAMILY_SOUL_START);
  if (start < 0) {
    return undefined;
  }
  const end = content.indexOf(FAMILY_SOUL_END, start);
  if (end < 0) {
    return undefined;
  }
  return content.slice(start, end + FAMILY_SOUL_END.length);
}

function extractFamilySoulMetadata(content: string): ExistingFamilySoulMetadata {
  const block = extractFamilySoulBlock(content);
  if (!block) {
    return {};
  }
  const bornMatch = block.match(/^- Born at:\s*(.+)$/m);
  const purposeMatch = block.match(/^- Purpose:\s*(.+)$/m);
  const bornAtIso = normalizeIsoTimestamp(bornMatch?.[1]);
  const purpose = normalizeAgentSoulPurpose(purposeMatch?.[1]);
  return { bornAtIso, purpose };
}

function buildFamilySoulBlock(params: {
  info: AgentFamilyInfo;
  bornAtIso: string;
  purpose?: string;
  isNewborn: boolean;
}): string {
  const role = params.info.isRootAgent
    ? `Family root (mother) agent for ${params.info.rootAgentId}`
    : `Child/sibling agent under ${params.info.rootAgentId}`;
  const siblings =
    params.info.siblingAgentIds.length > 0
      ? params.info.siblingAgentIds.map((id) => `\`${id}\``).join(", ")
      : "none";
  const baseline = params.info.hasExplicitCapabilityOverrides
    ? "Shared defaults apply family-wide, but this agent currently has explicit capability overrides in config."
    : "Use shared family defaults for tools, capabilities, and model behavior.";
  const newborn = params.isNewborn
    ? "Freshly born. Learn context incrementally, ask focused questions, and stay aligned with family values."
    : "Ongoing family member. Keep continuity with existing memory and family values.";
  return [
    FAMILY_SOUL_START,
    "## Family Identity",
    `- Agent id: \`${params.info.agentId}\``,
    `- Family root: \`${params.info.rootAgentId}\``,
    `- Role: ${role}`,
    `- Born at: ${params.bornAtIso}`,
    `- Birth state: ${newborn}`,
    `- Siblings: ${siblings}`,
    `- Capability rule: ${baseline}`,
    `- Purpose: ${
      params.purpose ??
      'Purpose not set yet. Set it with `openclaw agents set-soul --agent <id> --purpose "..."`.'
    }`,
    FAMILY_SOUL_END,
  ].join("\n");
}

function upsertFamilySoulBlock(content: string, block: string): string {
  const start = content.indexOf(FAMILY_SOUL_START);
  if (start < 0) {
    const trimmed = content.trimEnd();
    return `${trimmed}${trimmed ? "\n\n" : ""}${block}\n`;
  }
  const end = content.indexOf(FAMILY_SOUL_END, start);
  if (end < 0) {
    const prefix = content.slice(0, start).trimEnd();
    return `${prefix}${prefix ? "\n\n" : ""}${block}\n`;
  }
  const suffixStart = end + FAMILY_SOUL_END.length;
  const before = content.slice(0, start).trimEnd();
  const after = content.slice(suffixStart).trimStart();
  const joined = [before, block, after].filter(Boolean).join("\n\n");
  return `${joined}\n`;
}

export async function upsertAgentFamilySoulFile(params: {
  workspaceDir: string;
  config: OpenClawConfig;
  agentId: string;
  purpose?: string;
  bornAtIso?: string;
  isNewborn?: boolean;
}): Promise<{
  soulPath: string;
  info: AgentFamilyInfo;
  purpose?: string;
  bornAtIso: string;
  updated: boolean;
}> {
  const workspaceDir = path.resolve(params.workspaceDir);
  const soulPath = path.join(workspaceDir, DEFAULT_SOUL_FILENAME);
  const info = resolveAgentFamilyInfo(params.config, params.agentId);
  const current = await fs.readFile(soulPath, "utf-8").catch(() => "# SOUL.md\n");
  const existing = extractFamilySoulMetadata(current);
  const purpose = normalizeAgentSoulPurpose(params.purpose) ?? existing.purpose;
  const bornAtIso =
    normalizeIsoTimestamp(params.bornAtIso) ?? existing.bornAtIso ?? new Date().toISOString();
  const block = buildFamilySoulBlock({
    info,
    bornAtIso,
    purpose,
    isNewborn: params.isNewborn === true,
  });
  const next = upsertFamilySoulBlock(current, block);
  const updated = next !== current;
  if (updated) {
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.writeFile(soulPath, next, "utf-8");
  }
  return { soulPath, info, purpose, bornAtIso, updated };
}
