import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { afterEach, mock, test } from "node:test";
import { LionettaAgent } from "../src/index.js";
import { McpRouter } from "../../mcp-client/src/index.js";
import type { DiscoveredTool, TenantConfig } from "../../shared/src/index.js";
afterEach(() => mock.restoreAll());
const tenant = (id = "delta-motors"): TenantConfig => ({ id, name: id, brandName: "Demo Advisor", primaryColor: "#123456", systemPrompt: "Use fictional local sources.", model: "unused-openai-model", mcpServers: [] });
const tool = (name: string, requiresConfirmation = false): DiscoveredTool => ({ name, serverId: name.split(".")[0]!, originalName: name.split(".")[1]!, description: "A local tool", inputSchema: { type: "object", properties: {} }, requiresConfirmation });
const text = (value: string) => ({ type: "text", text: value });
const call = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input });
interface Request { model: string; system: string; messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>; tools?: Array<{ name: string; input_schema: Record<string, unknown> }> }
async function provider(replies: unknown[][], status = 200) {
  const requests: Request[] = [];
  const server = createServer((req, res) => { void (async () => {
    assert.equal(req.url, "/v1/messages"); assert.equal(req.headers["x-api-key"], "local-dummy-key");
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()) as Request; requests.push(body);
    const content = replies[requests.length - 1] ?? [];
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(status === 200 ? { id: `msg_${requests.length}`, type: "message", role: "assistant", model: body.model, content,
      stop_reason: content.some(block => (block as {type:string}).type === "tool_use") ? "tool_use" : "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }
      : { type: "error", error: { type: "authentication_error", message: "Bad secret sk-ant-provider-echo" } }));
  })().catch(() => { res.writeHead(500); res.end(); }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  return { server, requests, url: `http://127.0.0.1:${address.port}` };
}
async function close(server: Server) { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); }

test("Claude uses the native tool protocol and retains source results only in the tenant/session history", async () => {
  mock.method(McpRouter.prototype, "discover", async () => [tool("inventory.search_products"), tool("pricing.quote_bulk_order")]);
  const calls = mock.method(McpRouter.prototype, "callTool", async (name: string) => ({ trace: { name, serverId: name.split(".")[0], status: "success" },
    data: name.startsWith("inventory") ? { products: [{ id: "chair", name: "Chair", unitPrice: 145, stock: 1500, minimumOrderQuantity: 25, leadTimeDays: 10, specifications: { material: "mesh" } }] } : { product_id: "chair", quantity: 500, unit_price: 105, total: 63150, demo: true } }));
  const fake = await provider([[call("search", "mcp_0_inventory_search_products", { quantity: 500 })],
    [call("quote", "mcp_1_pricing_quote_bulk_order", { product_id: "chair", quantity: 500 })], [text("500 chairs cost €63,150 with VAT and delivery.")],
    [text("The chairs have mesh material.")], [text("A different tenant.")], [text("A different session.")]]);
  const agent = new LionettaAgent([tenant(), tenant("atlas-wholesale")], { mode: "anthropic", apiKey: "local-dummy-key", baseURL: fake.url });
  try {
    const result = await agent.invoke({ tenantId: "delta-motors", sessionId: "a", prompt: "Find 500 chairs." });
    assert.equal(result.mode, "anthropic"); assert.equal(result.products.length, 1); assert.equal(result.quotes[0]?.total, 63150);
    assert.equal(calls.mock.callCount(), 2); assert.equal(fake.requests[0]?.model, "claude-sonnet-4-6");
    assert.ok(fake.requests[0]?.tools?.every(entry => /^[\w-]{1,64}$/.test(entry.name)));
    assert.ok(fake.requests[1]?.messages.some(message => Array.isArray(message.content) && message.content.some(block => block.type === "tool_result" && String(block.content).includes("mesh"))));
    await agent.invoke({ tenantId: "delta-motors", sessionId: "a", prompt: "What material are they?" });
    assert.ok(JSON.stringify(fake.requests[3]?.messages).includes("mesh"));
    await agent.invoke({ tenantId: "atlas-wholesale", sessionId: "a", prompt: "Hello" });
    await agent.invoke({ tenantId: "delta-motors", sessionId: "b", prompt: "Hello" });
    assert.equal(JSON.stringify(fake.requests[4]?.messages).includes("mesh"), false);
    assert.equal(JSON.stringify(fake.requests[5]?.messages).includes("mesh"), false);
  } finally { await agent.close(); await close(fake.server); }
});

test("Claude proposals pause the whole tool group until one-time confirmation and preserve the confirmed result", async () => {
  mock.method(McpRouter.prototype, "discover", async () => [tool("crm.request_quote"), tool("inventory.search_products")]);
  const calls = mock.method(McpRouter.prototype, "callTool", async (name: string, args: Record<string, unknown>) => ({ data: { request: { ...args, id: "request-1" } }, trace: { name, serverId: "crm", status: "success" } }));
  const fake = await provider([[call("write", "mcp_0_crm_request_quote", { tenant_id: "spoof", company: "Acme", name: "Maya", email: "maya@example.com", product_id: "chair", quantity: 500 }),
    call("later", "mcp_1_inventory_search_products", {})], [text("Your demo request was saved.")]]);
  const agent = new LionettaAgent([tenant()], { mode: "anthropic", apiKey: "local-dummy-key", baseURL: fake.url });
  try {
    const pending = await agent.invoke({ tenantId: "delta-motors", sessionId: "a", prompt: "Request a quote" });
    assert.equal(pending.pendingConfirmation?.toolName, "crm.request_quote"); assert.equal(pending.pendingConfirmation?.arguments.tenant_id, undefined);
    assert.equal(calls.mock.callCount(), 0);
    const confirmationId = pending.pendingConfirmation!.id;
    await agent.invoke({ tenantId: "delta-motors", sessionId: "wrong", prompt: "confirm", confirmationId }); assert.equal(calls.mock.callCount(), 0);
    const confirmed = await agent.invoke({ tenantId: "delta-motors", sessionId: "a", prompt: "confirm", confirmationId });
    assert.match(confirmed.reply, /request-1/); assert.equal(calls.mock.callCount(), 1);
    assert.deepEqual(calls.mock.calls[0]?.arguments[2], { confirmationGranted: true });
    await agent.invoke({ tenantId: "delta-motors", sessionId: "a", prompt: "confirm", confirmationId }); assert.equal(calls.mock.callCount(), 1);
    await agent.invoke({ tenantId: "delta-motors", sessionId: "a", prompt: "What happened?" });
    assert.ok(JSON.stringify(fake.requests[1]?.messages).includes("request-1"));
    const results = fake.requests[1]?.messages.find(message => Array.isArray(message.content) && message.content.some(block => block.type === "tool_result"));
    assert.equal((results?.content as unknown[])?.length, 2, "Every proposed tool needs a protocol result even when paused");
  } finally { await agent.close(); await close(fake.server); }
});

test("Claude authentication failures are sanitized and never expose provider text", async () => {
  const fake = await provider([[]], 401);
  const agent = new LionettaAgent([tenant()], { mode: "anthropic", apiKey: "local-dummy-key", baseURL: fake.url });
  try { const response = await agent.invoke({ tenantId: "delta-motors", sessionId: "a", prompt: "Hello" });
    assert.match(response.reply, /HTTP 401/); assert.doesNotMatch(response.reply, /sk-ant-provider-echo/);
  } finally { await agent.close(); await close(fake.server); }
});

test("Claude requires a local API key and limits repeated tool rounds", async () => {
  assert.throws(() => new LionettaAgent([tenant()], { mode: "anthropic" }), /ANTHROPIC_API_KEY/);
  mock.method(McpRouter.prototype, "discover", async () => [tool("inventory.search_products")]);
  const calls = mock.method(McpRouter.prototype, "callTool", async (name: string) => ({ data: { products: [] }, trace: { name, serverId: "inventory", status: "success" } }));
  const fake = await provider(Array.from({ length: 8 }, (_, index) => [call(`search-${index}`, "mcp_0_inventory_search_products", {})]));
  const agent = new LionettaAgent([tenant()], { mode: "anthropic", apiKey: "local-dummy-key", baseURL: fake.url });
  try { const response = await agent.invoke({ tenantId: "delta-motors", sessionId: "a", prompt: "Search" });
    assert.equal(calls.mock.callCount(), 8); assert.equal(fake.requests.length, 8); assert.match(response.reply, /tool limit/);
  } finally { await agent.close(); await close(fake.server); }
});
