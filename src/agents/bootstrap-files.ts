import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import { parseTopicSessionKey } from "../topics/session-key.js";
import { resolveTopicBaseDir } from "../topics/summary-chain.js";
import { applyBootstrapHookOverrides } from "./bootstrap-hooks.js";
import type { EmbeddedContextFile } from "./pi-embedded-helpers.js";
import {
  buildBootstrapContextFiles,
  resolveBootstrapMaxChars,
  resolveBootstrapTotalMaxChars,
} from "./pi-embedded-helpers.js";
import {
  DEFAULT_SOUL_FILENAME,
  filterBootstrapFilesForSession,
  loadWorkspaceBootstrapFiles,
  type WorkspaceBootstrapFile,
} from "./workspace.js";

export function makeBootstrapWarn(params: {
  sessionLabel: string;
  warn?: (message: string) => void;
}): ((message: string) => void) | undefined {
  if (!params.warn) {
    return undefined;
  }
  return (message: string) => params.warn?.(`${message} (sessionKey=${params.sessionLabel})`);
}

export async function resolveBootstrapFilesForRun(params: {
  workspaceDir: string;
  config?: OpenClawConfig;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
}): Promise<WorkspaceBootstrapFile[]> {
  const sessionKey = params.sessionKey ?? params.sessionId;
  const bootstrapFiles = filterBootstrapFilesForSession(
    await loadWorkspaceBootstrapFiles(params.workspaceDir),
    sessionKey,
  );

  const withHooks = await applyBootstrapHookOverrides({
    files: bootstrapFiles,
    workspaceDir: params.workspaceDir,
    config: params.config,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    agentId: params.agentId,
  });

  const topic = parseTopicSessionKey(sessionKey);
  if (!topic) {
    return withHooks;
  }

  const topicSoulPath = path.join(
    resolveTopicBaseDir(params.workspaceDir, topic.topicSlug),
    DEFAULT_SOUL_FILENAME,
  );
  try {
    const content = await fs.readFile(topicSoulPath, "utf-8");
    const exists = withHooks.some(
      (entry) => path.resolve(entry.path) === path.resolve(topicSoulPath),
    );
    if (exists) {
      return withHooks;
    }
    return [
      ...withHooks,
      {
        name: DEFAULT_SOUL_FILENAME,
        path: topicSoulPath,
        content,
        missing: false,
      },
    ];
  } catch {
    return withHooks;
  }
}

export async function resolveBootstrapContextForRun(params: {
  workspaceDir: string;
  config?: OpenClawConfig;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
  warn?: (message: string) => void;
}): Promise<{
  bootstrapFiles: WorkspaceBootstrapFile[];
  contextFiles: EmbeddedContextFile[];
}> {
  const bootstrapFiles = await resolveBootstrapFilesForRun(params);
  const contextFiles = buildBootstrapContextFiles(bootstrapFiles, {
    maxChars: resolveBootstrapMaxChars(params.config),
    totalMaxChars: resolveBootstrapTotalMaxChars(params.config),
    warn: params.warn,
  });
  return { bootstrapFiles, contextFiles };
}
