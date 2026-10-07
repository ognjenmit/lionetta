import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { afterEach, mock, test } from "node:test";
import { McpRouter } from "../../mcp-client/src/index.js";
import type { DiscoveredTool, TenantConfig, Vehicle } from "../../shared/src/index.js";
import { LionettaAgent } from "../src/index.js";
import { parseVehicleSearch } from "../src/search-parser.js";

afterEach(() => mock.restoreAll());

function tenant(id = "delta-motors"): TenantConfig {
  return {
    id, name: "Demo Motors", brandName: "Demo Advisor", primaryColor: "#123456",
    systemPrompt: "Find fixture cars using the available tools.", model: "test-model", mcpServers: [],
  };
}

function tool(name: string, requiresConfirmation = false): DiscoveredTool {
  const [serverId, originalName] = name.split(".");
  assert.ok(serverId && originalName);
  return { name, serverId, originalName, description: "A local fixture tool", requiresConfirmation,
    inputSchema: { type: "object", properties: { brand: { type: "string" } } } };
}

const fixture: Vehicle = {
  id: "bmw-320d-001", brand: "BMW", model: "3 Series 320d", price: 23900, mileage: 32000,
  transmission: "automatic", fuel: "diesel", year: 2021, url: "https://example.invalid/vehicles/bmw-320d-001",
};

test("the requested BMW example uses all filters without confusing mileage and price", () => {
  assert.deepEqual(parseVehicleSearch("I want a BMW 3 Series under €25,000, automatic and below 50,000 km."), {
    brand: "BMW", model: "3 Series", transmission: "automatic", max_price: 25000, max_mileage: 50000,
  });
  assert.deepEqual(parseVehicleSearch("cars below 50,000 km"), { max_mileage: 50000 });
  assert.deepEqual(parseVehicleSearch("BMW under 25k manual"), { brand: "BMW", transmission: "manual", max_price: 25000 });
  assert.deepEqual(parseVehicleSearch("cars under €25.000 and under 50.000 km"), { max_price: 25000, max_mileage: 50000 });
});

test("the demo queries discovered inventory and pricing rather than inventing cars", async () => {
  mock.method(McpRouter.prototype, "discover", async () => [tool("cars.search_vehicles"), tool("quotes.get_price")]);
  const calls = mock.method(McpRouter.prototype, "callTool", async (name: string, args: Record<string, unknown>) => ({
    data: name === "cars.search_vehicles" ? { vehicles: [fixture] } : { vehicle_id: fixture.id, price: 23500, currency: "EUR" },
    trace: { name, serverId: name.split(".")[0]!, status: "success" as const, arguments: args },
  }));
  const agent = new LionettaAgent([tenant()]);
  const result = await agent.invoke({ tenantId: "delta-motors", sessionId: "demo", prompt: "BMW 3 Series under €25,000 automatic below 50,000 km" });
  assert.equal(result.vehicles[0]?.price, 23500);
  assert.deepEqual(calls.mock.calls.map((call) => call.arguments[0]), ["cars.search_vehicles", "quotes.get_price"]);
  assert.deepEqual(calls.mock.calls[0]?.arguments[1], { brand: "BMW", model: "3 Series", transmission: "automatic", max_price: 25000, max_mileage: 50000 });
  await agent.close();
});

test("confirmation is tenant/session-bound, one-time, and never accepts replacement arguments", async () => {
  mock.method(McpRouter.prototype, "discover", async () => [tool("crm.create_lead", true)]);
  const calls = mock.method(McpRouter.prototype, "callTool", async (name: string, args: Record<string, unknown>) => ({
    data: { lead: args }, trace: { name, serverId: "crm", status: "success" as const, arguments: args },
  }));
  const agent = new LionettaAgent([tenant(), tenant("northside-motors")]);
  const pending = await agent.invoke({ tenantId: "delta-motors", sessionId: "a", prompt: "create lead: Alex | alex@example.com | bmw-320d-001" });
  const confirmationId = pending.pendingConfirmation?.id;
  assert.ok(confirmationId);
  if (pending.pendingConfirmation) pending.pendingConfirmation.arguments.name = "Changed outside agent";
  assert.equal(calls.mock.callCount(), 0);
  for (const [tenantId, sessionId] of [["delta-motors", "b"], ["northside-motors", "a"]]) {
    assert.ok(tenantId && sessionId);
    const denied = await agent.invoke({ tenantId, sessionId, confirmationId, prompt: "Confirm" });
    assert.match(denied.reply, /invalid, expired, or belongs/);
  }
  assert.equal(calls.mock.callCount(), 0);
  const confirmed = await agent.invoke({ tenantId: "delta-motors", sessionId: "a", confirmationId, prompt: "create lead: Mallory | mallory@example.com | different-car" });
  assert.match(confirmed.reply, /Created lead for Alex/);
  assert.deepEqual(calls.mock.calls[0]?.arguments[1], { name: "Alex", email: "alex@example.com", vehicle_id: "bmw-320d-001" });
  assert.deepEqual(calls.mock.calls[0]?.arguments[2], { confirmationGranted: true });
  const replay = await agent.invoke({ tenantId: "delta-motors", sessionId: "a", confirmationId, prompt: "Confirm" });
  assert.match(replay.reply, /invalid, expired, or belongs/);
  assert.equal(calls.mock.callCount(), 1);
  await agent.close();
});

test("any policy-marked tool pauses for confirmation, including a read tool", async () => {
  mock.method(McpRouter.prototype, "discover", async () => [tool("crm.list_leads", true)]);
  const calls = mock.method(McpRouter.prototype, "callTool", async () => { throw new Error("Must not execute before confirmation"); });
  const agent = new LionettaAgent([tenant()]);
  const response = await agent.invoke({ tenantId: "delta-motors", sessionId: "a", prompt: "list leads" });
  assert.equal(response.pendingConfirmation?.toolName, "crm.list_leads");
  assert.equal(response.toolCalls[0]?.status, "confirmation_required");
  assert.equal(calls.mock.callCount(), 0);
  await agent.close();
});

interface ModelRequest {
  messages: Array<{ role: string; content?: string }>;
  tools: Array<{ function: { name: string; parameters: Record<string, unknown> } }>;
}

async function fakeModel(replies: unknown[], status = 200): Promise<{ server: Server; url: string; requests: ModelRequest[] }> {
  const requests: ModelRequest[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push(JSON.parse(Buffer.concat(chunks).toString()) as ModelRequest);
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(status === 200
        ? { id: "test-completion", object: "chat.completion", created: 0, model: "test-model",
          choices: [{ index: 0, finish_reason: "stop", message: replies[requests.length - 1] }] }
        : { error: typeof replies[0] === "object" && replies[0] !== null ? replies[0] : { message: replies[0], type: "invalid_api_key" } }));
    })().catch(() => { response.writeHead(500); response.end(); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, url: `http://127.0.0.1:${address.port}/v1`, requests };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); });
}

test("OpenAI mode routes dynamically discovered tools and carries model history per tenant/session", async () => {
  mock.method(McpRouter.prototype, "discover", async () => [tool("cars.search_vehicles"), tool("quotes.get_price")]);
  const calls = mock.method(McpRouter.prototype, "callTool", async (name: string, args: Record<string, unknown>) => ({
    data: name === "cars.search_vehicles" ? { vehicles: [fixture] } : { vehicle_id: fixture.id, price: 23500 },
    trace: { name, serverId: name.split(".")[0]!, status: "success" as const, arguments: args },
  }));
  const provider = await fakeModel([
    { role: "assistant", content: null, tool_calls: [{ id: "search", type: "function", function: { name: "mcp_0_cars_search_vehicles", arguments: '{"brand":"BMW"}' } }] },
    { role: "assistant", content: null, tool_calls: [{ id: "price", type: "function", function: { name: "mcp_1_quotes_get_price", arguments: '{"vehicle_id":"bmw-320d-001"}' } }] },
    { role: "assistant", content: "I found a BMW 320d for €23,500." },
    { role: "assistant", content: "It has 32,000 km." },
    { role: "assistant", content: "A fresh conversation." },
  ]);
  const agent = new LionettaAgent([tenant(), tenant("northside-motors")], { mode: "openai", apiKey: "local-test-key", baseURL: provider.url });
  try {
    const result = await agent.invoke({ tenantId: "delta-motors", sessionId: "a", prompt: "Find me a BMW." });
    assert.equal(result.mode, "openai");
    assert.equal(result.vehicles[0]?.price, 23500);
    assert.deepEqual(calls.mock.calls.map((call) => call.arguments[0]), ["cars.search_vehicles", "quotes.get_price"]);
    assert.ok(provider.requests[0]?.tools.every((entry) => /^[\w-]{1,64}$/.test(entry.function.name)));
    await agent.invoke({ tenantId: "delta-motors", sessionId: "a", prompt: "What is its mileage?" });
    assert.ok(provider.requests[3]?.messages.some((message) => message.content === "Find me a BMW."));
    await agent.invoke({ tenantId: "northside-motors", sessionId: "a", prompt: "Hello" });
    assert.equal(provider.requests[4]?.messages.some((message) => message.content === "Find me a BMW."), false);
  } finally { await agent.close(); await closeServer(provider.server); }
});

test("model-proposed writes still require confirmation before MCP execution", async () => {
  mock.method(McpRouter.prototype, "discover", async () => [tool("crm.create_lead", true)]);
  const calls = mock.method(McpRouter.prototype, "callTool", async () => { throw new Error("A proposed write must not execute"); });
  const provider = await fakeModel([
    { role: "assistant", content: null, tool_calls: [{ id: "lead", type: "function", function: { name: "mcp_0_crm_create_lead", arguments: '{"name":"Alex","email":"alex@example.com","vehicle_id":"bmw-320d-001","tenant_id":"spoof"}' } }] },
  ]);
  const agent = new LionettaAgent([tenant()], { mode: "openai", apiKey: "local-test-key", baseURL: provider.url });
  try {
    const result = await agent.invoke({ tenantId: "delta-motors", sessionId: "a", prompt: "Create a lead" });
    assert.equal(result.pendingConfirmation?.toolName, "crm.create_lead");
    assert.equal(result.pendingConfirmation?.arguments.tenant_id, undefined);
    assert.equal(calls.mock.callCount(), 0);
    assert.equal(result.toolCalls[0]?.status, "confirmation_required");
  } finally { await agent.close(); await closeServer(provider.server); }
});

test("model provider errors report status without exposing provider error text", async () => {
  const provider = await fakeModel(["Invalid key: sk-provider-echo"], 401);
  const agent = new LionettaAgent([tenant()], { mode: "openai", apiKey: "local-test-key", baseURL: provider.url });
  try {
    const result = await agent.invoke({ tenantId: "delta-motors", sessionId: "a", prompt: "Hello" });
    assert.match(result.reply, /HTTP 401/);
    assert.doesNotMatch(result.reply, /sk-provider-echo/);
  } finally { await agent.close(); await closeServer(provider.server); }
});

for (const scenario of [
  { name: "quota code", code: "insufficient_quota", type: "insufficient_quota", expected: /insufficient_quota.*API credits/ },
  { name: "quota type without code", code: undefined, type: "insufficient_quota", expected: /insufficient_quota.*API credits/ },
  { name: "billing limit", code: "billing_hard_limit_reached", type: "billing_error", expected: /billing_hard_limit_reached.*spending limits/ },
  { name: "rate limit", code: "rate_limit_exceeded", type: "tokens", expected: /rate_limit_exceeded.*Wait briefly/ },
  { name: "unknown code", code: "sk-hidden-code", type: "sk-hidden-type", expected: /HTTP 429.*credits.*rate limits/ },
]) {
  test(`OpenAI 429 ${scenario.name} gives safe and actionable guidance`, async () => {
    const provider = await fakeModel([{ code: scenario.code, type: scenario.type, message: "Private provider text sk-provider-echo" }], 429);
    const agent = new LionettaAgent([tenant()], { mode: "openai", apiKey: "local-test-key", baseURL: provider.url });
    try {
      const result = await agent.invoke({ tenantId: "delta-motors", sessionId: "a", prompt: "Show one BMW" });
      assert.match(result.reply, scenario.expected);
      assert.doesNotMatch(result.reply, /sk-provider-echo|sk-hidden-code|sk-hidden-type|Private provider text/);
    } finally { await agent.close(); await closeServer(provider.server); }
  });
}

test("the model tool loop stops after eight rounds", async () => {
  mock.method(McpRouter.prototype, "discover", async () => [tool("inventory.search_vehicles")]);
  const calls = mock.method(McpRouter.prototype, "callTool", async (name: string) => ({
    data: { vehicles: [] }, trace: { name, serverId: "inventory", status: "success" as const },
  }));
  const provider = await fakeModel(Array.from({ length: 8 }, (_, index) => ({
    role: "assistant", content: null, tool_calls: [{ id: `search-${index}`, type: "function",
      function: { name: "mcp_0_inventory_search_vehicles", arguments: "{}" } }],
  })));
  const agent = new LionettaAgent([tenant()], { mode: "openai", apiKey: "local-test-key", baseURL: provider.url });
  try {
    const result = await agent.invoke({ tenantId: "delta-motors", sessionId: "a", prompt: "Find cars" });
    assert.equal(calls.mock.callCount(), 8);
    assert.equal(provider.requests.length, 8);
    assert.match(result.reply, /reached its tool limit/);
  } finally { await agent.close(); await closeServer(provider.server); }
});
