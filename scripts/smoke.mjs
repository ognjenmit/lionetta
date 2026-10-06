import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}
const [web, api, inventory, pricing, crm] = await Promise.all(Array.from({ length: 5 }, () => freePort()));
const child = spawn(process.execPath, ["scripts/services.mjs"], {
  env: {
    ...process.env, HOST: "127.0.0.1", LIONETTA_AGENT_MODE: "demo", WEB_PORT: String(web), API_PORT: String(api),
    INVENTORY_PORT: String(inventory), PRICING_PORT: String(pricing), CRM_PORT: String(crm),
    LIONETTA_INVENTORY_URL: `http://127.0.0.1:${inventory}/mcp`,
    LIONETTA_PRICING_URL: `http://127.0.0.1:${pricing}/mcp`,
    LIONETTA_CRM_URL: `http://127.0.0.1:${crm}/mcp`, API_ORIGIN: `http://127.0.0.1:${api}`,
  }, stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });
const exited = once(child, "exit");
const base = `http://127.0.0.1:${web}`;
const sessionId = randomUUID();
try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Stack exited: ${output}`);
    try {
      const responses = await Promise.all([fetch(`${base}/api/tenants`), ...[inventory, pricing, crm].map((port) => fetch(`http://127.0.0.1:${port}/health`))]);
      ready = responses.every((response) => response.ok);
      await Promise.all(responses.map((response) => response.text()));
    } catch { /* Wait for services to listen. */ }
    if (ready) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(ready, `Stack never became ready: ${output}`);
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Lionetta/);
  const invoke = async (prompt, confirmationId) => {
    const response = await fetch(`${base}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": sessionId },
      body: JSON.stringify({ prompt, tenantId: "delta-motors", ...(confirmationId ? { confirmationId } : {}) }),
    });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return data;
  };
  const search = await invoke("I want a BMW 3 Series under €25,000, automatic and below 50,000 km.");
  assert.equal(search.vehicles.length, 3);
  assert.ok(search.vehicles.every((vehicle) => vehicle.brand === "BMW" && vehicle.price < 25000 && vehicle.mileage < 50000 && vehicle.transmission === "automatic"));
  assert.ok(search.toolCalls.some((tool) => tool.name === "inventory.search_vehicles" && tool.status === "success"));
  assert.ok(search.toolCalls.some((tool) => tool.name === "pricing.get_price" && tool.status === "success"));
  const pending = await invoke("create lead: Alex | alex@example.com | bmw-320d-001");
  assert.ok(pending.pendingConfirmation?.id);
  const confirmed = await invoke("confirm", pending.pendingConfirmation.id);
  assert.ok(confirmed.toolCalls.some((tool) => tool.name === "crm.create_lead" && tool.status === "success"));
  console.log("Smoke passed: compiled Next UI/proxy, API, three real MCP services, BMW search/prices, and confirmed CRM write.");
} finally {
  child.kill("SIGTERM");
  const forced = setTimeout(() => child.kill("SIGKILL"), 7000).unref();
  await exited;
  clearTimeout(forced);
}
