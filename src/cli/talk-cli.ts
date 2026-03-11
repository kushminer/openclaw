import { select } from "@clack/prompts";
import type { Command } from "commander";
import { listAgentEntries } from "../commands/agents.config.js";
import { loadConfig } from "../config/config.js";
import { buildAgentMainSessionKey, normalizeAgentId } from "../routing/session-key.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { runTui } from "../tui/tui.js";
import { formatHelpExamples } from "./help-format.js";
import { parseTimeoutMs } from "./parse-timeout.js";
import { buildSpawnedCliCommand, launchCommandInTerminal } from "./terminal-launch.js";

type TalkOptions = {
  url?: string;
  token?: string;
  password?: string;
  deliver?: boolean;
  thinking?: string;
  message?: string;
  timeoutMs?: string;
  historyLimit?: string;
  all?: boolean;
  spawn?: boolean;
};

function parseHistoryLimit(raw: unknown): number | undefined {
  const candidate =
    typeof raw === "number" && Number.isFinite(raw)
      ? String(Math.trunc(raw))
      : typeof raw === "string"
        ? raw
        : "200";
  const parsed = Number.parseInt(candidate, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function buildTuiCliArgs(params: {
  sessionKey: string;
  opts: TalkOptions;
  timeoutMs?: number;
  historyLimit?: number;
  defaultMessage?: string;
}): string[] {
  const args = ["tui", "--session", params.sessionKey];
  if (params.opts.url) {
    args.push("--url", params.opts.url);
  }
  if (params.opts.token) {
    args.push("--token", params.opts.token);
  }
  if (params.opts.password) {
    args.push("--password", params.opts.password);
  }
  if (params.opts.deliver) {
    args.push("--deliver");
  }
  if (params.opts.thinking) {
    args.push("--thinking", params.opts.thinking);
  }
  const explicitMessage = params.opts.message?.trim();
  const initialMessage = explicitMessage?.length
    ? explicitMessage
    : params.defaultMessage?.trim() || undefined;
  if (initialMessage) {
    args.push("--message", initialMessage);
  }
  if (params.timeoutMs !== undefined) {
    args.push("--timeout-ms", String(params.timeoutMs));
  }
  if (params.historyLimit !== undefined) {
    args.push("--history-limit", String(params.historyLimit));
  }
  return args;
}

function buildSpawnGreetingMessage(agentId: string): string {
  return `Hi ${agentId}! Please introduce yourself and confirm you're ready.`;
}

export function registerTalkCli(program: Command) {
  program
    .command("talk [agent]")
    .description("Open a terminal chat with a specific agent")
    .option("--url <url>", "Gateway WebSocket URL")
    .option("--token <token>", "Gateway token (if required)")
    .option("--password <password>", "Gateway password (if required)")
    .option("--deliver", "Deliver assistant replies", false)
    .option("--thinking <level>", "Thinking level override")
    .option("--message <text>", "Send an initial message after connecting")
    .option("--timeout-ms <ms>", "Agent timeout in ms")
    .option("--history-limit <n>", "History entries to load", "200")
    .option("--spawn", "Open the selected chat in a new terminal", false)
    .option("--all", "Open one terminal per configured agent", false)
    .addHelpText(
      "after",
      () =>
        `
${theme.heading("Examples:")}
${formatHelpExamples([
  ["openclaw talk wren", "Open a chat with agent Wren."],
  ["openclaw talk", "Pick an agent from a list."],
  ["openclaw talk --all", "Open one terminal per configured agent."],
  ["openclaw talk clio --spawn", "Open Clio in a new terminal window."],
  ['openclaw talk clio --message "What are you working on?"', "Chat with Clio, send a message."],
  ["openclaw talk wren --thinking high", "Chat with Wren using high thinking."],
])}

${theme.muted("Docs:")} ${formatDocsLink("/cli/talk", "docs.openclaw.ai/cli/talk")}`,
    )
    .action(async (agentArg, rawOpts) => {
      try {
        const opts = rawOpts as TalkOptions;
        const config = loadConfig();
        const agents = listAgentEntries(config);
        const timeoutMs = parseTimeoutMs(opts.timeoutMs);
        if (opts.timeoutMs !== undefined && timeoutMs === undefined) {
          defaultRuntime.error(
            `warning: invalid --timeout-ms "${String(opts.timeoutMs)}"; ignoring`,
          );
        }
        const historyLimit = parseHistoryLimit(opts.historyLimit);

        if (opts.all === true) {
          if (agentArg) {
            defaultRuntime.error("Cannot combine [agent] with --all. Use `openclaw talk --all`.");
            defaultRuntime.exit(1);
            return;
          }
          if (agents.length === 0) {
            defaultRuntime.error("No agents configured. Run `openclaw agents add` first.");
            defaultRuntime.exit(1);
            return;
          }

          const seen = new Set<string>();
          const launches: Array<{ agentId: string; command: string; launched: boolean }> = [];
          for (const agent of agents) {
            const agentId = normalizeAgentId(agent.id);
            if (!agentId || seen.has(agentId)) {
              continue;
            }
            seen.add(agentId);
            const sessionKey = buildAgentMainSessionKey({ agentId });
            const command = buildSpawnedCliCommand({
              cwd: process.cwd(),
              cliArgs: buildTuiCliArgs({
                sessionKey,
                opts,
                timeoutMs,
                historyLimit,
                defaultMessage: buildSpawnGreetingMessage(agentId),
              }),
            });
            const launched = await launchCommandInTerminal(command);
            launches.push({ agentId, command, launched });
          }

          const failures = launches.filter((entry) => !entry.launched);
          if (failures.length === 0) {
            defaultRuntime.log(
              `Opened ${launches.length} agent terminals: ${launches.map((entry) => entry.agentId).join(", ")}`,
            );
            return;
          }
          defaultRuntime.error("Failed to open one or more terminal windows.");
          for (const failure of failures) {
            defaultRuntime.log(`Run manually for ${failure.agentId}: ${failure.command}`);
          }
          defaultRuntime.exit(1);
          return;
        }

        let agentId: string;

        if (agentArg) {
          // Agent specified as argument
          agentId = normalizeAgentId(String(agentArg).trim());
          const found = agents.find(
            (a) =>
              normalizeAgentId(a.id) === agentId ||
              a.name?.toLowerCase() === agentArg.toLowerCase(),
          );
          if (!found) {
            defaultRuntime.error(
              `Agent "${agentArg}" not found. Available: ${agents.map((a) => a.name || a.id).join(", ")}`,
            );
            defaultRuntime.exit(1);
            return;
          }
          agentId = normalizeAgentId(found.id);
        } else {
          // No agent specified — prompt for selection
          if (agents.length === 0) {
            defaultRuntime.error("No agents configured. Run `openclaw agents add` first.");
            defaultRuntime.exit(1);
            return;
          }
          if (agents.length === 1) {
            agentId = normalizeAgentId(agents[0].id);
          } else {
            const selection = await select({
              message: "Which agent do you want to talk to?",
              options: agents.map((a) => ({
                value: normalizeAgentId(a.id),
                label: a.name
                  ? `${a.name} (${a.id})${a.default ? " — default" : ""}`
                  : `${a.id}${a.default ? " — default" : ""}`,
              })),
            });
            if (typeof selection !== "string") {
              // User cancelled
              return;
            }
            agentId = selection;
          }
        }

        const sessionKey = buildAgentMainSessionKey({ agentId });
        if (opts.spawn === true) {
          const command = buildSpawnedCliCommand({
            cwd: process.cwd(),
            cliArgs: buildTuiCliArgs({
              sessionKey,
              opts,
              timeoutMs,
              historyLimit,
              defaultMessage: buildSpawnGreetingMessage(agentId),
            }),
          });
          const launched = await launchCommandInTerminal(command);
          if (launched) {
            defaultRuntime.log(`Opened terminal for ${agentId} (${sessionKey})`);
            return;
          }
          defaultRuntime.error("Failed to open a new terminal window automatically.");
          defaultRuntime.log(`Run this manually: ${command}`);
          defaultRuntime.exit(1);
          return;
        }

        await runTui({
          url: opts.url,
          token: opts.token,
          password: opts.password,
          session: sessionKey,
          deliver: Boolean(opts.deliver),
          thinking: opts.thinking,
          message: opts.message,
          timeoutMs,
          historyLimit,
        });
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });
}
