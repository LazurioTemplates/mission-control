import { describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ToolAuditEvent } from "@lazurio/module-kit/tools";
import {
  hostedEnvironment,
  localEnvironment,
  mcpCall,
  mcpTool,
  mcpToolNames,
  pageTool,
  TEST_ORIGIN,
  TEST_SUBJECT,
} from "@lazurio/module-kit/tools/testing";
import { createMemoryStore } from "../src/data/memory-store.ts";
import { createRepositoryDbStore } from "../src/data/repository-db-store.ts";
import type { MissionControlStore } from "../src/data/store.ts";
import { accessOf, type Env, LISTENER } from "../src/server/access.ts";
import { createAgentTools } from "../src/server/agent-tools.ts";
import { CHANNEL_HEADER, createApi } from "../src/server/api.ts";
import { createFixtureRepo } from "./support/fixture-repo.ts";
import { sampleData } from "./support/seed.ts";

// One test runs real Git and the data repository's validator; see repository-db-store.test.ts.
setDefaultTimeout(60_000);

const READ_TOOLS = [
  "check_plans",
  "get_app_context",
  "get_draft",
  "get_plan",
  "get_roadmap",
  "list_plans",
  "list_roadmaps",
];
const WRITE_TOOLS = ["create_plan", "discard_draft", "save_plan", "save_roadmap"];

const NEW_PLAN = {
  title: "Shared glossary review",
  owner: "robinlee",
  priority: "medium",
  context: "Terms drift.",
  current_problem: "No schedule.",
  target_state: "A quarterly review.",
  acceptance_criteria: ["Reviewed once a quarter."],
  validation: ["The glossary shows the review date."],
};

/** The App's API and its tools over a store, as the Application host runs
 * them: the gateway states who came. The channel each API request states is
 * recorded. */
function setup(
  env: Env,
  store: MissionControlStore = createMemoryStore(sampleData()),
  origin = TEST_ORIGIN,
) {
  const audits: ToolAuditEvent[] = [];
  const channels: Array<string | null> = [];
  const handle = createApi(store, {
    allowedOrigins: new Set([origin]),
    access: (request) => accessOf(request, env),
    today: () => "2026-11-03",
  });
  const api = (request: Request) => {
    channels.push(request.headers.get(CHANNEL_HEADER));
    return handle(request);
  };
  const tools = createAgentTools({
    api,
    origin,
    locale: "en",
    env,
    audit: (event) => audits.push(event),
  });
  return { store, tools, audits, channels };
}

const hosted = (writer: boolean) => hostedEnvironment({ writer, listener: LISTENER });
const user = { role: "user" } as const;
const admin = { role: "admin" } as const;

describe("tools for agents", () => {
  test("an application user and an application admin see the reading and the writing tools while the App writes", async () => {
    const { tools } = setup(hosted(true));
    const expected = [...READ_TOOLS, ...WRITE_TOOLS].sort();
    expect(await mcpToolNames(tools, user)).toEqual(expected);
    expect(await mcpToolNames(tools, admin)).toEqual(expected);
  });

  test("a production application offers no publication; a person publishes in the interface", async () => {
    const { tools } = setup(hosted(true));
    expect(await mcpToolNames(tools, admin)).not.toContain("publish_draft");
    const { isError, structured } = await mcpTool(
      tools,
      "publish_draft",
      { expectedRevision: "any" },
      admin,
    );
    expect(isError).toBe(true);
    expect(structured.reason).toBe("forbidden");
  });

  test("a Module version in an Environment offers publish_draft as a tool of its own", async () => {
    const env = localEnvironment(LISTENER);
    const { tools, store } = setup(env, undefined, "http://127.0.0.1:43100");
    const names = await mcpToolNames(tools, user);
    expect(names).toEqual([...READ_TOOLS, ...WRITE_TOOLS, "publish_draft"].sort());
    const { body } = await mcpCall(tools, "tools/list", {}, { caller: user });
    const listed = (body.result as { tools: Array<{ name: string; annotations: object }> }).tools;
    expect(listed.find((tool) => tool.name === "publish_draft")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    // It publishes exactly the draft it was shown.
    expect((await mcpTool(tools, "create_plan", NEW_PLAN, user)).isError).toBe(false);
    const draft = await mcpTool(tools, "get_draft", {}, user);
    const revision = (draft.structured as { revision: string }).revision;
    const stale = await mcpTool(tools, "publish_draft", { expectedRevision: "stale" }, user);
    expect(stale.isError).toBe(true);
    const published = await mcpTool(tools, "publish_draft", { expectedRevision: revision }, user);
    expect(published.isError).toBe(false);
    expect((await store.draft()).records).toEqual([]);
  });

  test("a copy that may not write offers only the reading tools and refuses a write", async () => {
    const { tools } = setup(hosted(false));
    expect(await mcpToolNames(tools, admin)).toEqual(READ_TOOLS);
    const { isError, structured } = await mcpTool(tools, "create_plan", NEW_PLAN, admin);
    expect(isError).toBe(true);
    expect(structured.reason).toBe("data_read_only");
  });

  test("without a role /mcp and the page refuse with identity_unavailable", async () => {
    const { tools } = setup(hosted(true));
    const { status } = await mcpCall(tools, "tools/list", {}, { caller: { role: "none" } });
    expect(status).toBe(403);
    const page = await pageTool(tools, "list_plans", {}, { role: "none" });
    expect(page.status).toBe(403);
    expect(page.body.reason).toBe("identity_unavailable");
  });

  test("the reading tools answer what the API answers", async () => {
    const { tools } = setup(hosted(true));
    const plans = await mcpTool(tools, "list_plans", {}, user);
    expect((plans.structured as { items: unknown[] }).items.length).toBe(4);
    const plan = await mcpTool(tools, "get_plan", { code: "EX-0001" }, user);
    expect((plan.structured as { value: { dev_code: string } }).value.dev_code).toBe("EX-0001");
    const missing = await mcpTool(tools, "get_plan", { code: "EX-0404" }, user);
    expect(missing).toMatchObject({ isError: true, structured: { reason: "not_found" } });
    const roadmap = await mcpTool(tools, "get_roadmap", { code: "RM-0001" }, user);
    expect((roadmap.structured as { value: { main: boolean } }).value.main).toBe(true);
    expect((await mcpTool(tools, "check_plans", {}, user)).structured).toEqual({ items: [] });
    const invalid = await mcpTool(tools, "get_plan", { code: "not a code" }, user);
    expect(invalid.structured.reason).toBe("invalid_input");
  });

  test("a tool's change goes through the API as a draft, with its revision, and is audited by channel", async () => {
    const { tools, store, audits, channels } = setup(hosted(true));
    const created = await mcpTool(tools, "create_plan", NEW_PLAN, user);
    expect(created.isError).toBe(false);
    const saved = created.structured as {
      value: { dev_code: string; status: string };
      revision: string;
    };
    expect(saved.value).toMatchObject({ dev_code: "EX-0005", status: "shaping" });
    expect(channels.at(-1)).toBe("mcp");
    expect(audits.at(-1)).toMatchObject({ tool: "create_plan", channel: "mcp", outcome: "ok" });

    const edit = { code: "EX-0005", record: { ...saved.value, status: "ready" } };
    const ready = await mcpTool(
      tools,
      "save_plan",
      { ...edit, baseRevision: saved.revision },
      user,
    );
    expect(ready.isError).toBe(false);
    expect((await store.getPlan("EX-0005"))?.value.status).toBe("ready");
    const stale = await mcpTool(
      tools,
      "save_plan",
      { ...edit, baseRevision: saved.revision },
      user,
    );
    expect(stale).toMatchObject({ isError: true, structured: { reason: "record_changed" } });

    const draft = await mcpTool(tools, "get_draft", {}, user);
    const card = draft.structured as { revision: string; records: unknown[] };
    expect(card.records.length).toBe(1);
    const discarded = await mcpTool(
      tools,
      "discard_draft",
      { scope: { kind: "draft" }, expectedRevision: card.revision },
      user,
    );
    expect(discarded.isError).toBe(false);
    expect(await store.getPlan("EX-0005")).toBeNull();
  });

  test("a saved roadmap keeps its code and refuses another one", async () => {
    const { tools } = setup(hosted(true));
    const found = await mcpTool(tools, "get_roadmap", { code: "RM-0001" }, user);
    const { value, revision } = found.structured as {
      value: { roadmap_code: string; summary: string };
      revision: string;
    };
    const saved = await mcpTool(
      tools,
      "save_roadmap",
      { code: "RM-0001", record: { ...value, summary: "A new summary." }, baseRevision: revision },
      user,
    );
    expect(saved.isError).toBe(false);
    const other = await mcpTool(
      tools,
      "save_roadmap",
      { code: "RM-0002", record: value, baseRevision: revision },
      user,
    );
    expect(other).toMatchObject({ isError: true, structured: { reason: "bad_request" } });
  });

  test("the page calls the same tools with its own session, by the channel webmcp", async () => {
    const { tools, channels, audits } = setup(hosted(true));
    const { status, body } = await pageTool(tools, "list_roadmaps", {}, user);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(channels.at(-1)).toBe("webmcp");
    expect(audits.at(-1)).toMatchObject({ tool: "list_roadmaps", channel: "webmcp" });
  });

  test("the data record a tool's change as an agent's, with the person", async () => {
    const fixture = createFixtureRepo({ sample: true });
    const store = createRepositoryDbStore({
      mountRoot: fixture.mountRoot,
      expect: { remote: fixture.origin, branch: "v3", within: fixture.moduleRoot },
      intervalMs: 0,
    });
    try {
      const { tools } = setup(hosted(true), store);
      expect((await mcpTool(tools, "create_plan", NEW_PLAN, user)).isError).toBe(false);
      const origins = ((await store.draft()).records ?? []).map(
        (record) => record.resource.changes[0]?.origin,
      );
      expect(origins).toEqual([
        expect.objectContaining({
          kind: "agent",
          actor: TEST_SUBJECT,
          source: "mission-control-v3/mcp",
        }),
      ]);
    } finally {
      store.close();
      fixture.cleanup();
    }
  });
});
