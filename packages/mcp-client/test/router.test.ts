import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { TenantConfig } from "../../shared/src/index.js";
import { McpRouter, McpToolError } from "../src/index.js";

afterEach(() => mock.restoreAll());

function tenant(): TenantConfig {
  return {
    id: "tenant-a",
    name: "Tenant A",
    brandName: "Demo Motors",
    primaryColor: "#111111",
    systemPrompt: "Help buyers find vehicles.",
    model: "demo",
    mcpServers: [{
      id: "inventory",
      name: "Inventory",
      url: "http://localhost:8001/mcp",
      enabled: true,
      tools: [
        { name: "search_vehicles", enabled: true, requiresConfirmation: false },
        { name: "create_lead", enabled: true, requiresConfirmation: true },
        { name: "delete_vehicle", enabled: false, requiresConfirmation: true },
      ],
    }],
  };
}

const schema = {
  type: "object" as const,
  properties: { tenant_id: { type: "string" }, brand: { type: "string" } },
  required: ["tenant_id"],
};

function fakeClient() {
  mock.method(Client.prototype, "connect", async () => undefined);
  mock.method(Client.prototype, "close", async () => undefined);
  mock.method(Client.prototype, "listTools", async () => ({
    tools: ["search_vehicles", "create_lead", "delete_vehicle", "unconfigured_tool"].map((name) => ({
      name,
      description: `Tool ${name}`,
      inputSchema: schema,
    })),
  }));
  return mock.method(Client.prototype, "callTool", async () => ({
    content: [{ type: "text", text: '{"ignored":true}' }],
    structuredContent: { vehicles: [{ id: "car-1" }] },
  }));
}

test("discovers only explicit enabled tools and hides backend tenant scope", async () => {
  fakeClient();
  const router = new McpRouter(tenant());
  const tools = await router.discover();
  assert.deepEqual(tools.map(({ name }) => name), ["inventory.search_vehicles", "inventory.create_lead"]);
  assert.deepEqual(tools[0]?.inputSchema.properties, { brand: { type: "string" } });
  assert.deepEqual(tools[0]?.inputSchema.required, []);
  assert.ok(schema.properties.tenant_id, "discovery must preserve the server's original schema");
  await router.close();
});

test("injects the actual tenant and prefers structured results with safe traces", async () => {
  const calls = fakeClient();
  const router = new McpRouter(tenant());
  const result = await router.callTool("inventory.search_vehicles", {
    tenant_id: "tenant-b",
    brand: "BMW",
    api_key: "test-sensitive-value",
  });
  assert.equal(calls.mock.callCount(), 1);
  assert.deepEqual(calls.mock.calls[0]?.arguments[0], {
    name: "search_vehicles",
    arguments: { tenant_id: "tenant-a", brand: "BMW", api_key: "test-sensitive-value" },
  });
  assert.deepEqual(result.data, { vehicles: [{ id: "car-1" }] });
  assert.deepEqual(result.trace.arguments, { brand: "BMW", api_key: "[redacted]" });
  assert.equal(result.trace.status, "success");
  await router.close();
});

test("a confirmation policy blocks writes until confirmation is explicitly granted", async () => {
  const calls = fakeClient();
  const router = new McpRouter(tenant());
  await assert.rejects(router.callTool("inventory.create_lead", { name: "Buyer" }), (error: unknown) => {
    assert.ok(error instanceof McpToolError);
    assert.equal(error.trace.status, "confirmation_required");
    return true;
  });
  assert.equal(calls.mock.callCount(), 0);
  await router.callTool("inventory.create_lead", { name: "Buyer" }, { confirmationGranted: true });
  assert.equal(calls.mock.callCount(), 1);
  await router.close();
});

test("removed or disabled permission blocks a previously discovered tool", async () => {
  const calls = fakeClient();
  const config = tenant();
  const router = new McpRouter(config);
  await router.discover();
  config.mcpServers[0]!.tools = [];
  await assert.rejects(router.callTool("inventory.search_vehicles", {}), McpToolError);
  assert.equal(calls.mock.callCount(), 0);
  await router.close();
});

test("disabled servers remain blocked even when confirmation is granted", async () => {
  const calls = fakeClient();
  const config = tenant();
  const router = new McpRouter(config);
  await router.discover();
  config.mcpServers[0]!.enabled = false;
  await assert.rejects(router.callTool("inventory.create_lead", {}, { confirmationGranted: true }), McpToolError);
  assert.equal(calls.mock.callCount(), 0);
  await router.close();
});

test("an incomplete runtime permission fails closed", async () => {
  const calls = fakeClient();
  const config = tenant();
  const permission = config.mcpServers[0]!.tools[0]!;
  delete (permission as Partial<typeof permission>).requiresConfirmation;
  const router = new McpRouter(config);
  const tools = await router.discover();
  assert.ok(!tools.some(({ name }) => name === "inventory.search_vehicles"));
  await assert.rejects(router.callTool("inventory.search_vehicles", {}), McpToolError);
  assert.equal(calls.mock.callCount(), 0);
  await router.close();
});

test("MCP isError is retained as a controlled failure instead of successful data", async () => {
  fakeClient();
  mock.method(Client.prototype, "callTool", async () => ({
    isError: true,
    content: [{ type: "text", text: "Denied" }],
    structuredContent: { reason: "tenant denied" },
  }));
  const router = new McpRouter(tenant());
  await assert.rejects(router.callTool("inventory.search_vehicles", {}), (error: unknown) => {
    assert.ok(error instanceof McpToolError);
    assert.equal(error.trace.status, "error");
    assert.deepEqual(error.data, { reason: "tenant denied" });
    return true;
  });
  await router.close();
});

test("supports JSON text results when structured output is unavailable", async () => {
  fakeClient();
  mock.method(Client.prototype, "callTool", async () => ({
    content: [{ type: "text", text: '{"vehicles":[{"id":"car-2"}]}' }],
  }));
  const router = new McpRouter(tenant());
  const result = await router.callTool("inventory.search_vehicles", {});
  assert.deepEqual(result.data, { vehicles: [{ id: "car-2" }] });
  await router.close();
});

test("rejects unconfigured server tools even if the server advertises them", async () => {
  const calls = fakeClient();
  const router = new McpRouter(tenant());
  await assert.rejects(router.callTool("inventory.unconfigured_tool", {}), McpToolError);
  assert.equal(calls.mock.callCount(), 0);
  await router.close();
});

test("discovers all tool pages and fails closed on repeated pagination cursors", async () => {
  fakeClient();
  let page = 0;
  mock.method(Client.prototype, "listTools", async () => {
    page += 1;
    return page === 1
      ? { tools: [], nextCursor: "page-2" }
      : { tools: [{ name: "search_vehicles", inputSchema: schema }] };
  });
  const router = new McpRouter(tenant());
  assert.deepEqual((await router.discover()).map(({ name }) => name), ["inventory.search_vehicles"]);
  mock.method(Client.prototype, "listTools", async () => ({ tools: [], nextCursor: "repeated" }));
  await assert.rejects(router.discover(), /Could not discover tools/);
  await router.close();
});
