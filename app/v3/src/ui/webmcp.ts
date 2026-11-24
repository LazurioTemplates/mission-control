import {
  type AgentTools,
  type ModelContextLike,
  type RegisterAgentToolsOptions,
  registerAgentTools,
} from "@lazurio/module-kit/webmcp";

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

export interface InstallToolsOptions {
  /** `registerAgentTools` of module-kit; a test passes its own. */
  readonly register?: (options: RegisterAgentToolsOptions) => Promise<AgentTools>;
  /** The browser's WebMCP API; by default `document.modelContext ??
   * navigator.modelContext`, `null` where the browser has none. */
  readonly modelContext?: ModelContextLike | null;
}

/** The browser's WebMCP API, or `null` where it has none. */
export function pageModelContext(): ModelContextLike | null {
  const scope = globalThis as {
    document?: { modelContext?: ModelContextLike };
    navigator?: { modelContext?: ModelContextLike };
  };
  return scope.document?.modelContext ?? scope.navigator?.modelContext ?? null;
}

/**
 * The browser's `registerTool(tool, { signal })` returns a promise that
 * rejects with `AbortError` once the signal removes the tool. module-kit
 * 0.6.0 aborts the signal on every refresh and removal but never handles that
 * promise (Lazurio/module-kit#14), so each removed tool was an unhandled
 * rejection (Bun's error overlay in `bun run dev:demo`). The wrapper hands
 * the browser's answer on unchanged, with a handler for its rejection.
 */
export function quietModelContext(context: ModelContextLike | null): ModelContextLike | null {
  if (context === null) return null;
  return {
    registerTool(tool, options) {
      const handle = context.registerTool(tool, options);
      if (typeof (handle as { then?: unknown } | null | undefined)?.then === "function") {
        Promise.resolve(handle as PromiseLike<unknown>).catch(() => {});
      }
      return handle;
    },
  };
}

/** Registers the server's tools where the browser offers WebMCP. */
export function installTools(options: InstallToolsOptions = {}): InstalledTools {
  const register = options.register ?? registerAgentTools;
  const modelContext = quietModelContext(
    options.modelContext === undefined ? pageModelContext() : options.modelContext,
  );
  let tools: AgentTools | null = null;
  let stopped = false;
  // One step at a time: a refresh never overlaps the registration or another
  // refresh, and a failed step (the server did not answer) leaves the page
  // working without tools instead of an unhandled rejection.
  let queue: Promise<unknown> = register({ modelContext }).then(
    (registered) => {
      tools = registered;
      if (stopped) registered.unregister();
    },
    () => undefined,
  );
  const then = (step: () => unknown) => {
    queue = queue.then(step).catch(() => undefined);
  };
  return {
    remove: () => {
      stopped = true;
      tools?.unregister();
      // A refresh still on its way registers again; remove what it left.
      then(() => tools?.unregister());
    },
    refresh: () => {
      then(() => (stopped ? undefined : tools?.refresh()));
    },
  };
}
