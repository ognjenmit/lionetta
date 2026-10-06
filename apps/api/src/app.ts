import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AgentInput, AgentReply, TenantConfig } from "../../../packages/shared/src/index.js";

export interface AgentService {
  invoke(input: AgentInput): Promise<AgentReply>;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const bodySchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  tenantId: z.string().min(1).max(64),
  confirmationId: z.string().min(1).max(256).optional(),
}).strict();

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function body(request: IncomingMessage): Promise<z.infer<typeof bodySchema>> {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) throw new HttpError(415, "Use Content-Type: application/json.");
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 16 * 1024) throw new HttpError(413, "Request body exceeds 16 KiB.");
    chunks.push(buffer);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new HttpError(400, "Request body must be valid JSON."); }
  const result = bodySchema.safeParse(parsed);
  if (!result.success) throw new HttpError(400, "Provide tenantId and a prompt of 1–4000 characters; confirmationId is optional.");
  return result.data;
}

export function createApp(agent: AgentService, tenants: TenantConfig[], mode: "demo" | "openai") {
  let activeRequests = 0;
  const server = createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    const path = request.url?.split("?")[0];
    try {
      if (request.method === "GET" && path === "/ping") {
        json(response, 200, { status: activeRequests ? "HealthyBusy" : "Healthy", time_of_last_update: Math.floor(Date.now() / 1000) });
      } else if (request.method === "GET" && path === "/tenants") {
        json(response, 200, { mode, tenants: tenants.map(({ id, name, brandName, primaryColor }) => ({ id, name, brandName, primaryColor })) });
      } else if (request.method === "POST" && path === "/invocations") {
        const input = await body(request);
        if (!tenants.some((tenant) => tenant.id === input.tenantId)) throw new HttpError(404, "Unknown tenant.");
        const header = request.headers["x-amzn-bedrock-agentcore-runtime-session-id"];
        if (Array.isArray(header) || (header !== undefined && !/^[a-zA-Z0-9_-]{1,256}$/.test(header))) throw new HttpError(400, "Invalid session ID.");
        const invocation: AgentInput = { prompt: input.prompt, tenantId: input.tenantId, sessionId: header ?? randomUUID() };
        if (input.confirmationId !== undefined) invocation.confirmationId = input.confirmationId;
        activeRequests += 1;
        try { json(response, 200, await agent.invoke(invocation)); }
        finally { activeRequests -= 1; }
      } else json(response, 404, { error: "Route not found." });
    } catch (error) {
      if (error instanceof HttpError) json(response, error.status, { error: error.message });
      else {
        // Keep credentials and prompts out of logs. Detailed errors stay in the local request response only when safe.
        console.error("Agent request failed:", error instanceof Error ? error.name : "Unknown error");
        json(response, 502, { error: "The agent or an MCP service failed. Check that all local services are running." });
      }
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return server;
}
