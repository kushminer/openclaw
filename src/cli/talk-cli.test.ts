import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAgentMainSessionKey } from "../routing/session-key.js";
import { runRegisteredCli } from "../test-utils/command-runner.js";

const runTuiMock = vi.fn(async () => undefined);
const loadConfigMock = vi.fn(() => ({}));
const listAgentEntriesMock = vi.fn(() => []);
const buildSpawnedCliCommandMock = vi.fn(
  (params: { cliArgs: string[] }) => `spawn:${params.cliArgs.join(" ")}`,
);
const launchCommandInTerminalMock = vi.fn(async () => true);
const runtimeLogMock = vi.fn();
const runtimeErrorMock = vi.fn();
const runtimeExitMock = vi.fn((code: number) => {
  throw new Error(`__exit__:${code}`);
});

vi.mock("../tui/tui.js", () => ({
  runTui: (opts: unknown) => runTuiMock(opts),
}));

vi.mock("../config/config.js", () => ({
  loadConfig: () => loadConfigMock(),
}));

vi.mock("../commands/agents.config.js", () => ({
  listAgentEntries: (cfg: unknown) => listAgentEntriesMock(cfg),
}));

vi.mock("./terminal-launch.js", () => ({
  buildSpawnedCliCommand: (params: { cwd: string; cliArgs: string[] }) =>
    buildSpawnedCliCommandMock(params),
  launchCommandInTerminal: (command: string) => launchCommandInTerminalMock(command),
}));

vi.mock("../runtime.js", () => ({
  defaultRuntime: {
    log: (...args: unknown[]) => runtimeLogMock(...args),
    error: (...args: unknown[]) => runtimeErrorMock(...args),
    exit: (code: number) => runtimeExitMock(code),
  },
}));

const { registerTalkCli } = await import("./talk-cli.js");

async function runTalkCommand(argv: string[]) {
  await runRegisteredCli({
    register: registerTalkCli,
    argv,
  });
}

describe("talk cli", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listAgentEntriesMock.mockReturnValue([
      { id: "clio", name: "Clio" },
      { id: "wren", name: "Wren" },
    ]);
  });

  it("runs a single-agent TUI in the current terminal by default", async () => {
    await runTalkCommand(["talk", "clio"]);

    expect(runTuiMock).toHaveBeenCalledTimes(1);
    expect(runTuiMock).toHaveBeenCalledWith(
      expect.objectContaining({
        session: buildAgentMainSessionKey({ agentId: "clio" }),
      }),
    );
    expect(buildSpawnedCliCommandMock).not.toHaveBeenCalled();
    expect(launchCommandInTerminalMock).not.toHaveBeenCalled();
  });

  it("opens a single-agent chat in a spawned terminal with --spawn", async () => {
    await runTalkCommand(["talk", "clio", "--spawn", "--message", "ping"]);

    expect(runTuiMock).not.toHaveBeenCalled();
    expect(buildSpawnedCliCommandMock).toHaveBeenCalledTimes(1);
    expect(buildSpawnedCliCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cliArgs: expect.arrayContaining([
          "tui",
          "--session",
          buildAgentMainSessionKey({ agentId: "clio" }),
          "--message",
          "ping",
        ]),
      }),
    );
    expect(launchCommandInTerminalMock).toHaveBeenCalledTimes(1);
  });

  it("adds a default greeting message when spawning without --message", async () => {
    await runTalkCommand(["talk", "clio", "--spawn"]);

    expect(runTuiMock).not.toHaveBeenCalled();
    expect(buildSpawnedCliCommandMock).toHaveBeenCalledTimes(1);
    expect(buildSpawnedCliCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cliArgs: expect.arrayContaining([
          "tui",
          "--session",
          buildAgentMainSessionKey({ agentId: "clio" }),
          "--message",
          "Hi clio! Please introduce yourself and confirm you're ready.",
        ]),
      }),
    );
    expect(launchCommandInTerminalMock).toHaveBeenCalledTimes(1);
  });

  it("opens one terminal per configured agent with --all", async () => {
    await runTalkCommand(["talk", "--all"]);

    expect(runTuiMock).not.toHaveBeenCalled();
    expect(buildSpawnedCliCommandMock).toHaveBeenCalledTimes(2);
    expect(launchCommandInTerminalMock).toHaveBeenCalledTimes(2);
    expect(buildSpawnedCliCommandMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        cliArgs: expect.arrayContaining([
          "--message",
          "Hi clio! Please introduce yourself and confirm you're ready.",
        ]),
      }),
    );
    expect(buildSpawnedCliCommandMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        cliArgs: expect.arrayContaining([
          "--message",
          "Hi wren! Please introduce yourself and confirm you're ready.",
        ]),
      }),
    );
    expect(runtimeLogMock).toHaveBeenCalledWith(
      expect.stringContaining("Opened 2 agent terminals"),
    );
  });

  it("rejects combining [agent] with --all", async () => {
    await expect(runTalkCommand(["talk", "clio", "--all"])).rejects.toThrow("__exit__:1");
    expect(runtimeErrorMock).toHaveBeenCalledWith(
      "Cannot combine [agent] with --all. Use `openclaw talk --all`.",
    );
    expect(runTuiMock).not.toHaveBeenCalled();
  });
});
