import {
  createToolRegistry,
  defineTool,
  type ToolAuditEvent,
  type ToolContext,
  type ToolRegistry,
  type ToolResult,
} from "@lazurio/module-kit/tools";
import { z } from "zod";
import packageJson from "../../package.json";
import { plan } from "../domain/plan.ts";
import { roadmap } from "../domain/roadmap.ts";
import { LOCALES, type Locale } from "../i18n/locale.ts";
import { messagesFor } from "../i18n/messages.ts";
import { LISTENER } from "./access.ts";
import { CHANNEL_HEADER, discardInput, newPlanInput, publishInput, saveInput } from "./api.ts";

/**
 * The App's tools for agents (Module Standard, "Agents in the App"), defined
 * once on the server and offered on `/mcp` and to the page
 * (`/api/agent-tools`, registered by `@lazurio/module-kit/webmcp`).
 *
 * Every tool calls the App's own HTTP API in the same process, with the
 * caller's request headers, so the API decides who may do what exactly as it
 * does for a click: the application role, the one writer rule and the
 * record's revision. The channel (`mcp` or `webmcp`) goes with every change,
 * so the data record it as an agent's.
 *
 * Saving is a draft (`write`). Publishing the draft is a Publication into the
 * Organization's data and a tool of its own, `publish_draft`
 * (`effect: "publish"`): an agent calls it only on the person's explicit
 * "Publikuj", and module-kit 0.5.0 does not offer it in a production
 * application at all. Finishing a send and taking colleagues' work (`pull`)
 * stay the Draft page's buttons.
 */

type Api = (request: Request) => Promise<Response>;

const emptyInput = z.strictObject({});
const planCodeInput = z.strictObject({ code: plan.shape.dev_code });
const roadmapCodeInput = z.strictObject({ code: roadmap.shape.roadmap_code });
const draftInput = z.strictObject({ locale: z.enum(LOCALES).optional() });
/** The API's save body, with the code of the record in the path and the
 * record's own schema, so an agent sees the shape it sends. */
const savePlanInput = saveInput.extend({ code: plan.shape.dev_code, record: plan });
const saveRoadmapInput = saveInput.extend({ code: roadmap.shape.roadmap_code, record: roadmap });

const schemaOf = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;

/** The headers the API reads who came by, copied from the caller's request;
 * the body headers are the tool's own. */
function forwardedHeaders(context: ToolContext, origin: string): Headers {
  const headers = new Headers(context.request.headers);
  for (const name of ["content-length", "content-type", "accept", "origin", CHANNEL_HEADER])
    headers.delete(name);
  headers.set(CHANNEL_HEADER, context.channel);
  headers.set("accept", "application/json");
  // The registry has already admitted the call (the gateway's statement on
  // `/mcp`, the App's own origin on the page); the API's cross-site check
  // sees the App's own origin.
  headers.set("origin", origin);
  return headers;
}

/** The API's answer as a tool result: data, or the API's refusal with its code. */
async function resultOf(response: Response): Promise<ToolResult<object>> {
  const body = (await response.json().catch(() => null)) as
    | (Record<string, unknown> & { code?: unknown; message?: unknown; issues?: unknown })
    | unknown[]
    | null;
  if (!response.ok) {
    const refusal = Array.isArray(body) ? null : body;
    const reason = typeof refusal?.code === "string" ? refusal.code : "unavailable";
    const message =
      typeof refusal?.message === "string" && refusal.message
        ? refusal.message
        : `The App answered HTTP ${response.status}.`;
    const issues =
      Array.isArray(refusal?.issues) && refusal.issues.length > 0 ? refusal.issues : null;
    return { ok: false, reason, message, ...(issues ? { details: { issues } } : {}) };
  }
  if (Array.isArray(body)) return { ok: true, data: { items: body } };
  return { ok: true, data: body ?? {} };
}

export interface AgentToolsOptions {
  /** The App's HTTP API (`createApi`). */
  api: Api;
  /** One of the App's own origins, which the API accepts for a change. */
  origin: string;
  /** The language the server speaks: the tools' descriptions and the draft's wording. */
  locale: Locale;
  env?: Record<string, string | undefined>;
  /** Receives every call's audit line (default: one JSON line to stdout). */
  audit?: (event: ToolAuditEvent) => void;
}

export function createAgentTools(options: AgentToolsOptions): ToolRegistry {
  const { api, origin, locale } = options;
  const t = messagesFor(locale).tools;

  const call = async (
    context: ToolContext,
    path: string,
    init?: { method: string; body: unknown },
  ): Promise<ToolResult<object>> => {
    const headers = forwardedHeaders(context, origin);
    if (init) headers.set("content-type", "application/json");
    const request = new Request(new URL(path, origin), {
      method: init?.method ?? "GET",
      headers,
      ...(init ? { body: JSON.stringify(init.body) } : {}),
    });
    return resultOf(await api(request));
  };
  const plans = (code: string) => `/api/plans/${encodeURIComponent(code)}`;
  const roadmaps = (code: string) => `/api/roadmaps/${encodeURIComponent(code)}`;

  return createToolRegistry({
    app: {
      module: "mission-control",
      version: packageJson.version,
      dataGeneration: "v3",
      title: "Mission Control",
    },
    listener: LISTENER,
    ...(options.env ? { env: options.env } : {}),
    ...(options.audit ? { audit: options.audit } : {}),
    tools: [
      defineTool({
        name: "list_plans",
        description: t.list_plans,
        input: emptyInput,
        inputSchema: schemaOf(emptyInput),
        minRole: "user",
        effect: "read",
        untrustedContent: true,
        run: (_input, context) => call(context, "/api/plans"),
      }),
      defineTool({
        name: "get_plan",
        description: t.get_plan,
        input: planCodeInput,
        inputSchema: schemaOf(planCodeInput),
        minRole: "user",
        effect: "read",
        untrustedContent: true,
        run: (input, context) => call(context, plans(input.code)),
      }),
      defineTool({
        name: "list_roadmaps",
        description: t.list_roadmaps,
        input: emptyInput,
        inputSchema: schemaOf(emptyInput),
        minRole: "user",
        effect: "read",
        untrustedContent: true,
        run: (_input, context) => call(context, "/api/roadmaps"),
      }),
      defineTool({
        name: "get_roadmap",
        description: t.get_roadmap,
        input: roadmapCodeInput,
        inputSchema: schemaOf(roadmapCodeInput),
        minRole: "user",
        effect: "read",
        untrustedContent: true,
        run: (input, context) => call(context, roadmaps(input.code)),
      }),
      defineTool({
        name: "check_plans",
        description: t.check_plans,
        input: emptyInput,
        inputSchema: schemaOf(emptyInput),
        minRole: "user",
        effect: "read",
        untrustedContent: true,
        run: (_input, context) => call(context, "/api/check"),
      }),
      defineTool({
        name: "get_draft",
        description: t.get_draft,
        input: draftInput,
        inputSchema: schemaOf(draftInput),
        minRole: "user",
        effect: "read",
        untrustedContent: true,
        run: (input, context) =>
          call(context, `/api/draft?locale=${encodeURIComponent(input.locale ?? locale)}`),
      }),
      defineTool({
        name: "create_plan",
        description: t.create_plan,
        input: newPlanInput,
        inputSchema: schemaOf(newPlanInput),
        minRole: "user",
        effect: "write",
        run: (input, context) => call(context, "/api/plans", { method: "POST", body: input }),
      }),
      defineTool({
        name: "save_plan",
        description: t.save_plan,
        input: savePlanInput,
        inputSchema: schemaOf(savePlanInput),
        minRole: "user",
        effect: "write",
        run: ({ code, ...body }, context) => call(context, plans(code), { method: "PUT", body }),
      }),
      defineTool({
        name: "save_roadmap",
        description: t.save_roadmap,
        input: saveRoadmapInput,
        inputSchema: schemaOf(saveRoadmapInput),
        minRole: "user",
        effect: "write",
        run: ({ code, ...body }, context) => call(context, roadmaps(code), { method: "PUT", body }),
      }),
      defineTool({
        name: "discard_draft",
        description: t.discard_draft,
        input: discardInput,
        inputSchema: schemaOf(discardInput),
        minRole: "user",
        effect: "write",
        run: (input, context) =>
          call(context, "/api/draft/discard", { method: "POST", body: input }),
      }),
      defineTool({
        name: "publish_draft",
        description: t.publish_draft,
        input: publishInput,
        inputSchema: schemaOf(publishInput),
        minRole: "user",
        effect: "publish",
        run: (input, context) =>
          call(context, "/api/draft/publish", { method: "POST", body: input }),
      }),
    ],
  });
}
