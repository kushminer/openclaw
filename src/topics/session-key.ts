import { normalizeAgentId } from "../routing/session-key.js";
import { parseAgentSessionKey } from "../sessions/session-key-utils.js";

const INVALID_CHARS_RE = /[^a-z0-9_-]+/g;
const LEADING_SEPARATORS_RE = /^[-_]+/;
const TRAILING_SEPARATORS_RE = /[-_]+$/;
const MULTI_SEPARATOR_RE = /[-_]{2,}/g;

export const TOPIC_SEGMENT = "topic";
export const DEFAULT_TOPIC_SLUG = "topic";

export function normalizeTopicSlug(raw: string | undefined | null): string {
  const trimmed = (raw ?? "").trim().toLowerCase();
  if (!trimmed) {
    return DEFAULT_TOPIC_SLUG;
  }
  return (
    trimmed
      .replace(INVALID_CHARS_RE, "-")
      .replace(LEADING_SEPARATORS_RE, "")
      .replace(TRAILING_SEPARATORS_RE, "")
      .replace(MULTI_SEPARATOR_RE, "-")
      .slice(0, 64) || DEFAULT_TOPIC_SLUG
  );
}

export function buildTopicRequestSessionKey(topic: string): string {
  return `${TOPIC_SEGMENT}:${normalizeTopicSlug(topic)}`;
}

export function buildTopicSessionKey(params: { topic: string; agentId?: string | null }): string {
  const agentId = normalizeAgentId(params.agentId);
  return `agent:${agentId}:${buildTopicRequestSessionKey(params.topic)}`;
}

export function parseTopicSessionKey(
  sessionKey: string | undefined | null,
): { agentId: string; topicSlug: string; rootSessionKey: string } | null {
  const raw = (sessionKey ?? "").trim().toLowerCase();
  if (!raw) {
    return null;
  }

  const parsed = parseAgentSessionKey(raw);
  const agentId = normalizeAgentId(parsed?.agentId);
  const rest = parsed?.rest?.trim().toLowerCase() ?? raw;
  const parts = rest.split(":").filter(Boolean);
  const topicIdx = parts.indexOf(TOPIC_SEGMENT);
  if (topicIdx < 0 || topicIdx >= parts.length - 1) {
    return null;
  }

  const topicSlug = normalizeTopicSlug(parts[topicIdx + 1]);
  const rootParts = parts.slice(0, topicIdx + 2);
  const rootSessionKey = `agent:${agentId}:${rootParts.join(":")}`;
  return { agentId, topicSlug, rootSessionKey };
}

export function isTopicSessionKey(sessionKey: string | undefined | null): boolean {
  return parseTopicSessionKey(sessionKey) !== null;
}

export function formatTopicDisplayName(topicSlug: string): string {
  const normalized = normalizeTopicSlug(topicSlug);
  return normalized
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
