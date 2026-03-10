import crypto from "node:crypto";
import { cancel, isCancel, text } from "@clack/prompts";
import type { Command } from "commander";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { readSessionMessages } from "../auto-reply/reply/post-compaction-audit.js";
import { loadConfig } from "../config/config.js";
import {
  loadSessionStore,
  resolveSessionFilePath,
  resolveSessionFilePathOptions,
  resolveStorePath,
  type SessionEntry,
  updateSessionStore,
} from "../config/sessions.js";
import { callGateway } from "../gateway/call.js";
import { formatTimeAgo } from "../infra/format-time/format-relative.ts";
import { normalizeAgentId } from "../routing/session-key.js";
import { defaultRuntime } from "../runtime.js";
import { isRich, theme } from "../terminal/theme.js";
import {
  linkTopicToMother,
  listTopicConflictRecords,
  resolveTopicConflictRecord,
  TOPIC_MOTHER_ID,
  type TopicConflictRecord,
} from "../topics/branch-sync.js";
import {
  buildTopicSessionKey,
  formatTopicDisplayName,
  normalizeTopicSlug,
  parseTopicSessionKey,
} from "../topics/session-key.js";
import {
  normalizeTopicIdentityName,
  normalizeTopicPersonality,
  normalizeTopicPurpose,
  shouldRunTopicDailySync,
  writeTopicSummaryLayer,
  type TopicSummaryLayerResult,
} from "../topics/summary-chain.js";
import { runTui } from "../tui/tui.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";
import { buildSpawnedCliCommand, launchCommandInTerminal } from "./terminal-launch.js";

type TopicRow = {
  topicSlug: string;
  displayName: string;
  key: string;
  updatedAt?: number;
  lastSyncAt?: number;
  layer?: number;
};

type ConflictRow = {
  id: string;
  topicSlug: string;
  status: TopicConflictRecord["status"];
  kind: TopicConflictRecord["kind"];
  updatedAt: number;
  summary: string;
};

const TOPIC_KEY_PAD = 24;
const TOPIC_SESSION_PAD = 30;
const TOPIC_AGE_PAD = 12;
const TOPIC_SYNC_PAD = 12;
const CONFLICT_ID_PAD = 28;
const CONFLICT_TOPIC_PAD = 24;
const CONFLICT_STATUS_PAD = 10;
const CONFLICT_KIND_PAD = 10;
const CONFLICT_AGE_PAD = 12;

function renderTopicRows(rows: TopicRow[]): void {
  if (rows.length === 0) {
    defaultRuntime.log("No topic sessions found.");
    return;
  }
  const rich = isRich();
  const header = [
    "Topic".padEnd(TOPIC_KEY_PAD),
    "Session".padEnd(TOPIC_SESSION_PAD),
    "Updated".padEnd(TOPIC_AGE_PAD),
    "Synced".padEnd(TOPIC_SYNC_PAD),
    "Layer",
  ].join(" ");
  defaultRuntime.log(rich ? theme.heading(header) : header);

  for (const row of rows) {
    const updated = row.updatedAt ? formatTimeAgo(Date.now() - row.updatedAt) : "unknown";
    const synced = row.lastSyncAt ? formatTimeAgo(Date.now() - row.lastSyncAt) : "-";
    const line = [
      row.displayName.padEnd(TOPIC_KEY_PAD),
      row.key.padEnd(TOPIC_SESSION_PAD),
      updated.padEnd(TOPIC_AGE_PAD),
      synced.padEnd(TOPIC_SYNC_PAD),
      String(row.layer ?? "-"),
    ].join(" ");
    defaultRuntime.log(line.trimEnd());
  }
}

function toConflictRows(records: TopicConflictRecord[]): ConflictRow[] {
  return records.map((record) => ({
    id: record.id,
    topicSlug: record.topicSlug,
    status: record.status,
    kind: record.kind,
    updatedAt: record.updatedAt,
    summary: record.summary.replaceAll(/\s+/g, " ").trim() || "(empty)",
  }));
}

function renderConflictRows(rows: ConflictRow[]): void {
  if (rows.length === 0) {
    defaultRuntime.log("No topic conflicts found.");
    return;
  }
  const rich = isRich();
  const header = [
    "ID".padEnd(CONFLICT_ID_PAD),
    "Topic".padEnd(CONFLICT_TOPIC_PAD),
    "Status".padEnd(CONFLICT_STATUS_PAD),
    "Kind".padEnd(CONFLICT_KIND_PAD),
    "Updated".padEnd(CONFLICT_AGE_PAD),
    "Summary",
  ].join(" ");
  defaultRuntime.log(rich ? theme.heading(header) : header);
  for (const row of rows) {
    const updated = formatTimeAgo(Date.now() - row.updatedAt);
    const line = [
      row.id.padEnd(CONFLICT_ID_PAD),
      row.topicSlug.padEnd(CONFLICT_TOPIC_PAD),
      row.status.padEnd(CONFLICT_STATUS_PAD),
      row.kind.padEnd(CONFLICT_KIND_PAD),
      updated.padEnd(CONFLICT_AGE_PAD),
      row.summary,
    ].join(" ");
    defaultRuntime.log(line.trimEnd());
  }
}

function parseParentOption(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed !== TOPIC_MOTHER_ID) {
    throw new Error(`Unsupported parent "${raw}". Only "${TOPIC_MOTHER_ID}" is supported.`);
  }
  return trimmed;
}

function parsePurposeOption(raw: unknown): string | undefined {
  return normalizeTopicPurpose(raw);
}

function parseIdentityNameOption(raw: unknown): string | undefined {
  return normalizeTopicIdentityName(raw);
}

function parsePersonalityOption(raw: unknown): string | undefined {
  return normalizeTopicPersonality(raw);
}

function resolveTopicRows(params: {
  store: Record<string, SessionEntry>;
  agentId: string;
}): TopicRow[] {
  const rows: TopicRow[] = [];
  for (const [key, entry] of Object.entries(params.store)) {
    const parsed = parseTopicSessionKey(key);
    if (!parsed || parsed.agentId !== params.agentId) {
      continue;
    }
    if (key !== parsed.rootSessionKey) {
      continue;
    }
    rows.push({
      topicSlug: parsed.topicSlug,
      displayName: formatTopicDisplayName(parsed.topicSlug),
      key: parsed.rootSessionKey,
      updatedAt: entry.updatedAt,
      lastSyncAt: entry.topicLastSummarySyncAt,
      layer: entry.topicLatestSummaryLayer,
    });
  }
  return rows.toSorted((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

async function ensureTopicSessionEntry(params: {
  storePath: string;
  sessionKey: string;
  topicSlug: string;
}): Promise<SessionEntry | null> {
  return await updateSessionStore(
    params.storePath,
    (store) => {
      const existing = store[params.sessionKey];
      const now = Date.now();
      const next: SessionEntry = existing
        ? {
            ...existing,
            updatedAt: Math.max(existing.updatedAt ?? 0, now),
            label: existing.label ?? `topic:${params.topicSlug}`,
          }
        : {
            sessionId: crypto.randomUUID(),
            updatedAt: now,
            label: `topic:${params.topicSlug}`,
          };
      store[params.sessionKey] = next;
      return next;
    },
    { activeSessionKey: params.sessionKey },
  );
}

function buildTopicTuiCommand(params: {
  cwd: string;
  sessionKey: string;
  initialMessage?: string;
}): string {
  const args = ["tui", "--session", params.sessionKey];
  if (params.initialMessage?.trim()) {
    args.push("--message", params.initialMessage.trim());
  }
  return buildSpawnedCliCommand({ cwd: params.cwd, cliArgs: args });
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const textParts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const candidate = block as { type?: unknown; text?: unknown; content?: unknown };
    if (candidate.type === "text" && typeof candidate.text === "string") {
      textParts.push(candidate.text.trim());
      continue;
    }
    if (typeof candidate.content === "string") {
      textParts.push(candidate.content.trim());
    }
  }
  return textParts.filter(Boolean).join("\n").trim();
}

function readRecentTurnSummary(params: { sessionFile: string }): {
  userInput: string;
  assistantOutput: string;
} {
  const messages = readSessionMessages(params.sessionFile, 200);
  let userInput = "";
  let assistantOutput = "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    const role = typeof message.role === "string" ? message.role.toLowerCase() : "";
    const text = extractMessageText(message.content);
    if (!text) {
      continue;
    }
    if (!assistantOutput && role === "assistant") {
      assistantOutput = text;
      continue;
    }
    if (!userInput && role === "user") {
      userInput = text;
      continue;
    }
    if (userInput && assistantOutput) {
      break;
    }
  }
  return { userInput, assistantOutput };
}

async function runTopicSync(params: {
  storePath: string;
  workspaceDir: string;
  rows: TopicRow[];
  force: boolean;
}): Promise<Array<{ key: string; synced: boolean; result?: TopicSummaryLayerResult }>> {
  const results: Array<{ key: string; synced: boolean; result?: TopicSummaryLayerResult }> = [];
  for (const row of params.rows) {
    try {
      const store = loadSessionStore(params.storePath);
      const entry = store[row.key];
      if (!entry?.sessionId) {
        results.push({ key: row.key, synced: false });
        continue;
      }
      if (
        !params.force &&
        !shouldRunTopicDailySync({
          lastSyncedAt: entry.topicLastSummarySyncAt,
        })
      ) {
        results.push({ key: row.key, synced: false });
        continue;
      }

      const sessionFile = resolveSessionFilePath(
        entry.sessionId,
        entry,
        resolveSessionFilePathOptions({
          agentId: parseTopicSessionKey(row.key)?.agentId,
          storePath: params.storePath,
        }),
      );
      const recent = readRecentTurnSummary({ sessionFile });
      const syncResult = await writeTopicSummaryLayer({
        workspaceDir: params.workspaceDir,
        sessionKey: row.key,
        sessionId: entry.sessionId,
        userInput: recent.userInput || "Manual topic sync snapshot.",
        assistantOutput:
          recent.assistantOutput || "No assistant output found in recent transcript.",
      });
      if (!syncResult) {
        results.push({ key: row.key, synced: false });
        continue;
      }

      await updateSessionStore(
        params.storePath,
        (nextStore) => {
          const current = nextStore[row.key];
          if (!current) {
            return null;
          }
          const patch: Partial<SessionEntry> = {
            topicLastSummarySyncAt: syncResult.syncedAt,
            topicLatestSummaryPath: syncResult.summaryPath,
            topicLatestRawPath: syncResult.rawPath,
            topicLatestSummaryLayer: syncResult.layer,
            updatedAt: Date.now(),
          };
          nextStore[row.key] = { ...current, ...patch };
          return nextStore[row.key];
        },
        { activeSessionKey: row.key },
      );
      results.push({ key: row.key, synced: true, result: syncResult });
    } catch {
      results.push({ key: row.key, synced: false });
    }
  }
  return results;
}

export function registerTopicCli(program: Command) {
  const topic = program
    .command("topic [name]")
    .description("Manage persistent topic sessions and launch topic terminals")
    .option("--agent <id>", "Agent id (default: main)")
    .option("--parent <id>", `Optional parent id (currently only "${TOPIC_MOTHER_ID}")`)
    .option("--name <text>", "Optional child identity name")
    .option("--purpose <text>", "Optional child purpose to persist in topic context")
    .option("--personality <text>", "Optional child personality seed")
    .option(
      "--refresh-soul",
      "Rewrite topic SOUL.md from the current child template and inherited mother principles",
      false,
    )
    .option("--here", "Open topic in current terminal instead of creating a new terminal", false)
    .option("--message <text>", "Initial message to send when opening a topic terminal")
    .option("--json", "Output JSON", false)
    .action(async (name, opts) => {
      let topicName = typeof name === "string" ? name.trim() : "";
      if (!topicName) {
        const prompted = await text({ message: "Topic name" });
        if (isCancel(prompted)) {
          cancel("Topic launch cancelled.");
          return;
        }
        topicName = String(prompted ?? "").trim();
      }
      if (!topicName) {
        throw new Error("Topic name is required.");
      }

      const cfg = loadConfig();
      const agentId = normalizeAgentId(opts.agent as string | undefined);
      const topicSlug = normalizeTopicSlug(topicName);
      const sessionKey = buildTopicSessionKey({ topic: topicSlug, agentId });
      const storePath = resolveStorePath(cfg.session?.store, { agentId });
      const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
      const parentId = parseParentOption(opts.parent);
      const purpose = parsePurposeOption(opts.purpose);
      const identityName = parseIdentityNameOption(opts.name);
      const personality = parsePersonalityOption(opts.personality);
      const refreshSoul = opts.refreshSoul === true;
      await ensureTopicSessionEntry({ storePath, sessionKey, topicSlug });
      if (parentId === TOPIC_MOTHER_ID) {
        await linkTopicToMother({
          workspaceDir,
          topicSlug,
          purpose,
          identityName,
          personality,
          refreshSoul,
        });
      }
      const seededContext = [
        identityName ? `Name: ${identityName}` : "",
        purpose ? `Purpose: ${purpose}` : "",
        personality ? `Personality: ${personality}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const initialMessage =
        typeof opts.message === "string" ? opts.message : seededContext ? seededContext : undefined;

      if (opts.here === true) {
        await runTui({
          session: sessionKey,
          message: initialMessage,
        });
        return;
      }

      const launchCommand = buildTopicTuiCommand({
        cwd: process.cwd(),
        sessionKey,
        initialMessage,
      });
      const launched = await launchCommandInTerminal(launchCommand);
      if (opts.json === true) {
        defaultRuntime.log(
          JSON.stringify(
            {
              topic: topicSlug,
              parent: parentId,
              identityName,
              purpose,
              personality,
              refreshSoul,
              sessionKey,
              launched,
              command: launchCommand,
            },
            null,
            2,
          ),
        );
        return;
      }
      if (launched) {
        defaultRuntime.log(
          `Opened topic terminal: ${formatTopicDisplayName(topicSlug)} (${sessionKey})`,
        );
        return;
      }
      defaultRuntime.error("Failed to open a new terminal window automatically.");
      defaultRuntime.log(`Run this manually: ${launchCommand}`);
    });

  topic
    .command("list")
    .description("List topic sessions")
    .option("--agent <id>", "Agent id (default: main)")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      const cfg = loadConfig();
      const agentId = normalizeAgentId(opts.agent as string | undefined);
      const storePath = resolveStorePath(cfg.session?.store, { agentId });
      const store = loadSessionStore(storePath);
      const rows = resolveTopicRows({ store, agentId });
      if (opts.json === true) {
        defaultRuntime.log(
          JSON.stringify(
            {
              count: rows.length,
              storePath,
              topics: rows,
            },
            null,
            2,
          ),
        );
        return;
      }
      renderTopicRows(rows);
    });

  topic
    .command("link <name>")
    .description(`Link an existing topic to parent "${TOPIC_MOTHER_ID}"`)
    .option("--agent <id>", "Agent id (default: main)")
    .option("--parent <id>", `Parent id (required: "${TOPIC_MOTHER_ID}")`, TOPIC_MOTHER_ID)
    .option("--name <text>", "Optional child identity name")
    .option("--purpose <text>", "Optional child purpose to persist in topic context")
    .option("--personality <text>", "Optional child personality seed")
    .option(
      "--refresh-soul",
      "Rewrite topic SOUL.md from the current child template and inherited mother principles",
      false,
    )
    .option("--json", "Output JSON", false)
    .action(async (name, opts, command) => {
      const parentOpts = command.parent?.opts?.() as
        | {
            agent?: unknown;
            parent?: unknown;
            name?: unknown;
            purpose?: unknown;
            personality?: unknown;
            refreshSoul?: unknown;
            json?: unknown;
          }
        | undefined;
      const cfg = loadConfig();
      const agentId = normalizeAgentId((opts.agent ?? parentOpts?.agent) as string | undefined);
      const parentId = parseParentOption(opts.parent ?? parentOpts?.parent);
      if (parentId !== TOPIC_MOTHER_ID) {
        throw new Error(`--parent is required and must be "${TOPIC_MOTHER_ID}"`);
      }
      const topicSlug = normalizeTopicSlug(String(name ?? ""));
      const sessionKey = buildTopicSessionKey({ topic: topicSlug, agentId });
      const storePath = resolveStorePath(cfg.session?.store, { agentId });
      const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
      const identityName = parseIdentityNameOption(opts.name ?? parentOpts?.name);
      const purpose = parsePurposeOption(opts.purpose ?? parentOpts?.purpose);
      const personality = parsePersonalityOption(opts.personality ?? parentOpts?.personality);
      const refreshSoul = opts.refreshSoul === true || parentOpts?.refreshSoul === true;
      const asJson = opts.json === true || parentOpts?.json === true;
      await ensureTopicSessionEntry({ storePath, sessionKey, topicSlug });
      const linked = await linkTopicToMother({
        workspaceDir,
        topicSlug,
        purpose,
        identityName,
        personality,
        refreshSoul,
      });
      if (asJson) {
        defaultRuntime.log(
          JSON.stringify(
            {
              topic: topicSlug,
              parent: linked.parentId,
              identityName: linked.identityName,
              purpose: linked.purpose,
              personality: linked.personality,
              sessionKey,
              statePath: linked.statePath,
              soulPath: linked.soulPath,
              soulCreated: linked.soulCreated,
              soulRefreshed: linked.soulRefreshed,
              refreshSoul,
            },
            null,
            2,
          ),
        );
        return;
      }
      const statusFlags: string[] = [];
      if (linked.identityName || linked.purpose || linked.personality) {
        statusFlags.push("identity updated");
      }
      if (linked.soulRefreshed) {
        statusFlags.push("soul refreshed");
      }
      defaultRuntime.log(
        `Linked topic "${topicSlug}" to parent "${linked.parentId}"${
          statusFlags.length > 0 ? ` (${statusFlags.join(", ")})` : ""
        }.`,
      );
    });

  topic
    .command("close <name>")
    .description(
      "Close/reset a topic session (history remains archived when gateway reset succeeds)",
    )
    .option("--agent <id>", "Agent id (default: main)")
    .option("--json", "Output JSON", false)
    .action(async (name, opts) => {
      const cfg = loadConfig();
      const agentId = normalizeAgentId(opts.agent as string | undefined);
      const topicSlug = normalizeTopicSlug(String(name ?? ""));
      const sessionKey = buildTopicSessionKey({ topic: topicSlug, agentId });
      const storePath = resolveStorePath(cfg.session?.store, { agentId });

      let resetViaGateway = false;
      try {
        await callGateway({
          method: "sessions.reset",
          params: { key: sessionKey, reason: "reset" },
          timeoutMs: 15_000,
          clientName: GATEWAY_CLIENT_NAMES.CLI,
          mode: GATEWAY_CLIENT_MODES.CLI,
        });
        resetViaGateway = true;
      } catch {
        resetViaGateway = false;
      }

      if (!resetViaGateway) {
        await updateSessionStore(
          storePath,
          (store) => {
            const entry = store[sessionKey];
            if (!entry) {
              return null;
            }
            const now = Date.now();
            const next: SessionEntry = {
              ...entry,
              sessionId: crypto.randomUUID(),
              updatedAt: now,
              systemSent: false,
              abortedLastRun: false,
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              totalTokensFresh: true,
            };
            store[sessionKey] = next;
            return next;
          },
          { activeSessionKey: sessionKey },
        );
      }

      const payload = {
        topic: topicSlug,
        sessionKey,
        resetViaGateway,
      };
      if (opts.json === true) {
        defaultRuntime.log(JSON.stringify(payload, null, 2));
        return;
      }
      defaultRuntime.log(
        resetViaGateway
          ? `Closed topic "${topicSlug}" via gateway reset.`
          : `Closed topic "${topicSlug}" via local reset fallback.`,
      );
    });

  const conflicts = topic.command("conflicts").description("Manage mother-topic sync conflicts");

  conflicts
    .command("list")
    .option("--agent <id>", "Agent id (default: main)")
    .option("--status <status>", "Filter by status: pending|approved|rejected")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      const cfg = loadConfig();
      const agentId = normalizeAgentId(opts.agent as string | undefined);
      const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
      const rawStatus = typeof opts.status === "string" ? opts.status.trim().toLowerCase() : "";
      const status =
        rawStatus === "pending" || rawStatus === "approved" || rawStatus === "rejected"
          ? rawStatus
          : undefined;
      const records = await listTopicConflictRecords({ workspaceDir, status });
      if (opts.json === true) {
        defaultRuntime.log(
          JSON.stringify(
            {
              count: records.length,
              status: status ?? "all",
              conflicts: records,
            },
            null,
            2,
          ),
        );
        return;
      }
      renderConflictRows(toConflictRows(records));
    });

  conflicts
    .command("approve <id>")
    .option("--agent <id>", "Agent id (default: main)")
    .option("--json", "Output JSON", false)
    .action(async (id, opts) => {
      const cfg = loadConfig();
      const agentId = normalizeAgentId(opts.agent as string | undefined);
      const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
      const resolved = await resolveTopicConflictRecord({
        workspaceDir,
        id: String(id ?? ""),
        status: "approved",
      });
      if (!resolved) {
        throw new Error(`Conflict "${String(id ?? "")}" was not found.`);
      }
      if (opts.json === true) {
        defaultRuntime.log(JSON.stringify(resolved, null, 2));
        return;
      }
      defaultRuntime.log(`Approved topic conflict ${resolved.id}.`);
    });

  conflicts
    .command("reject <id>")
    .option("--agent <id>", "Agent id (default: main)")
    .option("--json", "Output JSON", false)
    .action(async (id, opts) => {
      const cfg = loadConfig();
      const agentId = normalizeAgentId(opts.agent as string | undefined);
      const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
      const resolved = await resolveTopicConflictRecord({
        workspaceDir,
        id: String(id ?? ""),
        status: "rejected",
      });
      if (!resolved) {
        throw new Error(`Conflict "${String(id ?? "")}" was not found.`);
      }
      if (opts.json === true) {
        defaultRuntime.log(JSON.stringify(resolved, null, 2));
        return;
      }
      defaultRuntime.log(`Rejected topic conflict ${resolved.id}.`);
    });

  topic
    .command("sync [name]")
    .description("Sync topic summaries into layered markdown notes (24h cadence by default)")
    .option("--agent <id>", "Agent id (default: main)")
    .option("--force", "Bypass 24h cadence and force sync", false)
    .option("--json", "Output JSON", false)
    .action(async (name, opts) => {
      const cfg = loadConfig();
      const agentId = normalizeAgentId(opts.agent as string | undefined);
      const storePath = resolveStorePath(cfg.session?.store, { agentId });
      const store = loadSessionStore(storePath);
      const rows = resolveTopicRows({ store, agentId });
      const targetSlug =
        typeof name === "string" && name.trim().length > 0 ? normalizeTopicSlug(name) : null;
      const targets = targetSlug ? rows.filter((row) => row.topicSlug === targetSlug) : rows;
      const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
      const syncResults = await runTopicSync({
        storePath,
        workspaceDir,
        rows: targets,
        force: Boolean(opts.force),
      });

      if (opts.json === true) {
        defaultRuntime.log(
          JSON.stringify(
            {
              count: syncResults.length,
              synced: syncResults.filter((entry) => entry.synced).length,
              results: syncResults,
            },
            null,
            2,
          ),
        );
        return;
      }

      const synced = syncResults.filter((entry) => entry.synced);
      if (synced.length === 0) {
        defaultRuntime.log("No topics required sync.");
        return;
      }
      for (const entry of synced) {
        const parsed = parseTopicSessionKey(entry.key);
        defaultRuntime.log(
          `Synced topic ${parsed?.topicSlug ?? entry.key} -> layer ${entry.result?.layer ?? "?"}`,
        );
      }
    });
}
