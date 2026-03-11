import path from "node:path";
import { withFileLock, type FileLockOptions } from "../infra/file-lock.js";
import type { AnyAgentTool } from "./pi-tools.types.js";
import { resolveSharedDir } from "./workspace.js";

const SHARED_MEMORY_DIRNAME = "memory";
const SHARED_MEMORY_FILE_NAMES = new Set(["MEMORY.md", "memory.md"]);

export const SHARED_FAMILY_MEMORY_LOCK_OPTIONS: FileLockOptions = {
  retries: {
    retries: 25,
    factor: 1.5,
    minTimeout: 20,
    maxTimeout: 500,
    randomize: true,
  },
  stale: 30_000,
};

function isPathInsideOrEqual(targetPath: string, parentPath: string): boolean {
  const relative = path.relative(parentPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveAbsolutePath(root: string, candidatePath: string): string {
  return path.isAbsolute(candidatePath)
    ? path.resolve(candidatePath)
    : path.resolve(path.join(root, candidatePath));
}

/**
 * Resolve a lock target only for shared family memory paths.
 * Returns null when the tool params are not targeting shared memory files.
 */
export function resolveSharedFamilyMemoryWriteTarget(params: {
  root: string;
  toolParams: unknown;
  sharedDir?: string;
}): string | null {
  if (!params.toolParams || typeof params.toolParams !== "object") {
    return null;
  }
  const record = params.toolParams as Record<string, unknown>;
  const rawPath = typeof record.path === "string" ? record.path.trim() : "";
  if (!rawPath) {
    return null;
  }

  const absolutePath = resolveAbsolutePath(params.root, rawPath);
  const sharedDir = path.resolve(params.sharedDir ?? resolveSharedDir());
  if (!isPathInsideOrEqual(absolutePath, sharedDir)) {
    return null;
  }

  const baseName = path.basename(absolutePath);
  if (SHARED_MEMORY_FILE_NAMES.has(baseName)) {
    return absolutePath;
  }

  const sharedMemoryDir = path.join(sharedDir, SHARED_MEMORY_DIRNAME);
  if (isPathInsideOrEqual(absolutePath, sharedMemoryDir)) {
    return absolutePath;
  }

  return null;
}

/**
 * Wrap write/edit tools so shared family memory writes are serialized
 * across sibling agents and processes.
 */
export function wrapToolWithSharedFamilyMemoryWriteLock(
  tool: AnyAgentTool,
  params: {
    root: string;
    sharedDir?: string;
    lockOptions?: FileLockOptions;
  },
): AnyAgentTool {
  if (tool.name !== "write" && tool.name !== "edit") {
    return tool;
  }

  const lockOptions = params.lockOptions ?? SHARED_FAMILY_MEMORY_LOCK_OPTIONS;
  return {
    ...tool,
    execute: async (toolCallId, toolParams, signal, onUpdate) => {
      const lockTarget = resolveSharedFamilyMemoryWriteTarget({
        root: params.root,
        toolParams,
        sharedDir: params.sharedDir,
      });

      if (!lockTarget) {
        return await tool.execute(toolCallId, toolParams, signal, onUpdate);
      }

      return await withFileLock(lockTarget, lockOptions, async () => {
        return await tool.execute(toolCallId, toolParams, signal, onUpdate);
      });
    },
  };
}
