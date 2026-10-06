import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { createServer as portServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";

async function freePort() {
  const server = portServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address === "object");
  await new Promise<void>(resolve => server.close(() => resolve())); return address.port;
}

test("configured Claude API runs native tool calls against the actual tenant-scoped MCP servers", { timeout: 60_000 }, async t => {
  let providerCalls = 0;
  const fake = createServer((request, response) => { void (async () => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()) as { model: string; tools: Array<{name:string;input_schema:{properties:Record<string,unknown>}}>;
      messages: Array<{ content: string | Array<{content?:string}> }> };
    assert.equal(request.headers["x-api-key"], "local-claude-stack-key"); assert.equal(body.model, "claude-local-test");
    assert.ok(body.tools.every(tool => !('tenant_id' in tool.input_schema.properties)));
    providerCalls++;
    const last = body.messages.at(-1)?.content;
    const data = Array.isArray(last) ? JSON.parse(last[0]?.content ?? '{}') as Record<string, unknown> : undefined;
    const definition = body.tools.find(tool => tool.name.includes(data?.products ? "quote_bulk_order" : "search_products")); assert.ok(definition);
    const content = data?.total ? [{ type: "text", text: `The fictional 500-chair order totals EUR ${data.total}.` }]
      : [{ type: "tool_use", id: `tool_${providerCalls}`, name: definition.name,
        input: data?.products ? { product_id: "ergonomic-chair-pro", quantity: 500, tenant_id: "delta-motors" }
          : { category: "office chairs", quantity: 500, tenant_id: "delta-motors" } }];
    response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ id: `msg_${providerCalls}`, type: "message", role: "assistant",
      model: body.model, content, stop_reason: data?.total ? "end_turn" : "tool_use", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }));
  })().catch(() => { response.writeHead(500); response.end(); }); });
  await new Promise<void>(resolve => fake.listen(0, "127.0.0.1", resolve));
  const address = fake.address(); assert.ok(address && typeof address === "object");
  const [api, inventory, pricing, crm] = await Promise.all([freePort(), freePort(), freePort(), freePort()]);
  const child = spawn(process.execPath, ["scripts/services.mjs", "--dev", "--backend-only", "--no-watch"], { env: { ...process.env,
    HOST: "127.0.0.1", API_PORT: String(api), INVENTORY_PORT: String(inventory), PRICING_PORT: String(pricing), CRM_PORT: String(crm),
    LIONETTA_AGENT_MODE: "anthropic", ANTHROPIC_API_KEY: "local-claude-stack-key", ANTHROPIC_MODEL: "claude-local-test", ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
    LIONETTA_INVENTORY_URL: `http://127.0.0.1:${inventory}/mcp`, LIONETTA_PRICING_URL: `http://127.0.0.1:${pricing}/mcp`, LIONETTA_CRM_URL: `http://127.0.0.1:${crm}/mcp`,
  }, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", chunk => { output += String(chunk); }); child.stderr.on("data", chunk => { output += String(chunk); });
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, "exit"); child.kill("SIGTERM"); const timer = setTimeout(() => child.kill("SIGKILL"), 7000).unref(); await exited; clearTimeout(timer); }
    await new Promise<void>(resolve => { fake.close(() => resolve()); fake.closeAllConnections(); });
  });
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (child.exitCode !== null) throw new Error(`Claude stack exited: ${output}`);
    try { const checks = await Promise.all([fetch(`http://127.0.0.1:${api}/ping`), ...[inventory, pricing, crm].map(port => fetch(`http://127.0.0.1:${port}/health`))]); ready = checks.every(check => check.ok); await Promise.all(checks.map(check => check.text())); } catch { /* Still starting. */ }
    if (ready) break; await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, output);
  const publicConfig = await (await fetch(`http://127.0.0.1:${api}/tenants`)).json(); assert.equal(publicConfig.mode, "anthropic");
  const response = await fetch(`http://127.0.0.1:${api}/invocations`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: "atlas-wholesale", prompt: "Compare 500 office chairs and quote the Chair Pro." }) });
  const result = await response.json(); assert.equal(response.status, 200); assert.equal(result.mode, "anthropic");
  assert.equal(result.products.length, 2); assert.equal(result.quotes[0].total, 63150); assert.equal(providerCalls, 3);
  assert.ok(result.toolCalls.every((call: {status:string}) => call.status === "success"));
});
