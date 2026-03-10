import { describe, expect, it } from "vitest";
import {
  buildTopicRequestSessionKey,
  buildTopicSessionKey,
  formatTopicDisplayName,
  isTopicSessionKey,
  normalizeTopicSlug,
  parseTopicSessionKey,
} from "./session-key.js";

describe("topic session key helpers", () => {
  it("normalizes topic slugs", () => {
    expect(normalizeTopicSlug("  Startup Idea: Q1  ")).toBe("startup-idea-q1");
    expect(normalizeTopicSlug("___")).toBe("topic");
  });

  it("builds request and agent-prefixed topic keys", () => {
    expect(buildTopicRequestSessionKey("Supplements")).toBe("topic:supplements");
    expect(buildTopicSessionKey({ topic: "Supplements", agentId: "Ops" })).toBe(
      "agent:ops:topic:supplements",
    );
  });

  it("parses topic session keys and strips thread suffixes", () => {
    const parsed = parseTopicSessionKey("agent:main:topic:supplements:thread:abc");
    expect(parsed).toEqual({
      agentId: "main",
      topicSlug: "supplements",
      rootSessionKey: "agent:main:topic:supplements",
    });
  });

  it("detects topic session keys", () => {
    expect(isTopicSessionKey("agent:main:topic:startup")).toBe(true);
    expect(isTopicSessionKey("agent:main:main")).toBe(false);
  });

  it("formats display names", () => {
    expect(formatTopicDisplayName("supplements-and-routines")).toBe("Supplements And Routines");
  });
});
