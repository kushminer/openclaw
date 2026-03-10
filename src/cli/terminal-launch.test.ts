import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSpawnedCliCommand } from "./terminal-launch.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-terminal-launch-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("terminal launch", () => {
  it("uses repo-local openclaw.mjs and injects active profile", async () => {
    const cwd = await makeTempDir();
    await fs.writeFile(path.join(cwd, "openclaw.mjs"), "export {};\n", "utf8");

    const command = buildSpawnedCliCommand({
      cwd,
      cliArgs: ["tui", "--session", "agent:clio:main"],
      env: { OPENCLAW_PROFILE: "dev" },
    });

    expect(command).toContain("'node' './openclaw.mjs'");
    expect(command).toContain("'--profile' 'dev'");
    expect(command).toContain("'tui' '--session' 'agent:clio:main'");
  });

  it("does not duplicate profile flags when already present", async () => {
    const cwd = await makeTempDir();
    await fs.writeFile(path.join(cwd, "openclaw.mjs"), "export {};\n", "utf8");

    const command = buildSpawnedCliCommand({
      cwd,
      cliArgs: ["--profile", "main", "tui", "--session", "agent:clio:main"],
      env: { OPENCLAW_PROFILE: "dev" },
    });

    const profileMatches = command.match(/'--profile'/g) ?? [];
    expect(profileMatches.length).toBe(1);
    expect(command).toContain("'--profile' 'main'");
  });

  it("falls back to openclaw when no local script exists", async () => {
    const cwd = await makeTempDir();
    const command = buildSpawnedCliCommand({
      cwd,
      cliArgs: ["tui", "--session", "agent:main:main"],
      env: {},
    });

    expect(command).toContain("'openclaw' 'tui' '--session' 'agent:main:main'");
    expect(command).not.toContain("'--profile'");
  });
});
