import { type AgentTools, registerAgentTools } from "@lazurio/module-kit/webmcp";

/**
 * The page's side of the tools for agents (Module Standard, "Agents in the
 * App"). The tools are defined once on the server (`server/agent-tools.ts`)
 * and the page registers exactly those its server lists for the person now,
 * already filtered by role and writer mode; each call goes to the same
 * handler as `/mcp`, with the page's own session. Without the WebMCP API in
 * the browser nothing is registered and the page works the same.
 */

/** The page's registration: removes the tools, or asks the server again
 * (after a sign-in or a change of the writer mode). */
export interface InstalledTools {
  readonly remove: () => void;
  readonly refresh: () => void;
}

/** Registers the server's tools where the browser offers WebMCP. */
export function installTools(
  register: typeof registerAgentTools = registerAgentTools,
): InstalledTools {
  let tools: AgentTools | null = null;
  let stopped = false;
  const ready = register().then((registered) => {
    if (stopped) registered.unregister();
    else tools = registered;
  });
  return {
    remove: () => {
      stopped = true;
      tools?.unregister();
    },
    refresh: () => {
      void ready.then(() => (stopped ? undefined : tools?.refresh()));
    },
  };
}
