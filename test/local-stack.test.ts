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
    assert.equal(data.tenants.length, 4);
    assert.deepEqual(Object.keys(data.tenants[0] ?? {}).sort(), ["brandName", "domain", "id", "name", "primaryColor"]);
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
  await t.test("expanded vehicle specifications and tenant knowledge are available through MCP", async () => {
    const cars = await invoke("Show electric cars");
    const article = await invoke("knowledge: warranty inspection");
    assert.ok(cars.vehicles.some(vehicle => vehicle.features?.length && vehicle.serviceHistory));
    assert.ok(cars.vehicles.length >= 3 && cars.vehicles.every(vehicle => vehicle.fuel === "electric"));
    assert.match(article.reply, /12-month demo dealer warranty/);
  });
  await t.test("real estate filters location, budget, bedrooms and parking and estimates purchase costs", async () => {
    const result = await invoke("Find apartments for sale in Belgrade under €250,000 with at least 2 bedrooms and parking. Compare neighborhoods and estimate upfront buying costs.", "haven-estates");
    assert.equal(result.properties.length, 3); assert.equal(result.vehicles.length, 0); assert.equal(result.quotes.length, 3);
    assert.ok(result.properties.every(property => property.city === "Belgrade" && property.price < 250000 && property.bedrooms >= 2 && property.features.includes("Parking")));
    assert.equal(result.quotes.find(quote => quote.property_id === "belgrade-riverside-201")?.estimated_upfront_total, 229655);
    const forbidden = await invoke("create lead: Alex | alex@example.com | bmw-320d-001", "haven-estates");
    assert.equal(forbidden.pendingConfirmation, undefined);
    const tools = await invoke("integrations", "haven-estates"); assert.doesNotMatch(tools.reply, /search_vehicles|create_lead/);
  });
  await t.test("B2B enforces stock/MOQ and applies real quantity tiers, VAT and delivery", async () => {
    const result = await invoke("We need 500 office chairs. Compare quantity prices and delivery.", "atlas-wholesale");
    assert.equal(result.products.length, 2); assert.equal(result.quotes.length, 2); assert.equal(result.properties.length, 0);
    const quote = result.quotes.find(row => row.product_id === "ergonomic-chair-pro");
    assert.equal(quote?.unit_price, 105); assert.equal(quote?.subtotal, 52500); assert.equal(quote?.vat, 10525); assert.equal(quote?.total, 63150);
    const noStock = await invoke("We need 10000 office chairs", "atlas-wholesale"); assert.equal(noStock.products.length, 0);
    const belowMoq = await invoke("bulk quote: ergonomic-chair-pro | 1", "atlas-wholesale"); assert.ok(belowMoq.toolCalls.some(tool => tool.status === "error"));
    const crossTenant = await invoke("bulk quote: bmw-320d-001 | 500", "atlas-wholesale"); assert.ok(crossTenant.toolCalls.some(tool => tool.status === "error"));
  });
  await t.test("viewing and quote requests are confirmed, stored separately, and never booked or ordered externally", async () => {
    const viewing = await invoke("request viewing: Maya | maya@example.com | belgrade-riverside-201 | 2026-11-12 14:00 Europe/Belgrade", "haven-estates");
    assert.equal(viewing.pendingConfirmation?.toolName, "crm.request_viewing");
    const before = await invoke("list requests", "haven-estates"); assert.match(before.reply, /\[\]/);
    const confirmed = await invoke("confirm", "haven-estates", "test-session", viewing.pendingConfirmation!.id);
    assert.ok(confirmed.toolCalls.some(tool => tool.name === "crm.request_viewing" && tool.status === "success"));
    const replay = await invoke("confirm", "haven-estates", "test-session", viewing.pendingConfirmation!.id); assert.equal(replay.toolCalls.length, 0);
    const quote = await invoke("request quote: Acme | Maya | maya@example.com | ergonomic-chair-pro | 500", "atlas-wholesale");
    assert.equal(quote.pendingConfirmation?.toolName, "crm.request_quote");
    const denied = await invoke("confirm", "haven-estates", "test-session", quote.pendingConfirmation!.id); assert.equal(denied.toolCalls.length, 0);
    await invoke("confirm", "atlas-wholesale", "test-session", quote.pendingConfirmation!.id);
    const estateRecords = await invoke("list requests", "haven-estates"); assert.match(estateRecords.reply, /belgrade-riverside-201/); assert.doesNotMatch(estateRecords.reply, /ergonomic-chair-pro/);
    const businessRecords = await invoke("list requests", "atlas-wholesale"); assert.match(businessRecords.reply, /ergonomic-chair-pro/); assert.doesNotMatch(businessRecords.reply, /belgrade-riverside-201/);
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
