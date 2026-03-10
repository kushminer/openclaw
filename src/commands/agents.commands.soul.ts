import {
  listAgentIds,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../agents/agent-scope.js";
import { normalizeAgentSoulPurpose, upsertAgentFamilySoulFile } from "../agents/family-soul.js";
import { normalizeAgentId } from "../routing/session-key.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { shortenHomePath } from "../utils.js";
import { requireValidConfig } from "./agents.command-shared.js";

type AgentsSetSoulOptions = {
  agent?: string;
  purpose?: string;
  json?: boolean;
};

export async function agentsSetSoulCommand(
  opts: AgentsSetSoulOptions,
  runtime: RuntimeEnv = defaultRuntime,
) {
  const cfg = await requireValidConfig(runtime);
  if (!cfg) {
    return;
  }

  const fallbackAgentId = resolveDefaultAgentId(cfg);
  const agentId = normalizeAgentId(opts.agent?.trim() || fallbackAgentId);
  const knownAgents = new Set(listAgentIds(cfg));
  if (!knownAgents.has(agentId)) {
    runtime.error(
      `Agent "${agentId}" is not configured. Available: ${Array.from(knownAgents).join(", ")}`,
    );
    runtime.exit(1);
    return;
  }

  const purpose = normalizeAgentSoulPurpose(opts.purpose);
  if (!purpose) {
    runtime.error('Purpose is required. Pass --purpose "<text>".');
    runtime.exit(1);
    return;
  }

  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
  const result = await upsertAgentFamilySoulFile({
    workspaceDir,
    config: cfg,
    agentId,
    purpose,
    isNewborn: false,
  });

  if (opts.json) {
    runtime.log(
      JSON.stringify(
        {
          agentId,
          purpose: result.purpose,
          soulPath: result.soulPath,
          rootAgentId: result.info.rootAgentId,
          siblingAgentIds: result.info.siblingAgentIds,
          bornAtIso: result.bornAtIso,
          updated: result.updated,
        },
        null,
        2,
      ),
    );
    return;
  }

  runtime.log(`Updated SOUL.md for agent "${agentId}".`);
  runtime.log(`SOUL: ${shortenHomePath(result.soulPath)}`);
  runtime.log(`Purpose: ${result.purpose ?? "(unset)"}`);
}
