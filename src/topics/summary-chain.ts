import fs from "node:fs/promises";
import path from "node:path";
import { parseTopicSessionKey } from "./session-key.js";

export const TOPIC_MEMORY_ROOT = path.join("memory", "topics");
export const MASTER_SUMMARY_FILE = path.join(TOPIC_MEMORY_ROOT, "MASTER_SUMMARIES.md");
export const STATE_FILENAME = "state.json";
export const TOPIC_SYNC_LOG_FILENAME = ".sync-log.jsonl";
export const TOPIC_SYNC_ARCHIVE_FILENAME = ".sync-log.archive.jsonl";
export const TOPIC_MOTHER_ID = "mother";
export const TOPIC_MOTHER_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const TOPIC_STATE_SCHEMA_VERSION = 1;
export const TOPIC_PURPOSE_MAX_CHARS = 500;
export const TOPIC_IDENTITY_NAME_MAX_CHARS = 120;
export const TOPIC_PERSONALITY_MAX_CHARS = 600;

export const TOPIC_DAILY_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type TopicSyncState = {
  nextSeq?: number;
  motherCursorSeq?: number;
  lastMotherReadAt?: number;
};

export type TopicLayerState = {
  schemaVersion?: number;
  parentId?: string;
  purpose?: string;
  identityName?: string;
  personality?: string;
  lastLayer: number;
  lastSyncedAt?: number;
  latestSummaryPath?: string;
  latestRawPath?: string;
  sync?: TopicSyncState;
};

export type TopicSyncLogKind = "decision" | "milestone" | "blocker";

export type TopicSyncLogEntry = {
  seq: number;
  ts: number;
  topicSlug: string;
  sessionKey: string;
  layer: number;
  kind: TopicSyncLogKind;
  summary: string;
  files: string[];
  summaryPath: string;
  rawPath: string;
};

export type TopicSummaryLayerResult = {
  topicSlug: string;
  layer: number;
  syncedAt: number;
  summaryPath: string;
  rawPath: string;
  masterSummaryPath: string;
  syncLogEntry?: TopicSyncLogEntry;
};

export function shouldRunTopicDailySync(params: {
  lastSyncedAt?: number;
  nowMs?: number;
  intervalMs?: number;
}): boolean {
  const nowMs = Number.isFinite(params.nowMs) ? Number(params.nowMs) : Date.now();
  const intervalMs =
    typeof params.intervalMs === "number" && Number.isFinite(params.intervalMs)
      ? Math.max(1, Math.floor(params.intervalMs))
      : TOPIC_DAILY_SYNC_INTERVAL_MS;
  if (typeof params.lastSyncedAt !== "number" || !Number.isFinite(params.lastSyncedAt)) {
    return true;
  }
  return nowMs - params.lastSyncedAt >= intervalMs;
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

function toFileStamp(nowMs: number): string {
  return new Date(nowMs).toISOString().replaceAll(":", "-");
}

function truncateText(raw: string, maxChars: number): string {
  const text = raw.trim();
  if (!text) {
    return "";
  }
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(1, maxChars - 15)).trimEnd()}\n...[truncated]...`;
}

function firstUsefulLine(raw: string, fallback = "No summary text captured."): string {
  const line = raw
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  return line ?? fallback;
}

export function normalizeTopicPurpose(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, TOPIC_PURPOSE_MAX_CHARS);
}

export function normalizeTopicIdentityName(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, TOPIC_IDENTITY_NAME_MAX_CHARS);
}

export function normalizeTopicPersonality(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, TOPIC_PERSONALITY_MAX_CHARS);
}

function normalizeSyncState(raw: unknown): TopicSyncState | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const parsed = raw as TopicSyncState;
  const nextSeq =
    typeof parsed.nextSeq === "number" && Number.isFinite(parsed.nextSeq)
      ? Math.max(1, Math.floor(parsed.nextSeq))
      : undefined;
  const motherCursorSeq =
    typeof parsed.motherCursorSeq === "number" && Number.isFinite(parsed.motherCursorSeq)
      ? Math.max(0, Math.floor(parsed.motherCursorSeq))
      : undefined;
  const lastMotherReadAt =
    typeof parsed.lastMotherReadAt === "number" && Number.isFinite(parsed.lastMotherReadAt)
      ? parsed.lastMotherReadAt
      : undefined;
  if (nextSeq === undefined && motherCursorSeq === undefined && lastMotherReadAt === undefined) {
    return undefined;
  }
  return { nextSeq, motherCursorSeq, lastMotherReadAt };
}

export function resolveTopicBaseDir(workspaceDir: string, topicSlug: string): string {
  return path.join(workspaceDir, TOPIC_MEMORY_ROOT, topicSlug);
}

export function resolveTopicStatePath(workspaceDir: string, topicSlug: string): string {
  return path.join(resolveTopicBaseDir(workspaceDir, topicSlug), STATE_FILENAME);
}

export async function readTopicLayerState(statePath: string): Promise<TopicLayerState> {
  try {
    const raw = await fs.readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw) as TopicLayerState;
    if (!parsed || typeof parsed !== "object") {
      return { lastLayer: 0 };
    }
    return {
      lastLayer:
        typeof parsed.lastLayer === "number" && Number.isFinite(parsed.lastLayer)
          ? Math.max(0, Math.floor(parsed.lastLayer))
          : 0,
      lastSyncedAt:
        typeof parsed.lastSyncedAt === "number" && Number.isFinite(parsed.lastSyncedAt)
          ? parsed.lastSyncedAt
          : undefined,
      latestSummaryPath:
        typeof parsed.latestSummaryPath === "string" ? parsed.latestSummaryPath : undefined,
      latestRawPath: typeof parsed.latestRawPath === "string" ? parsed.latestRawPath : undefined,
      schemaVersion:
        typeof parsed.schemaVersion === "number" && Number.isFinite(parsed.schemaVersion)
          ? Math.max(1, Math.floor(parsed.schemaVersion))
          : undefined,
      parentId:
        typeof parsed.parentId === "string"
          ? parsed.parentId.trim().toLowerCase() || undefined
          : undefined,
      purpose: normalizeTopicPurpose(parsed.purpose),
      identityName: normalizeTopicIdentityName(parsed.identityName),
      personality: normalizeTopicPersonality(parsed.personality),
      sync: normalizeSyncState(parsed.sync),
    };
  } catch {
    return { lastLayer: 0 };
  }
}

export async function writeTopicLayerState(
  statePath: string,
  state: TopicLayerState,
): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

function classifyTopicSyncKind(text: string): TopicSyncLogKind {
  if (/(?:error|fail(?:ed|ure)?|cannot|can't|blocked|issue|problem|exception)/i.test(text)) {
    return "blocker";
  }
  if (/(?:decid|agree|chose|choose|set|updated?|added?|removed?|moved?|plan|will)/i.test(text)) {
    return "decision";
  }
  return "milestone";
}

async function appendTopicSyncLog(params: {
  topicBaseDir: string;
  entry: TopicSyncLogEntry;
}): Promise<void> {
  const logPath = path.join(params.topicBaseDir, TOPIC_SYNC_LOG_FILENAME);
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, `${JSON.stringify(params.entry)}\n`, "utf-8");
}

async function writeMasterSummaryBlock(params: {
  workspaceDir: string;
  topicSlug: string;
  syncedAt: number;
  layer: number;
  summaryPath: string;
  rawPath: string;
  summaryLine: string;
  previousSummaryPath?: string;
}): Promise<void> {
  const masterPath = path.join(params.workspaceDir, MASTER_SUMMARY_FILE);
  await fs.mkdir(path.dirname(masterPath), { recursive: true });
  let needsHeader = false;
  try {
    await fs.access(masterPath);
  } catch {
    needsHeader = true;
  }

  const block = [
    `## ${new Date(params.syncedAt).toISOString()} - ${params.topicSlug} (L${params.layer})`,
    `- summary: ${params.summaryLine}`,
    `- layer_file: \`${params.summaryPath}\``,
    `- raw_file: \`${params.rawPath}\``,
    `- previous_layer: ${params.previousSummaryPath ? `\`${params.previousSummaryPath}\`` : "none"}`,
    "",
  ].join("\n");
  const prefix = needsHeader ? "# Topic Summaries\n\n" : "";
  await fs.appendFile(masterPath, `${prefix}${block}`, "utf-8");
}

export async function writeTopicSummaryLayer(params: {
  workspaceDir: string;
  sessionKey: string;
  sessionId?: string;
  userInput?: string;
  assistantOutput?: string;
  nowMs?: number;
}): Promise<TopicSummaryLayerResult | null> {
  const parsed = parseTopicSessionKey(params.sessionKey);
  if (!parsed) {
    return null;
  }

  const nowMs = Number.isFinite(params.nowMs) ? Number(params.nowMs) : Date.now();
  const syncedAtIso = new Date(nowMs).toISOString();
  const stamp = toFileStamp(nowMs);
  const topicBaseDir = resolveTopicBaseDir(params.workspaceDir, parsed.topicSlug);
  const rawDir = path.join(topicBaseDir, "raw");
  const layerDir = path.join(topicBaseDir, "layers");
  const latestPath = path.join(topicBaseDir, "LATEST.md");
  const statePath = path.join(topicBaseDir, STATE_FILENAME);
  await fs.mkdir(rawDir, { recursive: true });
  await fs.mkdir(layerDir, { recursive: true });

  const state = await readTopicLayerState(statePath);
  const nextLayer = state.lastLayer + 1;
  const rawFileName = `${stamp}.md`;
  const summaryFileName = `${stamp}-L${nextLayer}.md`;
  const rawAbsPath = path.join(rawDir, rawFileName);
  const summaryAbsPath = path.join(layerDir, summaryFileName);
  const rawRelPath = toPosixPath(path.relative(params.workspaceDir, rawAbsPath));
  const summaryRelPath = toPosixPath(path.relative(params.workspaceDir, summaryAbsPath));
  const summaryDirRel = path.posix.dirname(summaryRelPath);
  const previousSummaryRel = state.latestSummaryPath?.trim() || undefined;
  const previousLayerLink = previousSummaryRel
    ? toPosixPath(path.posix.relative(summaryDirRel, previousSummaryRel))
    : undefined;
  const rawLinkFromSummary = toPosixPath(path.posix.relative(summaryDirRel, rawRelPath));
  const summaryInput = truncateText(params.userInput ?? "", 3_000);
  const summaryOutput = truncateText(params.assistantOutput ?? "", 5_000);
  const summaryLine = firstUsefulLine(summaryOutput || summaryInput);

  const rawBody = [
    "---",
    "kind: topic-raw",
    `topic: ${parsed.topicSlug}`,
    `session_key: ${parsed.rootSessionKey}`,
    `session_id: ${params.sessionId ?? "unknown"}`,
    `captured_at: ${syncedAtIso}`,
    `layer: ${nextLayer}`,
    "---",
    "",
    "# Raw Topic Snapshot",
    "",
    "## User Input",
    summaryInput || "(empty)",
    "",
    "## Assistant Output",
    summaryOutput || "(empty)",
    "",
  ].join("\n");
  await fs.writeFile(rawAbsPath, rawBody, "utf-8");

  const summaryBody = [
    "---",
    "kind: topic-summary-layer",
    `topic: ${parsed.topicSlug}`,
    `layer: ${nextLayer}`,
    `created_at: ${syncedAtIso}`,
    `raw_snapshot: ${rawRelPath}`,
    `previous_summary: ${previousSummaryRel ?? "none"}`,
    "---",
    "",
    `# Topic Summary Layer L${nextLayer}`,
    "",
    `- summary: ${summaryLine}`,
    `- raw_snapshot: [${rawRelPath}](${rawLinkFromSummary})`,
    `- previous_layer: ${
      previousSummaryRel && previousLayerLink
        ? `[${previousSummaryRel}](${previousLayerLink})`
        : "none"
    }`,
    "",
    "## Notes",
    truncateText(summaryOutput || summaryInput, 2_000) || "(empty)",
    "",
  ].join("\n");
  await fs.writeFile(summaryAbsPath, summaryBody, "utf-8");

  const latestBody = [
    `# Topic ${parsed.topicSlug}`,
    "",
    `- latest_layer: L${nextLayer}`,
    `- latest_summary: \`${summaryRelPath}\``,
    `- latest_raw: \`${rawRelPath}\``,
    `- previous_summary: ${previousSummaryRel ? `\`${previousSummaryRel}\`` : "none"}`,
    `- synced_at: ${syncedAtIso}`,
    "",
  ].join("\n");
  await fs.writeFile(latestPath, latestBody, "utf-8");

  const nextState: TopicLayerState = {
    ...state,
    schemaVersion: Math.max(TOPIC_STATE_SCHEMA_VERSION, state.schemaVersion ?? 1),
    lastLayer: nextLayer,
    lastSyncedAt: nowMs,
    latestSummaryPath: summaryRelPath,
    latestRawPath: rawRelPath,
  };

  let syncLogEntry: TopicSyncLogEntry | undefined;
  if (state.parentId === TOPIC_MOTHER_ID) {
    const nextSeq = Math.max(1, state.sync?.nextSeq ?? 1);
    syncLogEntry = {
      seq: nextSeq,
      ts: nowMs,
      topicSlug: parsed.topicSlug,
      sessionKey: parsed.rootSessionKey,
      layer: nextLayer,
      kind: classifyTopicSyncKind(summaryOutput || summaryInput),
      summary: summaryLine,
      files: [summaryRelPath, rawRelPath],
      summaryPath: summaryRelPath,
      rawPath: rawRelPath,
    };
    await appendTopicSyncLog({ topicBaseDir, entry: syncLogEntry });
    nextState.sync = {
      ...nextState.sync,
      nextSeq: nextSeq + 1,
    };
  }
  await writeTopicLayerState(statePath, nextState);

  await writeMasterSummaryBlock({
    workspaceDir: params.workspaceDir,
    topicSlug: parsed.topicSlug,
    syncedAt: nowMs,
    layer: nextLayer,
    summaryPath: summaryRelPath,
    rawPath: rawRelPath,
    summaryLine,
    previousSummaryPath: previousSummaryRel,
  });

  return {
    topicSlug: parsed.topicSlug,
    layer: nextLayer,
    syncedAt: nowMs,
    summaryPath: summaryRelPath,
    rawPath: rawRelPath,
    masterSummaryPath: toPosixPath(MASTER_SUMMARY_FILE),
    syncLogEntry,
  };
}
