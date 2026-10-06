import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  DiscoveredTool,
  McpServerConfig,
  TenantConfig,
  ToolPermission,
  ToolTrace,
} from "../../shared/src/index.js";

interface Connection {
  client: Client;
  url: string;
}

interface AllowedTool {
  server: McpServerConfig;
  permission: ToolPermission;
  originalName: string;
}

/** A controlled MCP failure whose trace can be shown alongside other agent calls. */
export class McpToolError extends Error {
  readonly trace: ToolTrace;
  readonly data: Record<string, unknown> | undefined;

  constructor(
    message: string,
    trace: ToolTrace,
    options?: { cause?: unknown; data?: Record<string, unknown> },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "McpToolError";
    this.trace = trace;
    this.data = options?.data;
  }
}

/** Routes namespaced MCP tools using the tenant's explicit, current permissions. */
export class McpRouter {
  private readonly connections = new Map<string, Connection>();
  private readonly connecting = new Map<string, Promise<Connection>>();
  private tools = new Map<string, DiscoveredTool>();
  private closed = false;

  constructor(private readonly tenant: TenantConfig) {}

  async discover(): Promise<DiscoveredTool[]> {
    this.assertOpen();
    this.assertUniqueServerIds();
    const discovered = new Map<string, DiscoveredTool>();

    for (const server of this.tenant.mcpServers) {
      if (server.enabled !== true || !server.tools.some(hasExplicitPermission)) continue;
      this.assertUniquePermissions(server);
      try {
        const connection = await this.getConnection(server);
        let cursor: string | undefined;
        const seenCursors = new Set<string>();
        do {
          const page = await connection.client.listTools(
            cursor === undefined ? undefined : { cursor },
            { timeout: 15_000 },
          );
          for (const tool of page.tools) {
            const permission = server.tools.find((candidate) => candidate.name === tool.name);
            if (!hasExplicitPermission(permission) || server.enabled !== true) continue;
            const name = `${server.id}.${tool.name}`;
            if (discovered.has(name)) throw new Error(`Duplicate tool ${name}`);
            discovered.set(name, {
              name,
              serverId: server.id,
              originalName: tool.name,
              description: tool.description ?? tool.name,
              inputSchema: modelSchema(tool.inputSchema),
              requiresConfirmation: permission.requiresConfirmation,
            });
          }
          cursor = page.nextCursor;
          if (cursor !== undefined) {
            if (seenCursors.has(cursor)) throw new Error("MCP server repeated a pagination cursor");
            seenCursors.add(cursor);
          }
        } while (cursor !== undefined);
      } catch (cause) {
        // Do not put server URLs or upstream response bodies in user-visible errors.
        throw new Error(`Could not discover tools from MCP server ${server.id} (${server.name}).`, { cause });
      }
    }

    this.tools = discovered;
    return [...discovered.values()];
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    options?: { confirmationGranted?: boolean },
  ): Promise<{ data: Record<string, unknown>; trace: ToolTrace }> {
    const trace: ToolTrace = {
      name,
      serverId: this.tools.get(name)?.serverId ?? name.split(".")[0] ?? "unknown",
      status: "error",
      arguments: safeArguments(args),
    };
    try {
      this.assertOpen();
      if (!this.tools.has(name)) await this.discover();
      const allowed = this.requireAllowedTool(name, trace, options);
      const connection = await this.getConnection(allowed.server);
      // Re-check after connecting: a policy can change while I/O is in progress.
      const current = this.requireAllowedTool(name, trace, options);
      if (current.server.url !== connection.url) {
        throw new McpToolError(`MCP server ${current.server.id} changed its endpoint; retry the tool.`, trace);
      }
      const result = await connection.client.callTool(
        {
          name: current.originalName,
          arguments: { ...args, tenant_id: this.tenant.id },
        },
        undefined,
        { timeout: 30_000 },
      );
      const data = resultData(result);
      if (result.isError === true) {
        throw new McpToolError(`MCP tool ${name} returned an error.`, trace, { data });
      }
      return { data, trace: { ...trace, status: "success" } };
    } catch (cause) {
      if (cause instanceof McpToolError) throw cause;
      throw new McpToolError(`Could not run MCP tool ${name}.`, trace, { cause });
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled(this.connecting.values());
    const results = await Promise.allSettled([...this.connections.values()].map(({ client }) => client.close()));
    this.connections.clear();
    this.tools.clear();
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw new Error("Could not close an MCP connection.", { cause: failure.reason });
  }

  private requireAllowedTool(
    name: string,
    trace: ToolTrace,
    options: { confirmationGranted?: boolean } | undefined,
  ): AllowedTool {
    this.assertUniqueServerIds();
    const discovered = this.tools.get(name);
    if (!discovered) throw new McpToolError(`MCP tool ${name} is not available to this tenant.`, trace);
    const server = this.tenant.mcpServers.find((candidate) => candidate.id === discovered.serverId);
    if (server?.enabled !== true) throw new McpToolError(`MCP server ${discovered.serverId} is disabled.`, trace);
    this.assertUniquePermissions(server);
    const permission = server.tools.find((candidate) => candidate.name === discovered.originalName);
    if (!hasExplicitPermission(permission)) throw new McpToolError(`MCP tool ${name} is disabled or has no permission.`, trace);
    if (permission.requiresConfirmation && options?.confirmationGranted !== true) {
      throw new McpToolError(`MCP tool ${name} requires confirmation.`, { ...trace, status: "confirmation_required" });
    }
    return { server, permission, originalName: discovered.originalName };
  }

  private async getConnection(server: McpServerConfig): Promise<Connection> {
    const existing = this.connections.get(server.id);
    if (existing?.url === server.url) return existing;
    const inProgress = this.connecting.get(server.id);
    if (inProgress !== undefined) return inProgress;

    const url = server.url;
    const connecting = (async (): Promise<Connection> => {
      if (existing !== undefined) {
        this.connections.delete(server.id);
        await existing.client.close();
      }
      const endpoint = new URL(url);
      if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
        throw new Error("MCP endpoints must use HTTP or HTTPS.");
      }
      const client = new Client({ name: "lionetta", version: "0.1.0" });
      try {
        // SDK 1.32 declares the runtime-compatible sessionId getter more broadly
        // than Transport's optional property under exactOptionalPropertyTypes.
        const transport = new StreamableHTTPClientTransport(endpoint) as Transport;
        await client.connect(transport, { timeout: 15_000 });
      } catch (cause) {
        await client.close().catch(() => undefined);
        throw cause;
      }
      const connection = { client, url };
      this.connections.set(server.id, connection);
      return connection;
    })();
    this.connecting.set(server.id, connecting);
    try {
      return await connecting;
    } finally {
      this.connecting.delete(server.id);
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("The MCP router is closed.");
  }

  private assertUniqueServerIds(): void {
    const ids = this.tenant.mcpServers.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) throw new Error("The tenant has duplicate MCP server IDs.");
  }

  private assertUniquePermissions(server: McpServerConfig): void {
    const names = server.tools.map(({ name }) => name);
    if (new Set(names).size !== names.length) throw new Error(`MCP server ${server.id} has duplicate tool permissions.`);
  }
}

function modelSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result = structuredClone(schema);
  if (isRecord(result.properties)) delete result.properties.tenant_id;
  if (Array.isArray(result.required)) result.required = result.required.filter((name) => name !== "tenant_id");
  return result;
}

function hasExplicitPermission(permission: ToolPermission | undefined): permission is ToolPermission {
  return permission?.enabled === true && typeof permission.requiresConfirmation === "boolean";
}

function resultData(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  if (isRecord(result.structuredContent)) return result.structuredContent;
  const content: unknown = result.content;
  if (!Array.isArray(content)) {
    return isRecord(result.toolResult) ? result.toolResult : { value: result.toolResult };
  }
  const text = content
    .filter((part: unknown): part is { type: "text"; text: string } =>
      isRecord(part) && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
  if (text.length > 0) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (isRecord(parsed)) return parsed;
      return Array.isArray(parsed) ? { items: parsed } : { value: parsed };
    } catch {
      return { text };
    }
  }
  return { content };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keep tool diagnostics useful without echoing injected scope or credentials. */
function safeArguments(args: Record<string, unknown>): Record<string, unknown> {
  const seen = new WeakSet<object>();
  function clean(value: unknown, depth: number): unknown {
    if (depth > 8) return "[omitted]";
    if (typeof value !== "object" || value === null) return typeof value === "bigint" ? value.toString() : value;
    if (seen.has(value)) return "[omitted]";
    seen.add(value);
    if (Array.isArray(value)) return value.map((item) => clean(item, depth + 1));
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "tenant_id")
        .map(([key, item]) => [key, /(?:password|secret|token|authorization|api[_-]?key|credential)/i.test(key)
          ? "[redacted]"
          : clean(item, depth + 1)]),
    );
  }
  return clean(args, 0) as Record<string, unknown>;
}
