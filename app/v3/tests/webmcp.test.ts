import { describe, expect, test } from "bun:test";
import type { AppAccess } from "@lazurio/module-kit";
import { localEnvironment } from "@lazurio/module-kit/tools/testing";
import type { AgentTools } from "@lazurio/module-kit/webmcp";
import { MESSAGES } from "../src/i18n/messages.ts";
import { LISTENER } from "../src/server/access.ts";
import { createAgentTools } from "../src/server/agent-tools.ts";
import { installTools } from "../src/ui/webmcp.ts";

const TOOLS = [
  "list_plans",
  "get_plan",
  "list_roadmaps",
  "get_roadmap",
  "check_plans",
  "get_draft",
  "create_plan",
  "save_plan",
  "save_roadmap",
  "discard_draft",
  "publish_draft",
];

const EFFECTS: Record<string, string> = {
  list_plans: "read",
  get_plan: "read",
  list_roadmaps: "read",
  get_roadmap: "read",
  check_plans: "read",
  get_draft: "read",
  create_plan: "write",
  save_plan: "write",
  save_roadmap: "write",
  discard_draft: "write",
  publish_draft: "publish",
};

/** A local entry in an Environment: every tool is listed, publication included. */
const LOCAL: AppAccess = {
  entry: "local",
  appRole: "admin",
  person: null,
  source: null,
  reason: "not-hosted",
};

describe("tools for agents: names, schemas and descriptions", () => {
  test("named verb first, with JSON Schema inputs, in the server's language; only publish_draft publishes", () => {
    for (const locale of ["cs", "en"] as const) {
      const registry = createAgentTools({
        api: async () => Response.json({}),
        origin: "http://127.0.0.1:43100",
        locale,
        env: localEnvironment(LISTENER),
        audit: () => {},
      });
      const own = registry.list(LOCAL).filter((tool) => tool.name !== "get_app_context");
      expect(own.map((tool) => tool.name)).toEqual(TOOLS);
      for (const tool of own) {
        expect(tool.name).toMatch(/^[a-z]+(?:_[a-z]+)+$/);
        expect(tool.inputSchema.type).toBe("object");
        expect(tool.inputSchema.additionalProperties).toBe(false);
        expect(tool.description).toBe(
          MESSAGES[locale].tools[tool.name as keyof (typeof MESSAGES)["cs"]["tools"]],
        );
        expect(tool.effect).toBe(EFFECTS[tool.name] as typeof tool.effect);
        expect(tool.annotations.destructiveHint).toBe(tool.effect === "publish");
        expect(tool.annotations.untrustedContentHint).toBe(tool.effect === "read");
      }
    }
  });

  test("the inputs are the API's own: a new plan, a whole record with its base revision, the draft's revision", () => {
    const registry = createAgentTools({
      api: async () => Response.json({}),
      origin: "http://127.0.0.1:43100",
      locale: "en",
      env: localEnvironment(LISTENER),
      audit: () => {},
    });
    const schema = (name: string) =>
      registry.list(LOCAL).find((tool) => tool.name === name)?.inputSchema as {
        required?: string[];
        properties: Record<string, unknown>;
      };
    // The status of a new plan has a default, so it is not required.
    expect(schema("create_plan").required).not.toContain("status");
    expect(schema("create_plan").required).toContain("acceptance_criteria");
    expect(schema("save_plan").required?.sort()).toEqual(["baseRevision", "code", "record"]);
    expect(schema("save_roadmap").required?.sort()).toEqual(["baseRevision", "code", "record"]);
    expect(schema("publish_draft").required).toEqual(["expectedRevision"]);
    expect(schema("discard_draft").required?.sort()).toEqual(["expectedRevision", "scope"]);
    expect(Object.keys(schema("get_draft").properties)).toEqual(["locale"]);
  });

  test("the page registers the server's tools once, refreshes them and removes them", async () => {
    const calls: string[] = [];
    const fake = async (): Promise<AgentTools> => ({
      registered: [],
      refresh: async () => {
        calls.push("refresh");
        return [];
      },
      unregister: () => calls.push("unregister"),
    });
    const tools = installTools(fake);
    tools.refresh();
    await Bun.sleep(0);
    tools.remove();
    expect(calls).toEqual(["refresh", "unregister"]);
    // Removed before the server answered: nothing stays registered.
    const late = installTools(fake);
    late.remove();
    await Bun.sleep(0);
    expect(calls).toEqual(["refresh", "unregister", "unregister"]);
  });
});
