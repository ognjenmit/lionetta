import { LionettaAgent } from "../../../packages/agent/src/index.js";
import { createApp } from "./app.js";
import { loadTenants } from "./config.js";

const tenants = await loadTenants();
const mode = process.env.LIONETTA_AGENT_MODE ?? "demo";
if (mode !== "demo" && mode !== "openai") throw new Error("LIONETTA_AGENT_MODE must be demo or openai.");
const key = process.env.LIONETTA_MODEL_API_KEY;
if (mode === "openai" && !key) throw new Error("Set LIONETTA_MODEL_API_KEY locally to use the optional OpenAI agent.");
const options: { mode: "demo" | "openai"; apiKey?: string; model?: string; baseURL?: string } = { mode };
if (key) options.apiKey = key;
if (process.env.LIONETTA_MODEL) options.model = process.env.LIONETTA_MODEL;
if (process.env.LIONETTA_MODEL_BASE_URL) options.baseURL = process.env.LIONETTA_MODEL_BASE_URL;
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
