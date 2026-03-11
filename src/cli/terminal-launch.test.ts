import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("prefers current openclaw.mjs argv path when available", async () => {
    const cwd = await makeTempDir();
    const scriptPath = path.join(cwd, "openclaw.mjs");
    await fs.writeFile(scriptPath, "export {};\n", "utf8");

    const argvSpy = vi
      .spyOn(process, "argv", "get")
      .mockReturnValue([process.execPath, scriptPath, "--profile", "main", "gateway", "run"]);
    try {
      const command = buildSpawnedCliCommand({
        cwd: "/tmp",
        cliArgs: ["tui", "--session", "agent:wren:main"],
        env: { OPENCLAW_PROFILE: "main" },
      });

      expect(command).toContain(`'node' '${scriptPath}'`);
      expect(command).toContain("'--profile' 'main'");
    } finally {
      argvSpy.mockRestore();
    }
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

  it("infers profile from OPENCLAW_STATE_DIR when OPENCLAW_PROFILE is unset", async () => {
    const cwd = await makeTempDir();
    await fs.writeFile(path.join(cwd, "openclaw.mjs"), "export {};\n", "utf8");

    const command = buildSpawnedCliCommand({
      cwd,
      cliArgs: ["tui", "--session", "agent:clio:main"],
      env: { OPENCLAW_STATE_DIR: "/Users/test/.openclaw-main" },
    });

    expect(command).toContain("'--profile' 'main'");
  });

  it("exports OPENCLAW state env into spawned command", async () => {
    const cwd = await makeTempDir();
    await fs.writeFile(path.join(cwd, "openclaw.mjs"), "export {};\n", "utf8");

    const command = buildSpawnedCliCommand({
      cwd,
      cliArgs: ["tui", "--session", "agent:wren:main"],
      env: {
        OPENCLAW_PROFILE: "main",
        OPENCLAW_STATE_DIR: "/Users/test/.openclaw-main",
        OPENCLAW_CONFIG_PATH: "/Users/test/.openclaw-main/openclaw.json",
        OPENCLAW_GATEWAY_PORT: "18789",
      },
    });

    expect(command).toContain("OPENCLAW_PROFILE='main'");
    expect(command).toContain("OPENCLAW_STATE_DIR='/Users/test/.openclaw-main'");
    expect(command).toContain("OPENCLAW_CONFIG_PATH='/Users/test/.openclaw-main/openclaw.json'");
    expect(command).toContain("OPENCLAW_GATEWAY_PORT='18789'");
  });
});
