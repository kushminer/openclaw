import fs from "node:fs/promises";
import path from "node:path";
import { formatTopicDisplayName, normalizeTopicSlug, parseTopicSessionKey } from "./session-key.js";
import {
  normalizeTopicIdentityName,
  normalizeTopicPersonality,
  normalizeTopicPurpose,
  resolveTopicBaseDir,
  resolveTopicStatePath,
  readTopicLayerState,
  shouldRunTopicDailySync,
  TOPIC_MEMORY_ROOT,
  TOPIC_MOTHER_ID,
  TOPIC_MOTHER_SYNC_INTERVAL_MS,
  TOPIC_STATE_SCHEMA_VERSION,
  TOPIC_SYNC_ARCHIVE_FILENAME,
  TOPIC_SYNC_LOG_FILENAME,
  writeTopicLayerState,
  type TopicLayerState,
  type TopicSyncLogEntry,
} from "./summary-chain.js";

export { TOPIC_MOTHER_ID } from "./summary-chain.js";

const TOPIC_SOUL_FILENAME = "SOUL.md";
const WORKSPACE_SOUL_FILENAME = "SOUL.md";
const TOPIC_CONFLICTS_FILENAME = "conflicts.json";
const MOTHER_APPROVED_FILE = "approved.md";
const MOTHER_REJECTED_FILE = "rejected.md";
const MOTHER_SOUL_INHERIT_SECTION_HEADINGS = [
  "Core Truths",
  "Boundaries",
  "Security & Trust",
  "Continuity",
] as const;

export type TopicConflictStatus = "pending" | "approved" | "rejected";

export type TopicConflictRecord = {
  id: string;
  topicSlug: string;
  seq: number;
  status: TopicConflictStatus;
  kind: TopicSyncLogEntry["kind"];
  summary: string;
  files: string[];
  summaryPath: string;
  rawPath: string;
  createdAt: number;
  updatedAt: number;
};

type TopicConflictStore = {
  version: number;
  records: TopicConflictRecord[];
};

export type TopicMotherSyncResult = {
  checkedAt: number;
  topicsVisited: number;
  topicsUpdated: number;
  processedEntries: number;
  newConflicts: number;
  pendingConflicts: number;
};

function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

function sanitizeSummary(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

function extractMarkdownSection(content: string, heading: string): string | undefined {
  const lines = content.split(/\r?\n/u);
  const target = `## ${heading}`.toLowerCase();
  const start = lines.findIndex((line) => line.trim().toLowerCase() === target);
  if (start < 0) {
    return undefined;
  }
  let end = lines.length;
  for (let idx = start + 1; idx < lines.length; idx += 1) {
    if (lines[idx] && /^##\s+/u.test(lines[idx].trim())) {
      end = idx;
      break;
    }
  }
  const section = lines.slice(start, end).join("\n").trim();
  return section || undefined;
}

function buildInheritedMotherSoulSections(content: string): string | undefined {
  const sections = MOTHER_SOUL_INHERIT_SECTION_HEADINGS.map((heading) =>
    extractMarkdownSection(content, heading),
  ).filter((section): section is string => Boolean(section?.trim()));
  if (sections.length === 0) {
    return undefined;
  }
  return sections.join("\n\n");
}

async function loadInheritedMotherSoulSections(workspaceDir: string): Promise<string | undefined> {
  const motherSoulPath = path.join(workspaceDir, WORKSPACE_SOUL_FILENAME);
  const motherSoul = await fs.readFile(motherSoulPath, "utf-8").catch(() => "");
  const trimmed = motherSoul.trim();
  if (!trimmed) {
    return undefined;
  }
  return buildInheritedMotherSoulSections(trimmed);
}

function formatConflictDigest(record: TopicConflictRecord): string {
  const stamp = new Date(record.updatedAt).toISOString();
  const files = record.files.map((item) => `\`${item}\``).join(", ");
  return [
    `## ${stamp} - ${record.id}`,
    `- topic: ${record.topicSlug}`,
    `- status: ${record.status}`,
    `- kind: ${record.kind}`,
    `- summary: ${sanitizeSummary(record.summary)}`,
    `- summary_path: \`${record.summaryPath}\``,
    `- raw_path: \`${record.rawPath}\``,
    `- files: ${files || "none"}`,
    "",
  ].join("\n");
}

async function appendWithHeader(params: {
  filePath: string;
  header: string;
  body: string;
}): Promise<void> {
  await fs.mkdir(path.dirname(params.filePath), { recursive: true });
  let needsHeader = false;
  try {
    await fs.access(params.filePath);
  } catch {
    needsHeader = true;
  }
  const prefix = needsHeader ? `${params.header}\n\n` : "";
  await fs.appendFile(params.filePath, `${prefix}${params.body}`, "utf-8");
}

function buildTopicSoulTemplate(
  topicSlug: string,
  parentId: string,
  purpose?: string,
  identityName?: string,
  personality?: string,
  inheritedMotherSoulSections?: string,
): string {
  const displayName = formatTopicDisplayName(topicSlug) || topicSlug;
  const normalizedPurpose = normalizeTopicPurpose(purpose);
  const normalizedIdentityName = normalizeTopicIdentityName(identityName) ?? displayName;
  const normalizedPersonality = normalizeTopicPersonality(personality);
  return [
    "---",
    "kind: topic-soul",
    `topic: ${topicSlug}`,
    `parent: ${parentId}`,
    "---",
    "",
    `# Topic Soul: ${normalizedIdentityName}`,
    "",
    `You are the child topic soul for "${topicSlug}" (display name: ${displayName}).`,
    `Your parent topic is "${parentId}".`,
    "Identity rule: you are this topic child session, not the global default/main persona.",
    "Potential siblings: other child topics that share this same parent.",
    "Never claim to be mother or to be another sibling topic.",
    "If asked who you are, explicitly state your topic child identity and parent relationship.",
    normalizedPurpose
      ? `Primary purpose: ${normalizedPurpose}`
      : "Primary purpose: keep this topic focused and ask for a concrete purpose when unclear.",
    normalizedPersonality
      ? `Personality seed: ${normalizedPersonality}`
      : "Personality seed: develop a distinct voice for this topic while remaining aligned with user intent and safety.",
    "",
    "## Inherited Principles From Mother",
    "Carry forward these baseline principles from mother's SOUL.md unless explicitly revised here.",
    "",
    inheritedMotherSoulSections ??
      "Mother section snapshot unavailable; still inherit mother's trust, privacy, and safety commitments.",
    "Stay focused on this topic, keep durable notes concise, and sync key updates to mother when needed.",
    "",
  ].join("\n");
}

function createEmptyConflictStore(): TopicConflictStore {
  return { version: 1, records: [] };
}

function normalizeConflictStore(raw: unknown): TopicConflictStore {
  if (!raw || typeof raw !== "object") {
    return createEmptyConflictStore();
  }
  const parsed = raw as { version?: unknown; records?: unknown };
  const recordsInput = Array.isArray(parsed.records) ? parsed.records : [];
  const records: TopicConflictRecord[] = [];
  for (const item of recordsInput) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const rec = item as Partial<TopicConflictRecord>;
    const id = typeof rec.id === "string" ? rec.id.trim() : "";
    const topicSlug = typeof rec.topicSlug === "string" ? rec.topicSlug.trim() : "";
    const seq =
      typeof rec.seq === "number" && Number.isFinite(rec.seq)
        ? Math.max(1, Math.floor(rec.seq))
        : 0;
    const status =
      rec.status === "approved" || rec.status === "rejected" || rec.status === "pending"
        ? rec.status
        : "pending";
    const kind =
      rec.kind === "decision" || rec.kind === "milestone" || rec.kind === "blocker"
        ? rec.kind
        : "milestone";
    if (!id || !topicSlug || seq <= 0) {
      continue;
    }
    records.push({
      id,
      topicSlug,
      seq,
      status,
      kind,
      summary: typeof rec.summary === "string" ? rec.summary : "",
      files: Array.isArray(rec.files)
        ? rec.files.filter((entry): entry is string => typeof entry === "string")
        : [],
      summaryPath: typeof rec.summaryPath === "string" ? rec.summaryPath : "",
      rawPath: typeof rec.rawPath === "string" ? rec.rawPath : "",
      createdAt:
        typeof rec.createdAt === "number" && Number.isFinite(rec.createdAt)
          ? rec.createdAt
          : Date.now(),
      updatedAt:
        typeof rec.updatedAt === "number" && Number.isFinite(rec.updatedAt)
          ? rec.updatedAt
          : Date.now(),
    });
  }
  const version =
    typeof parsed.version === "number" && Number.isFinite(parsed.version)
      ? Math.max(1, Math.floor(parsed.version))
      : 1;
  return { version, records };
}

function normalizeTopicSyncLogEntry(raw: unknown): TopicSyncLogEntry | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const entry = raw as Partial<TopicSyncLogEntry>;
  const seq =
    typeof entry.seq === "number" && Number.isFinite(entry.seq)
      ? Math.max(1, Math.floor(entry.seq))
      : 0;
  if (seq <= 0) {
    return null;
  }
  const kind =
    entry.kind === "decision" || entry.kind === "milestone" || entry.kind === "blocker"
      ? entry.kind
      : "milestone";
  const files = Array.isArray(entry.files)
    ? entry.files.filter((item): item is string => typeof item === "string")
    : [];
  return {
    seq,
    ts: typeof entry.ts === "number" && Number.isFinite(entry.ts) ? entry.ts : Date.now(),
    topicSlug: typeof entry.topicSlug === "string" ? entry.topicSlug : "",
    sessionKey: typeof entry.sessionKey === "string" ? entry.sessionKey : "",
    layer:
      typeof entry.layer === "number" && Number.isFinite(entry.layer)
        ? Math.max(1, Math.floor(entry.layer))
        : 1,
    kind,
    summary: typeof entry.summary === "string" ? entry.summary : "",
    files,
    summaryPath: typeof entry.summaryPath === "string" ? entry.summaryPath : (files[0] ?? ""),
    rawPath: typeof entry.rawPath === "string" ? entry.rawPath : (files[1] ?? ""),
  };
}

async function readTopicSyncLogEntries(logPath: string): Promise<TopicSyncLogEntry[]> {
  const raw = await fs.readFile(logPath, "utf-8").catch(() => "");
  if (!raw.trim()) {
    return [];
  }
  const entries: TopicSyncLogEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = normalizeTopicSyncLogEntry(JSON.parse(trimmed));
      if (parsed) {
        entries.push(parsed);
      }
    } catch {
      // Keep ingestion resilient to malformed lines.
    }
  }
  return entries.toSorted((a, b) => a.seq - b.seq || a.ts - b.ts);
}

async function readConflictStore(conflictsPath: string): Promise<TopicConflictStore> {
  const raw = await fs.readFile(conflictsPath, "utf-8").catch(() => "");
  if (!raw.trim()) {
    return createEmptyConflictStore();
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeConflictStore(parsed);
  } catch {
    return createEmptyConflictStore();
  }
}

async function writeConflictStore(conflictsPath: string, store: TopicConflictStore): Promise<void> {
  await fs.mkdir(path.dirname(conflictsPath), { recursive: true });
  await fs.writeFile(conflictsPath, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
}

function getConflictsPath(workspaceDir: string): string {
  return path.join(workspaceDir, TOPIC_MEMORY_ROOT, TOPIC_MOTHER_ID, TOPIC_CONFLICTS_FILENAME);
}

function buildConflictId(topicSlug: string, seq: number): string {
  return `${topicSlug}:${seq}`;
}

export function shouldRunTopicMotherSync(params: {
  lastReadAt?: number;
  nowMs?: number;
  intervalMs?: number;
}): boolean {
  return shouldRunTopicDailySync({
    lastSyncedAt: params.lastReadAt,
    nowMs: params.nowMs,
    intervalMs: params.intervalMs ?? TOPIC_MOTHER_SYNC_INTERVAL_MS,
  });
}

export async function ensureTopicSoulFile(params: {
  workspaceDir: string;
  topicSlug: string;
  parentId?: string;
  purpose?: string;
  identityName?: string;
  personality?: string;
  refresh?: boolean;
}): Promise<{ path: string; created: boolean }> {
  const topicSlug = normalizeTopicSlug(params.topicSlug);
  const topicDir = resolveTopicBaseDir(params.workspaceDir, topicSlug);
  const soulPath = path.join(topicDir, TOPIC_SOUL_FILENAME);
  const relativeSoulPath = toPosixPath(path.relative(params.workspaceDir, soulPath));
  await fs.mkdir(topicDir, { recursive: true });
  const inheritedMotherSoulSections = await loadInheritedMotherSoulSections(params.workspaceDir);
  const soulBody = buildTopicSoulTemplate(
    topicSlug,
    params.parentId?.trim() || TOPIC_MOTHER_ID,
    params.purpose,
    params.identityName,
    params.personality,
    inheritedMotherSoulSections,
  );

  if (params.refresh === true) {
    const existed = await fs
      .access(soulPath)
      .then(() => true)
      .catch(() => false);
    await fs.writeFile(soulPath, soulBody, "utf-8");
    return { path: relativeSoulPath, created: !existed };
  }

  try {
    await fs.writeFile(soulPath, soulBody, { encoding: "utf-8", flag: "wx" });
    return { path: relativeSoulPath, created: true };
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "EEXIST") {
      return { path: relativeSoulPath, created: false };
    }
    throw err;
  }
}

export async function linkTopicToMother(params: {
  workspaceDir: string;
  topicSlug: string;
  purpose?: string;
  identityName?: string;
  personality?: string;
  refreshSoul?: boolean;
}): Promise<{
  topicSlug: string;
  parentId: string;
  purpose?: string;
  identityName?: string;
  personality?: string;
  statePath: string;
  soulPath: string;
  soulCreated: boolean;
  soulRefreshed: boolean;
}> {
  const topicSlug = normalizeTopicSlug(params.topicSlug);
  const statePath = resolveTopicStatePath(params.workspaceDir, topicSlug);
  const existing = await readTopicLayerState(statePath);
  const purpose = normalizeTopicPurpose(params.purpose);
  const identityName = normalizeTopicIdentityName(params.identityName);
  const personality = normalizeTopicPersonality(params.personality);
  const nextState: TopicLayerState = {
    ...existing,
    schemaVersion: Math.max(TOPIC_STATE_SCHEMA_VERSION, existing.schemaVersion ?? 1),
    parentId: TOPIC_MOTHER_ID,
    purpose: purpose ?? existing.purpose,
    identityName: identityName ?? existing.identityName,
    personality: personality ?? existing.personality,
    sync: {
      ...existing.sync,
      nextSeq: Math.max(1, existing.sync?.nextSeq ?? 1),
    },
  };
  await writeTopicLayerState(statePath, nextState);
  const soul = await ensureTopicSoulFile({
    workspaceDir: params.workspaceDir,
    topicSlug,
    parentId: TOPIC_MOTHER_ID,
    purpose,
    identityName,
    personality,
    refresh: params.refreshSoul === true,
  });
  const soulRefreshed = params.refreshSoul === true && !soul.created;
  return {
    topicSlug,
    parentId: TOPIC_MOTHER_ID,
    purpose: nextState.purpose,
    identityName: nextState.identityName,
    personality: nextState.personality,
    statePath: toPosixPath(path.relative(params.workspaceDir, statePath)),
    soulPath: soul.path,
    soulCreated: soul.created,
    soulRefreshed,
  };
}

export async function readTopicParentId(params: {
  workspaceDir: string;
  topicSlug: string;
}): Promise<string | undefined> {
  const topicSlug = normalizeTopicSlug(params.topicSlug);
  const statePath = resolveTopicStatePath(params.workspaceDir, topicSlug);
  const state = await readTopicLayerState(statePath);
  return state.parentId;
}

async function listSiblingTopicSlugs(params: {
  workspaceDir: string;
  topicSlug: string;
  parentId: string;
}): Promise<string[]> {
  const root = path.join(params.workspaceDir, TOPIC_MEMORY_ROOT);
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const siblings: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      continue;
    }
    const siblingSlug = normalizeTopicSlug(entry.name);
    if (!siblingSlug || siblingSlug === TOPIC_MOTHER_ID || siblingSlug === params.topicSlug) {
      continue;
    }
    const siblingState = await readTopicLayerState(
      resolveTopicStatePath(params.workspaceDir, siblingSlug),
    );
    if (siblingState.parentId === params.parentId) {
      siblings.push(siblingSlug);
    }
  }
  return siblings.toSorted();
}

export async function buildTopicSessionWorkspaceNotes(params: {
  workspaceDir: string;
  sessionKey?: string;
}): Promise<string[] | undefined> {
  const parsed = parseTopicSessionKey(params.sessionKey);
  if (!parsed) {
    return undefined;
  }
  const statePath = resolveTopicStatePath(params.workspaceDir, parsed.topicSlug);
  const state = await readTopicLayerState(statePath);
  const parentId = state.parentId?.trim() || "none";
  const siblings =
    parentId === "none"
      ? []
      : await listSiblingTopicSlugs({
          workspaceDir: params.workspaceDir,
          topicSlug: parsed.topicSlug,
          parentId,
        });
  const identityName = state.identityName?.trim() || formatTopicDisplayName(parsed.topicSlug);
  const notes = [
    `Session key: ${parsed.rootSessionKey}`,
    `Topic scope: "${parsed.topicSlug}" (child session).`,
    `Child identity name: "${identityName}".`,
    `Parent topic: "${parentId}".`,
    `Sibling topics: ${siblings.length > 0 ? siblings.join(", ") : "none"}.`,
    "Identity rule: behave as this child topic session; do not claim to be the global/default main persona.",
    "Siblings rule: acknowledge sibling topics as peers under the same parent; do not impersonate them.",
  ];
  if (state.purpose) {
    notes.push(`Topic purpose: ${state.purpose}`);
  }
  if (state.personality) {
    notes.push(`Topic personality: ${state.personality}`);
  }
  return notes;
}

export async function maybeIngestTopicSyncToMother(params: {
  workspaceDir: string;
  nowMs?: number;
  force?: boolean;
  intervalMs?: number;
}): Promise<TopicMotherSyncResult> {
  const nowMs = Number.isFinite(params.nowMs) ? Number(params.nowMs) : Date.now();
  const topicsRoot = path.join(params.workspaceDir, TOPIC_MEMORY_ROOT);
  const topicDirs = await fs.readdir(topicsRoot, { withFileTypes: true }).catch(() => []);
  const conflictsPath = getConflictsPath(params.workspaceDir);
  const conflictStore = await readConflictStore(conflictsPath);
  const existingById = new Map(conflictStore.records.map((record) => [record.id, record]));

  let conflictsChanged = false;
  let topicsVisited = 0;
  let topicsUpdated = 0;
  let processedEntries = 0;
  let newConflicts = 0;

  for (const entry of topicDirs) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      continue;
    }
    const topicSlug = normalizeTopicSlug(entry.name);
    if (!topicSlug || topicSlug === TOPIC_MOTHER_ID) {
      continue;
    }
    const statePath = resolveTopicStatePath(params.workspaceDir, topicSlug);
    const state = await readTopicLayerState(statePath);
    if (state.parentId !== TOPIC_MOTHER_ID) {
      continue;
    }
    topicsVisited += 1;
    if (
      !params.force &&
      !shouldRunTopicMotherSync({
        lastReadAt: state.sync?.lastMotherReadAt,
        nowMs,
        intervalMs: params.intervalMs,
      })
    ) {
      continue;
    }

    const topicDir = resolveTopicBaseDir(params.workspaceDir, topicSlug);
    const logPath = path.join(topicDir, TOPIC_SYNC_LOG_FILENAME);
    const archivePath = path.join(topicDir, TOPIC_SYNC_ARCHIVE_FILENAME);
    const records = await readTopicSyncLogEntries(logPath);
    const cursor = Math.max(0, state.sync?.motherCursorSeq ?? 0);
    const unread = records.filter((record) => record.seq > cursor);

    if (unread.length > 0) {
      processedEntries += unread.length;
      const archiveLines = unread.map((record) => JSON.stringify(record)).join("\n");
      await appendWithHeader({
        filePath: archivePath,
        header: "# Topic Sync Archive",
        body: `${archiveLines}\n`,
      });
      for (const record of unread) {
        const id = buildConflictId(topicSlug, record.seq);
        if (existingById.has(id)) {
          continue;
        }
        const conflict: TopicConflictRecord = {
          id,
          topicSlug,
          seq: record.seq,
          status: "pending",
          kind: record.kind,
          summary: record.summary,
          files: record.files,
          summaryPath: record.summaryPath,
          rawPath: record.rawPath,
          createdAt: nowMs,
          updatedAt: nowMs,
        };
        conflictStore.records.push(conflict);
        existingById.set(id, conflict);
        conflictsChanged = true;
        newConflicts += 1;
      }
    }

    const nextState: TopicLayerState = {
      ...state,
      schemaVersion: Math.max(TOPIC_STATE_SCHEMA_VERSION, state.schemaVersion ?? 1),
      sync: {
        ...state.sync,
        motherCursorSeq: unread.length > 0 ? (unread[unread.length - 1]?.seq ?? cursor) : cursor,
        lastMotherReadAt: nowMs,
      },
    };
    await writeTopicLayerState(statePath, nextState);
    topicsUpdated += 1;
  }

  if (conflictsChanged) {
    await writeConflictStore(conflictsPath, conflictStore);
  }

  const pendingConflicts = conflictStore.records.filter(
    (record) => record.status === "pending",
  ).length;
  return {
    checkedAt: nowMs,
    topicsVisited,
    topicsUpdated,
    processedEntries,
    newConflicts,
    pendingConflicts,
  };
}

export async function listTopicConflictRecords(params: {
  workspaceDir: string;
  status?: TopicConflictStatus;
}): Promise<TopicConflictRecord[]> {
  const store = await readConflictStore(getConflictsPath(params.workspaceDir));
  const filtered =
    params.status &&
    (params.status === "pending" || params.status === "approved" || params.status === "rejected")
      ? store.records.filter((record) => record.status === params.status)
      : store.records;
  return filtered.toSorted((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

export async function resolveTopicConflictRecord(params: {
  workspaceDir: string;
  id: string;
  status: "approved" | "rejected";
  nowMs?: number;
}): Promise<TopicConflictRecord | null> {
  const id = params.id.trim();
  if (!id) {
    return null;
  }
  const nowMs = Number.isFinite(params.nowMs) ? Number(params.nowMs) : Date.now();
  const conflictsPath = getConflictsPath(params.workspaceDir);
  const store = await readConflictStore(conflictsPath);
  const index = store.records.findIndex((record) => record.id === id);
  if (index < 0) {
    return null;
  }
  const current = store.records[index];
  if (!current) {
    return null;
  }
  const next: TopicConflictRecord = {
    ...current,
    status: params.status,
    updatedAt: nowMs,
  };
  store.records[index] = next;
  await writeConflictStore(conflictsPath, store);

  if (current.status !== params.status) {
    const motherDir = path.join(params.workspaceDir, TOPIC_MEMORY_ROOT, TOPIC_MOTHER_ID);
    const target =
      params.status === "approved"
        ? path.join(motherDir, MOTHER_APPROVED_FILE)
        : path.join(motherDir, MOTHER_REJECTED_FILE);
    await appendWithHeader({
      filePath: target,
      header:
        params.status === "approved"
          ? "# Mother Approved Topic Syncs"
          : "# Mother Rejected Topic Syncs",
      body: formatConflictDigest(next),
    });
  }

  return next;
}
