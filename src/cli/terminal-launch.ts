import fs from "node:fs";
import path from "node:path";
import { runCommandWithTimeout } from "../process/exec.js";
import { normalizeProfileName } from "./profile-utils.js";

function shellEscape(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function escapeAppleScript(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function hasExplicitProfileFlag(args: string[]): boolean {
  return args.some((arg) => arg === "--dev" || arg === "--profile" || arg.startsWith("--profile="));
}

function resolveLocalCliArgs(cwd: string): string[] | null {
  const scriptArgv1 = process.argv[1] ? path.resolve(process.argv[1]) : "";
  if (path.basename(scriptArgv1) === "openclaw.mjs" && fs.existsSync(scriptArgv1)) {
    // Keep spawned commands on the same CLI build/version that launched the current process.
    return ["node", scriptArgv1];
  }
  const cwdScript = path.join(cwd, "openclaw.mjs");
  if (fs.existsSync(cwdScript)) {
    return ["node", "./openclaw.mjs"];
  }
  return null;
}

function inferProfileFromStateDir(env: Record<string, string | undefined>): string | null {
  const rawStateDir = env.OPENCLAW_STATE_DIR?.trim();
  if (!rawStateDir) {
    return null;
  }
  const base = path.basename(rawStateDir);
  if (base === ".openclaw") {
    return null;
  }
  if (!base.startsWith(".openclaw-")) {
    return null;
  }
  const candidate = base.slice(".openclaw-".length);
  return normalizeProfileName(candidate);
}

function buildSpawnEnvPrefix(env: Record<string, string | undefined>): string {
  const allowlist = [
    "OPENCLAW_PROFILE",
    "OPENCLAW_STATE_DIR",
    "OPENCLAW_CONFIG_PATH",
    "OPENCLAW_GATEWAY_PORT",
  ] as const;
  const assignments: string[] = [];
  for (const key of allowlist) {
    const value = env[key];
    if (typeof value !== "string" || !value.trim()) {
      continue;
    }
    assignments.push(`${key}=${shellEscape(value)}`);
  }
  return assignments.join(" ");
}

export function buildSpawnedCliCommand(params: {
  cwd: string;
  cliArgs: string[];
  env?: Record<string, string | undefined>;
}): string {
  const cwd = params.cwd.trim() || process.cwd();
  const args: string[] = resolveLocalCliArgs(cwd) ?? ["openclaw"];
  const env = params.env ?? (process.env as Record<string, string | undefined>);
  const profile = normalizeProfileName(env.OPENCLAW_PROFILE) ?? inferProfileFromStateDir(env);
  if (profile && !hasExplicitProfileFlag(params.cliArgs)) {
    args.push("--profile", profile);
  }
  args.push(...params.cliArgs);
  const spawnEnvPrefix = buildSpawnEnvPrefix(env);
  const envPrefix = spawnEnvPrefix ? `${spawnEnvPrefix} ` : "";
  return `cd ${shellEscape(cwd)} && ${envPrefix}exec ${args.map(shellEscape).join(" ")}`;
}

export async function launchCommandInTerminal(command: string): Promise<boolean> {
  if (process.platform === "darwin") {
    const script = `tell application "Terminal" to activate\ntell application "Terminal" to do script "${escapeAppleScript(command)}"`;
    const result = await runCommandWithTimeout(["osascript", "-e", script], { timeoutMs: 5000 });
    return result.code === 0;
  }

  if (process.platform === "win32") {
    const result = await runCommandWithTimeout(["cmd", "/c", "start", "", "cmd", "/k", command], {
      timeoutMs: 5000,
    });
    return result.code === 0;
  }

  const launchers: string[][] = [
    ["x-terminal-emulator", "-e", "sh", "-lc", command],
    ["gnome-terminal", "--", "bash", "-lc", command],
    ["konsole", "-e", "bash", "-lc", command],
    ["xterm", "-e", "sh", "-lc", command],
  ];
  for (const argv of launchers) {
    try {
      const result = await runCommandWithTimeout(argv, { timeoutMs: 5000 });
      if (result.code === 0) {
        return true;
      }
    } catch {
      // Try next launcher.
    }
  }
  return false;
}
