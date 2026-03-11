import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnyAgentTool } from "./pi-tools.types.js";

const { withFileLockMock } = vi.hoisted(() => ({
  withFileLockMock: vi.fn(
    async (_filePath: string, _options: unknown, fn: () => Promise<unknown>) => await fn(),
  ),
}));

vi.mock("../infra/file-lock.js", () => ({
  withFileLock: withFileLockMock,
}));

import {
  SHARED_FAMILY_MEMORY_LOCK_OPTIONS,
  resolveSharedFamilyMemoryWriteTarget,
  wrapToolWithSharedFamilyMemoryWriteLock,
} from "./shared-family-memory-write-lock.js";

describe("shared family memory write lock", () => {
  const sharedDir = path.resolve("/tmp/openclaw-shared");
  const workspaceDir = path.resolve("/tmp/openclaw-workspace");

  beforeEach(() => {
    withFileLockMock.mockClear();
  });

  it("detects shared MEMORY.md writes", () => {
    const target = resolveSharedFamilyMemoryWriteTarget({
      root: workspaceDir,
      sharedDir,
      toolParams: { path: path.join(sharedDir, "MEMORY.md"), content: "x" },
    });
    expect(target).toBe(path.join(sharedDir, "MEMORY.md"));
  });

  it("detects files inside shared memory directory", () => {
    const target = resolveSharedFamilyMemoryWriteTarget({
      root: workspaceDir,
      sharedDir,
      toolParams: { path: path.join(sharedDir, "memory", "2026-03-09.md"), content: "x" },
    });
    expect(target).toBe(path.join(sharedDir, "memory", "2026-03-09.md"));
  });

  it("ignores non-shared writes", () => {
    const target = resolveSharedFamilyMemoryWriteTarget({
      root: workspaceDir,
      sharedDir,
      toolParams: { path: path.join(workspaceDir, "MEMORY.md"), content: "x" },
    });
    expect(target).toBeNull();
  });

  it("ignores non-memory files under shared root", () => {
    const target = resolveSharedFamilyMemoryWriteTarget({
      root: workspaceDir,
      sharedDir,
      toolParams: { path: path.join(sharedDir, "NOTES.md"), content: "x" },
    });
    expect(target).toBeNull();
  });

  it("wraps write tool execution with a file lock for shared memory targets", async () => {
    const execute = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    const base = { name: "write", execute } as unknown as AnyAgentTool;
    const wrapped = wrapToolWithSharedFamilyMemoryWriteLock(base, {
      root: workspaceDir,
      sharedDir,
    });

    await wrapped.execute(
      "call-1",
      { path: path.join(sharedDir, "memory.md"), content: "updated" },
      undefined,
      undefined,
    );

    expect(withFileLockMock).toHaveBeenCalledTimes(1);
    expect(withFileLockMock.mock.calls[0]?.[0]).toBe(path.join(sharedDir, "memory.md"));
    expect(withFileLockMock.mock.calls[0]?.[1]).toEqual(SHARED_FAMILY_MEMORY_LOCK_OPTIONS);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("skips lock for write targets outside shared memory", async () => {
    const execute = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    const base = { name: "write", execute } as unknown as AnyAgentTool;
    const wrapped = wrapToolWithSharedFamilyMemoryWriteLock(base, {
      root: workspaceDir,
      sharedDir,
    });

    await wrapped.execute("call-2", { path: path.join(workspaceDir, "MEMORY.md"), content: "x" });

    expect(withFileLockMock).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("returns non-mutation tools unchanged", () => {
    const execute = vi.fn();
    const tool = { name: "read", execute } as unknown as AnyAgentTool;
    const wrapped = wrapToolWithSharedFamilyMemoryWriteLock(tool, {
      root: workspaceDir,
      sharedDir,
    });
    expect(wrapped).toBe(tool);
  });
});
