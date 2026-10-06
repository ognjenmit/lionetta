import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import type { AgentReply } from "../packages/shared/src/index.js";

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise<void>((done) => server.close(() => done()));
  return address.port;
}

test("local car-search MVP through real HTTP MCP services", { timeout: 60_000 }, async (t) => {
  const [api, inventory, pricing, crm] = await Promise.all([freePort(), freePort(), freePort(), freePort()]);
  assert.ok(api && inventory && pricing && crm);
  const child = spawn(process.execPath, ["scripts/services.mjs", "--dev", "--backend-only", "--no-watch"], {
    env: {
      ...process.env, HOST: "127.0.0.1", LIONETTA_AGENT_MODE: "demo", API_PORT: String(api),
      INVENTORY_PORT: String(inventory), PRICING_PORT: String(pricing), CRM_PORT: String(crm),
      LIONETTA_INVENTORY_URL: `http://127.0.0.1:${inventory}/mcp`,
      LIONETTA_PRICING_URL: `http://127.0.0.1:${pricing}/mcp`,
      LIONETTA_CRM_URL: `http://127.0.0.1:${crm}/mcp`,
    }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  t.after(async () => {
    if (child.exitCode !== null) return;
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    const forced = setTimeout(() => child.kill("SIGKILL"), 7000).unref();
    await exited;
    clearTimeout(forced);
  });
  const base = `http://127.0.0.1:${api}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Stack exited: ${output}`);
    try {
      const results = await Promise.all([fetch(`${base}/ping`), ...[inventory, pricing, crm].map((port) => fetch(`http://127.0.0.1:${port}/health`))]);
      ready = results.every((response) => response.ok);
      await Promise.all(results.map((response) => response.text()));
    } catch { /* Processes are still starting. */ }
    if (ready) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(ready, `Services did not become ready: ${output}`);

  async function invoke(prompt: string, tenantId = "delta-motors", session = "test-session", confirmationId?: string): Promise<AgentReply> {
    const response = await fetch(`${base}/invocations`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": session },
      body: JSON.stringify({ prompt, tenantId, ...(confirmationId ? { confirmationId } : {}) }),
    });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result) + "\n" + output);
    return result as AgentReply;
  }

  await t.test("public tenant configuration exposes no internal server URLs or prompts", async () => {
    const response = await fetch(`${base}/tenants`);
    const data = await response.json() as { tenants: Array<Record<string, unknown>>; mode: string };
    assert.equal(data.mode, "demo");
    assert.equal(data.tenants.length, 2);
    assert.deepEqual(Object.keys(data.tenants[0] ?? {}).sort(), ["brandName", "id", "name", "primaryColor"]);
  });
  await t.test("discovers actual permitted MCP tools", async () => {
    const result = await invoke("integrations");
    assert.match(result.reply, /inventory|search_vehicles/i);
    assert.match(result.reply, /pricing|get_price/i);
    assert.match(result.reply, /crm|create_lead/i);
  });
  await t.test("BMW query uses inventory and pricing and returns three matching cars", async () => {
    const result = await invoke("I want a BMW 3 Series under €25,000, automatic and below 50,000 km.");
    assert.equal(result.mode, "demo");
    assert.equal(result.vehicles.length, 3);
    for (const vehicle of result.vehicles) {
      assert.equal(vehicle.brand, "BMW");
      assert.match(vehicle.model, /3 Series/i);
      assert.ok(vehicle.price < 25_000);
      assert.ok(vehicle.mileage < 50_000);
      assert.equal(vehicle.transmission, "automatic");
    }
    assert.ok(result.toolCalls.some((tool) => tool.name === "inventory.search_vehicles" && tool.status === "success"));
    assert.ok(result.toolCalls.some((tool) => tool.name === "pricing.get_price" && tool.status === "success"));
  });
  await t.test("selected tenant uses a separate fixture inventory", async () => {
    const result = await invoke("Find BMW cars", "northside-motors");
    assert.ok(result.vehicles.length > 0);
    assert.ok(result.vehicles.every((vehicle) => !["bmw-320d-001", "bmw-318i-002", "bmw-320i-003"].includes(vehicle.id)));
  });
  let confirmationId = "";
  await t.test("CRM write remains pending until explicitly confirmed", async () => {
    const before = await invoke("list leads");
    assert.ok(before.toolCalls.some((tool) => tool.name === "crm.list_leads" && tool.status === "success"));
    const pending = await invoke("create lead: Alex | alex@example.com | bmw-320d-001");
    assert.ok(pending.pendingConfirmation);
    assert.equal(pending.pendingConfirmation.toolName, "crm.create_lead");
    confirmationId = pending.pendingConfirmation.id;
    assert.ok(!pending.toolCalls.some((tool) => tool.name === "crm.create_lead" && tool.status === "success"));
    const listed = await invoke("list leads");
    assert.equal(listed.reply, before.reply);
  });
  await t.test("confirmation cannot be used from another session", async () => {
    const result = await invoke("confirm", "delta-motors", "different-session", confirmationId);
    assert.ok(!result.toolCalls.some((tool) => tool.name === "crm.create_lead" && tool.status === "success"));
  });
  await t.test("confirmation executes once and can never be replayed", async () => {
    const result = await invoke("confirm", "delta-motors", "test-session", confirmationId);
    assert.ok(result.toolCalls.some((tool) => tool.name === "crm.create_lead" && tool.status === "success"));
    const replay = await invoke("confirm", "delta-motors", "test-session", confirmationId);
    assert.ok(!replay.toolCalls.some((tool) => tool.name === "crm.create_lead" && tool.status === "success"));
    const listed = await invoke("list leads");
    assert.match(listed.reply, /Alex|alex@example.com/);
  });
  await t.test("a disabled CRM write is rejected for the second tenant", async () => {
    const result = await invoke("create lead: Alex | alex@example.com | bmw-320d-001", "northside-motors");
    assert.equal(result.pendingConfirmation, undefined);
    assert.ok(!result.toolCalls.some((tool) => tool.name === "crm.create_lead" && tool.status === "success"));
    const listed = await invoke("list leads", "northside-motors");
    assert.match(listed.reply, /^There are no leads for this tenant yet\./);
  });
  await t.test("invalid requests are rejected before reaching the agent", async () => {
    const request = (body: string, type = "application/json", session = "valid") => fetch(`${base}/invocations`, {
      method: "POST", headers: { "Content-Type": type, "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": session }, body,
    });
    assert.equal((await request("{")).status, 400);
    assert.equal((await request(JSON.stringify({ prompt: " ", tenantId: "delta-motors" }))).status, 400);
    assert.equal((await request(JSON.stringify({ prompt: "help", tenantId: "missing" }))).status, 404);
    assert.equal((await request(JSON.stringify({ prompt: "help", tenantId: "delta-motors" }), "application/json", "bad session")).status, 400);
    assert.equal((await request("help", "text/plain")).status, 415);
    assert.equal((await request(JSON.stringify({ prompt: "x".repeat(17000), tenantId: "delta-motors" }))).status, 413);
  });
});
