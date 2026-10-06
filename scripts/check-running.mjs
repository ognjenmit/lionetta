import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const web = `http://127.0.0.1:${process.env.WEB_PORT ?? 3000}`;
const api = `http://127.0.0.1:${process.env.API_PORT ?? 8080}`;
const timeout = () => AbortSignal.timeout(10_000);
const health = await fetch(`${api}/ping`, { signal: timeout() });
assert.ok(health.ok, "API health request failed");
assert.match((await health.json()).status, /^Healthy(?:Busy)?$/);
for (const port of [process.env.INVENTORY_PORT ?? 8001, process.env.PRICING_PORT ?? 8002, process.env.CRM_PORT ?? 8003]) {
  const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: timeout() });
  assert.ok(response.ok, `MCP health failed on port ${port}`);
  assert.equal((await response.json()).status, "ok");
}
const page = await fetch(web, { signal: timeout() });
assert.ok(page.ok, "Next.js page failed");
assert.match(await page.text(), /Lionetta/);
const response = await fetch(`${web}/api/chat`, {
  method: "POST", signal: AbortSignal.timeout(60_000),
  headers: { "Content-Type": "application/json", "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": randomUUID() },
  body: JSON.stringify({ tenantId: "delta-motors", prompt: "I want a BMW 3 Series under €25,000, automatic and below 50,000 km." }),
});
assert.ok(response.ok, "Chat proxy request failed");
const result = await response.json();
assert.equal(result.vehicles?.length, 3, "Expected three matching fixture vehicles");
assert.ok(result.vehicles.every((vehicle) => vehicle.brand === "BMW" && vehicle.price < 25000 && vehicle.mileage < 50000 && vehicle.transmission === "automatic"));
assert.ok(result.toolCalls.some((tool) => tool.name === "inventory.search_vehicles" && tool.status === "success"));
assert.ok(result.toolCalls.some((tool) => tool.name === "pricing.get_price" && tool.status === "success"));
console.log(`Running stack passed: Next.js, API, three MCP servers; BMW query returned ${result.vehicles.length} matching fixture vehicles (${result.mode}).`);
