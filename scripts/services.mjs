import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const dev = process.argv.includes("--dev");
const backendOnly = process.argv.includes("--backend-only");
const watch = dev && !process.argv.includes("--no-watch");
const children = [];
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
  const forced = setTimeout(() => { for (const child of children) child.kill("SIGKILL"); }, 6000);
  forced.unref();
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());

function launch(name, args, extra = {}) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...extra }, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  for (const [stream, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    stream.on("data", (chunk) => output.write(`[${name}] ${chunk}`));
  }
  child.on("error", (error) => { console.error(`[${name}] ${error.message}`); stop(1); });
  child.on("exit", (code, signal) => {
    if (!stopping) { console.error(`[${name}] exited (${signal ?? code})`); stop(code || 1); }
  });
}

const sourceArgs = (path) => dev ? [...(watch ? ["--watch"] : []), "--import", "tsx", path] : [`dist/${path.replace(/\.ts$/, ".js")}`];
launch("inventory", sourceArgs("mcp/vehicle-inventory/src/server.ts"));
launch("pricing", sourceArgs("mcp/pricing/src/server.ts"));
launch("crm", sourceArgs("mcp/crm/src/server.ts"));
launch("api", sourceArgs("apps/api/src/server.ts"));
if (!backendOnly) {
  const port = process.env.WEB_PORT ?? "3000";
  launch("web", ["node_modules/next/dist/bin/next", dev ? "dev" : "start", "apps/web", "--hostname", process.env.HOST ?? "127.0.0.1", "--port", port], {
    NEXT_TELEMETRY_DISABLED: "1", API_ORIGIN: process.env.API_ORIGIN ?? `http://127.0.0.1:${process.env.API_PORT ?? 8080}`,
  });
}
console.log(`Lionetta ${dev ? "development" : "compiled"} services started. Stop with Ctrl+C.`);
