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

export function buildSpawnedCliCommand(params: {
  cwd: string;
  cliArgs: string[];
  env?: Record<string, string | undefined>;
}): string {
  const cwd = params.cwd.trim() || process.cwd();
  const args: string[] = fs.existsSync(path.join(cwd, "openclaw.mjs"))
    ? ["node", "./openclaw.mjs"]
    : ["openclaw"];
  const env = params.env ?? (process.env as Record<string, string | undefined>);
  const profile = normalizeProfileName(env.OPENCLAW_PROFILE);
  if (profile && !hasExplicitProfileFlag(params.cliArgs)) {
    args.push("--profile", profile);
  }
  args.push(...params.cliArgs);
  return `cd ${shellEscape(cwd)} && exec ${args.map(shellEscape).join(" ")}`;
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
