import { LionettaAgent } from "../../../packages/agent/src/index.js";
import type { AgentOptions } from "../../../packages/agent/src/index.js";
import { createApp } from "./app.js";
import { loadTenants } from "./config.js";

const tenants = await loadTenants();
const mode = process.env.LIONETTA_AGENT_MODE ?? "demo";
if (mode !== "demo" && mode !== "openai" && mode !== "anthropic") throw new Error("LIONETTA_AGENT_MODE must be demo, anthropic, or openai.");
const key = mode === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.LIONETTA_MODEL_API_KEY;
const options: AgentOptions = { mode };
if (key) options.apiKey = key;
const model = mode === "anthropic" ? process.env.ANTHROPIC_MODEL : process.env.LIONETTA_MODEL;
const baseURL = mode === "anthropic" ? process.env.ANTHROPIC_BASE_URL : process.env.LIONETTA_MODEL_BASE_URL;
if (model) options.model = model;
if (baseURL) options.baseURL = baseURL;
const agent = new LionettaAgent(tenants, options);
const port = Number(process.env.API_PORT ?? 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("API_PORT must be an integer between 1 and 65535.");
const server = createApp(agent, tenants, mode);
const host = process.env.HOST ?? "127.0.0.1";
server.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
server.listen(port, host, () => console.log(`Lionetta API (${mode}) listening on ${host}:${port}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => { void agent.close(); });
    server.closeIdleConnections();
    setTimeout(() => server.closeAllConnections(), 5000).unref();
  });
}
