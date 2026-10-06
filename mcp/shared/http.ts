import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

interface ServerOptions {
  name: string;
  defaultPort: number;
  portVariable: string;
  createMcpServer: () => McpServer;
}

function sendJson(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

function rpcError(response: ServerResponse, status: number, code: number, message: string): void {
  sendJson(response, status, { jsonrpc: '2.0', id: null, error: { code, message } });
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > 128 * 1024) throw new RangeError('Request body exceeds 128 KiB');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export function startMcpHttpServer(options: ServerOptions): void {
  const host = process.env['HOST'] ?? '127.0.0.1';
  const port = Number(process.env[options.portVariable] ?? options.defaultPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${options.portVariable} must be a valid TCP port`);
  }
  const allowedHosts = [
    `localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, `${host}:${port}`,
    `${options.name}:${port}`, `vehicle-inventory:${port}`,
    ...(process.env['MCP_ALLOWED_HOSTS']?.split(',').map(value => value.trim()).filter(Boolean) ?? []),
  ];
  const httpServer = createServer((request, response) => {
    void handle(request, response).catch(() => {
      console.error(`[${options.name}] MCP request failed`);
      if (!response.headersSent) rpcError(response, 500, -32603, 'Internal server error');
      else response.end();
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const pathname = request.url?.split('?')[0];
    if (pathname === '/health' && request.method === 'GET') {
      sendJson(response, 200, { status: 'ok', service: options.name, transport: 'streamable-http', mode: 'demo' });
      return;
    }
    if (pathname !== '/mcp') {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }
    if (request.method !== 'POST') {
      response.setHeader('allow', 'POST');
      rpcError(response, 405, -32000, 'Method not allowed. This stateless MCP server accepts POST requests.');
      return;
    }
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      rpcError(response, 415, -32000, 'Content-Type must be application/json');
      return;
    }
    let body: unknown;
    try {
      body = await readJson(request);
    } catch (error) {
      rpcError(response, error instanceof RangeError ? 413 : 400, -32700, 'Invalid or oversized JSON request');
      return;
    }

    // One transport/server per request is the SDK's stateless HTTP pattern.
    // Tenant data and demo lead state live outside these request objects.
    const server = options.createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts,
      allowedOrigins: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    });
    response.once('close', () => {
      void Promise.allSettled([transport.close(), server.close()]);
    });
    await server.connect(transport);
    await transport.handleRequest(request, response, body);
  }

  httpServer.requestTimeout = 30_000;
  httpServer.headersTimeout = 15_000;
  httpServer.on('error', (error: Error) => {
    console.error(`[${options.name}] HTTP server error: ${error.message}`);
    process.exitCode = 1;
  });
  httpServer.listen(port, host, () => {
    console.log(`[${options.name}] Demo MCP listening at http://${host}:${port}/mcp`);
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      httpServer.close(() => process.exit(0));
      httpServer.closeIdleConnections();
    });
  }
}
