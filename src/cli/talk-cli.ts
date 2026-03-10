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
    .addHelpText(
      "after",
      () =>
        `
${theme.heading("Examples:")}
${formatHelpExamples([
  ["openclaw talk wren", "Open a chat with agent Wren."],
  ["openclaw talk", "Pick an agent from a list."],
  ['openclaw talk clio --message "What are you working on?"', "Chat with Clio, send a message."],
  ["openclaw talk wren --thinking high", "Chat with Wren using high thinking."],
])}

${theme.muted("Docs:")} ${formatDocsLink("/cli/talk", "docs.openclaw.ai/cli/talk")}`,
    )
    .action(async (agentArg, opts) => {
      try {
        const config = loadConfig();
        const agents = listAgentEntries(config);

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
        const timeoutMs = parseTimeoutMs(opts.timeoutMs);
        if (opts.timeoutMs !== undefined && timeoutMs === undefined) {
          defaultRuntime.error(
            `warning: invalid --timeout-ms "${String(opts.timeoutMs)}"; ignoring`,
          );
        }
        const historyLimit = Number.parseInt(String(opts.historyLimit ?? "200"), 10);

        await runTui({
          url: opts.url as string | undefined,
          token: opts.token as string | undefined,
          password: opts.password as string | undefined,
          session: sessionKey,
          deliver: Boolean(opts.deliver),
          thinking: opts.thinking as string | undefined,
          message: opts.message as string | undefined,
          timeoutMs,
          historyLimit: Number.isNaN(historyLimit) ? undefined : historyLimit,
        });
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });
}
