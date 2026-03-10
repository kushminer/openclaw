import { updateSessionStoreEntry, type SessionEntry } from "../../config/sessions.js";
import { logVerbose } from "../../globals.js";
import { enqueueSystemEvent } from "../../infra/system-events.js";
import { normalizeMainKey } from "../../routing/session-key.js";
import { parseAgentSessionKey } from "../../sessions/session-key-utils.js";
import { maybeIngestTopicSyncToMother } from "../../topics/branch-sync.js";
import { parseTopicSessionKey } from "../../topics/session-key.js";
import {
  shouldRunTopicDailySync,
  writeTopicSummaryLayer,
  type TopicSummaryLayerResult,
} from "../../topics/summary-chain.js";
import type { ReplyPayload } from "../types.js";

function extractAssistantOutput(payloads: ReplyPayload[]): string {
  const parts = payloads
    .filter((payload) => !payload.isError && typeof payload.text === "string")
    .map((payload) => payload.text?.trim() ?? "")
    .filter(Boolean);
  return parts.join("\n\n").trim();
}

function buildTopicSyncPatch(result: TopicSummaryLayerResult) {
  return {
    topicLastSummarySyncAt: result.syncedAt,
    topicLatestSummaryPath: result.summaryPath,
    topicLatestRawPath: result.rawPath,
    topicLatestSummaryLayer: result.layer,
  } satisfies Partial<SessionEntry>;
}

function isMotherSessionKey(sessionKey: string, mainKey?: string): boolean {
  const parsed = parseAgentSessionKey(sessionKey);
  if (!parsed) {
    return false;
  }
  return parsed.rest.trim().toLowerCase() === normalizeMainKey(mainKey);
}

export async function maybeRunTopicDailySummarySync(params: {
  sessionKey?: string;
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  storePath?: string;
  mainKey?: string;
  workspaceDir: string;
  sessionId?: string;
  userInput: string;
  replyPayloads: ReplyPayload[];
  isHeartbeat: boolean;
  nowMs?: number;
}): Promise<SessionEntry | undefined> {
  const sessionKey = params.sessionKey?.trim();
  if (!sessionKey) {
    return params.sessionEntry;
  }
  const activeEntry = params.sessionEntry ?? params.sessionStore?.[sessionKey];
  const nowMs = Number.isFinite(params.nowMs) ? Number(params.nowMs) : Date.now();

  if (isMotherSessionKey(sessionKey, params.mainKey)) {
    try {
      const motherSync = await maybeIngestTopicSyncToMother({
        workspaceDir: params.workspaceDir,
        nowMs,
        force: params.isHeartbeat,
      });
      if (motherSync.newConflicts > 0) {
        enqueueSystemEvent(
          `Topic sync queue updated: ${motherSync.newConflicts} new child updates pending review. Run "openclaw topic conflicts list".`,
          { sessionKey },
        );
      }
    } catch (err) {
      logVerbose(`topic mother sync failed: ${String(err)}`);
    }
    return activeEntry;
  }

  if (params.isHeartbeat) {
    return activeEntry;
  }

  const topic = parseTopicSessionKey(sessionKey);
  if (!topic) {
    return activeEntry;
  }

  if (
    !shouldRunTopicDailySync({
      lastSyncedAt: activeEntry?.topicLastSummarySyncAt,
      nowMs,
    })
  ) {
    return activeEntry;
  }

  const assistantOutput = extractAssistantOutput(params.replyPayloads);
  if (!assistantOutput && !params.userInput.trim()) {
    return activeEntry;
  }

  try {
    const result = await writeTopicSummaryLayer({
      workspaceDir: params.workspaceDir,
      sessionKey,
      sessionId: params.sessionId,
      userInput: params.userInput,
      assistantOutput,
      nowMs,
    });
    if (!result) {
      return activeEntry;
    }

    const patch = buildTopicSyncPatch(result);
    const merged = activeEntry ? { ...activeEntry, ...patch } : undefined;
    if (params.sessionStore && merged) {
      params.sessionStore[sessionKey] = merged;
    }
    if (params.storePath) {
      const persisted = await updateSessionStoreEntry({
        storePath: params.storePath,
        sessionKey,
        update: async () => patch,
      });
      if (persisted) {
        enqueueSystemEvent(
          `Topic daily sync: ${topic.topicSlug} -> layer ${result.layer} (24h cadence)`,
          { sessionKey },
        );
        return persisted;
      }
    } else {
      enqueueSystemEvent(
        `Topic daily sync: ${topic.topicSlug} -> layer ${result.layer} (24h cadence)`,
        {
          sessionKey,
        },
      );
    }
    return merged;
  } catch (err) {
    logVerbose(`topic daily sync failed: ${String(err)}`);
    return activeEntry;
  }
}
