import { randomUUID } from "node:crypto";
import OpenAI, { APIError } from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { McpRouter, McpToolError } from "../../mcp-client/src/index.js";
import type {
  AgentInput, AgentReply, DiscoveredTool, PendingConfirmation, TenantConfig, Vehicle,
} from "../../shared/src/index.js";
import { parseVehicleSearch } from "./search-parser.js";

export interface AgentOptions {
  mode: "demo" | "openai";
  apiKey?: string;
  model?: string;
  baseURL?: string;
}

interface StoredConfirmation extends PendingConfirmation {
  tenantId: string;
  sessionId: string;
  expiresAt: number;
}

const EXAMPLE = "I want a BMW 3 Series under €25,000, automatic and below 50,000 km.";
const CONFIRMATION_TTL = 10 * 60 * 1000;
const MAX_HISTORY_MESSAGES = 24;
const MAX_SESSIONS = 1000;

/** The transport-independent agent entry point also fits an AgentCore invocation adapter. */
export class LionettaAgent {
  private readonly tenants = new Map<string, TenantConfig>();
  private readonly routers = new Map<string, McpRouter>();
  private readonly confirmations = new Map<string, StoredConfirmation>();
  private readonly history = new Map<string, ChatCompletionMessageParam[]>();
  private readonly options: AgentOptions;
  private readonly openai: OpenAI | undefined;

  constructor(tenants: TenantConfig[], options: AgentOptions = { mode: "demo" }) {
    this.options = options;
    for (const tenant of tenants) {
      if (this.tenants.has(tenant.id)) throw new Error(`Duplicate tenant configuration: ${tenant.id}`);
      this.tenants.set(tenant.id, tenant);
      this.routers.set(tenant.id, new McpRouter(tenant));
    }
    if (options.mode === "openai") {
      if (!options.apiKey?.trim()) throw new Error("LIONETTA_MODEL_API_KEY is required for OpenAI mode. Demo mode needs no credentials.");
      this.openai = new OpenAI({
        apiKey: options.apiKey,
        ...(options.baseURL ? { baseURL: options.baseURL } : {}),
        timeout: 60_000,
        maxRetries: 1,
      });
    }
  }

  async invoke(input: AgentInput): Promise<AgentReply> {
    const tenant = this.tenants.get(input.tenantId);
    const router = this.routers.get(input.tenantId);
    if (!tenant || !router) throw new Error(`Unknown tenant: ${input.tenantId}`);
    if (!input.sessionId.trim() || input.sessionId.length > 256) throw new Error("A sessionId between 1 and 256 characters is required.");
    if (!input.prompt.trim() || input.prompt.length > 4000) throw new Error("A prompt between 1 and 4000 characters is required.");
    this.pruneConfirmations();
    const response: AgentReply = {
      reply: "", mode: this.options.mode, tenantId: tenant.id, sessionId: input.sessionId,
      vehicles: [], toolCalls: [],
    };
    try {
      if (input.confirmationId) await this.confirm(input, router, response);
      else {
        const tools = await router.discover();
        if (this.options.mode === "openai") await this.invokeModel(input, tenant, router, tools, response);
        else await this.invokeDemo(input, router, tools, response);
      }
    } catch (error) {
      if (error instanceof McpToolError) response.toolCalls.push(error.trace);
      const detail = error instanceof APIError
        ? error.status === undefined ? "The model provider could not be reached. Check its configuration and connectivity."
          : `The model provider returned HTTP ${error.status}. Check its configuration and access.`
        : error instanceof Error ? error.message : "Unknown error";
      response.reply = `Lionetta could not complete this request: ${detail}`;
    }
    this.remember(input, response.reply);
    return response;
  }

  async close(): Promise<void> {
    await Promise.all([...this.routers.values()].map((router) => router.close()));
    this.confirmations.clear();
    this.history.clear();
  }

  private async invokeDemo(
    input: AgentInput, router: McpRouter, tools: DiscoveredTool[], response: AgentReply,
  ): Promise<void> {
    const prompt = input.prompt.trim();
    const normalized = prompt.toLowerCase();
    if (normalized === "integrations" || normalized === "tools" || normalized === "list integrations") {
      response.reply = tools.length
        ? `Available tools:\n${tools.map((tool) => `• ${tool.name}${tool.requiresConfirmation ? " (confirmation required)" : ""}`).join("\n")}`
        : "This tenant has no enabled MCP tools. Configure its integrations before searching.";
      return;
    }
    if (/^create lead\s*:/i.test(prompt)) {
      const fields = prompt.replace(/^create lead\s*:/i, "").split("|").map((field) => field.trim());
      const [name, email, vehicleId] = fields;
      if (fields.length !== 3 || !name || !email || !vehicleId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        response.reply = "Use: create lead: Alex | alex@example.com | bmw-320d-001";
        return;
      }
      const tool = this.requireTool(tools, "create_lead");
      // Creating a lead always asks for confirmation, even if a tenant policy is too permissive.
      this.requestConfirmation(input, tool, { name, email, vehicle_id: vehicleId }, response);
      return;
    }
    if (/^list leads\b/i.test(prompt)) {
      const tool = this.requireTool(tools, "list_leads");
      const data = await this.executeOrConfirm(input, router, tool, {}, response);
      if (!data) return;
      const leads = Array.isArray(data.leads) ? data.leads : [];
      response.reply = leads.length
        ? `Leads for this tenant:\n${leads.map((lead) => {
          const record = asRecord(lead);
          return `• ${String(record.name ?? "Unnamed")} — ${String(record.email ?? "")} (${String(record.vehicle_id ?? "")})`;
        }).join("\n")}`
        : "There are no leads for this tenant yet. Try: create lead: Alex | alex@example.com | bmw-320d-001";
      return;
    }
    if (/\b(cars?|vehicles?|inventory|bmw|audi|mercedes|toyota|volkswagen|vw|volvo|skoda)\b/i.test(prompt)) {
      const inventory = this.requireTool(tools, "search_vehicles");
      const data = await this.executeOrConfirm(input, router, inventory, parseVehicleSearch(prompt), response);
      if (!data) return;
      const vehicles = readVehicles(data);
      const pricing = tools.find((tool) => tool.originalName === "get_price");
      if (pricing) {
        for (const vehicle of vehicles) {
          const quote = await this.executeOrConfirm(input, router, pricing, { vehicle_id: vehicle.id }, response);
          if (!quote) return;
          if (typeof quote.price === "number" && Number.isFinite(quote.price)) vehicle.price = quote.price;
        }
      }
      response.vehicles = vehicles;
      response.reply = vehicles.length
        ? `I found ${vehicles.length} ${vehicles.length === 1 ? "vehicle" : "vehicles"} that match your search. ${pricing ? "Prices are confirmed by the pricing integration." : "Showing inventory prices."}`
        : "I found no vehicles matching those filters. Try a higher budget, higher mileage, or a different model.";
      return;
    }
    response.reply = `Try: “${EXAMPLE}” You can also ask for “integrations”, “list leads”, or “create lead: Alex | alex@example.com | bmw-320d-001”.`;
  }

  private async invokeModel(
    input: AgentInput, tenant: TenantConfig, router: McpRouter, tools: DiscoveredTool[], response: AgentReply,
  ): Promise<void> {
    if (!this.openai) throw new Error("OpenAI client is not configured.");
    const toolNames = new Map<string, DiscoveredTool>();
    const modelTools: ChatCompletionTool[] = tools.map((tool, index) => {
      const name = `mcp_${index}_${tool.name.replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(0, 64);
      toolNames.set(name, tool);
      return {
        type: "function", function: {
          name, description: `${tool.description}${tool.requiresConfirmation ? " Requires explicit user confirmation before execution." : ""}`,
          parameters: tool.inputSchema, strict: false,
        },
      };
    });
    const messages: ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `${tenant.systemPrompt}\nYou are ${tenant.brandName}'s assistant. Only use the available tools and results; do not invent inventory, prices or completed actions. Search inventory for vehicle requests, then call get_price for each displayed vehicle when available. Respect requested budget and mileage limits. Tool permissions and tenant scope are enforced by the host. A tool requiring confirmation must be proposed, never described as already completed. Be concise and helpful.`,
      },
      ...(this.history.get(this.historyKey(input)) ?? []),
      { role: "user", content: input.prompt },
    ];
    for (let step = 0; step < 8; step++) {
      const completion = await this.openai.chat.completions.create({
        model: this.options.model ?? tenant.model,
        messages,
        ...(modelTools.length ? { tools: modelTools, tool_choice: "auto" as const } : {}),
      });
      const message = completion.choices[0]?.message;
      if (!message) throw new Error("The model returned no response.");
      if (!message.tool_calls?.length) {
        response.reply = message.content?.trim() || "Please describe what you need help with.";
        return;
      }
      messages.push(message);
      for (const call of message.tool_calls) {
        if (call.type !== "function") throw new Error("The model returned an unsupported tool call.");
        const tool = toolNames.get(call.function.name);
        if (!tool) throw new Error(`The model requested an unavailable tool: ${call.function.name}`);
        let args: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(call.function.arguments);
          if (!isRecord(parsed)) throw new Error("Arguments must be an object");
          args = parsed;
        } catch {
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "Tool arguments must be valid JSON objects." }) });
          continue;
        }
        if (tool.requiresConfirmation || tool.originalName === "create_lead") {
          this.requestConfirmation(input, tool, args, response);
          return;
        }
        try {
          const result = await router.callTool(tool.name, args);
          response.toolCalls.push(result.trace);
          if (tool.originalName === "search_vehicles" || tool.originalName === "get_vehicle") response.vehicles = readVehicles(result.data);
          if (tool.originalName === "get_price" && typeof result.data.price === "number") {
            const vehicle = response.vehicles.find((entry) => entry.id === result.data.vehicle_id);
            if (vehicle) vehicle.price = result.data.price;
          }
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result.data) });
        } catch (error) {
          if (error instanceof McpToolError) response.toolCalls.push(error.trace);
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: error instanceof Error ? error.message : "Tool failed" }) });
        }
      }
    }
    response.reply = "The agent reached its tool limit for this request. Please narrow your question and try again.";
  }

  private async executeOrConfirm(
    input: AgentInput, router: McpRouter, tool: DiscoveredTool, args: Record<string, unknown>, response: AgentReply,
  ): Promise<Record<string, unknown> | undefined> {
    if (tool.requiresConfirmation) {
      this.requestConfirmation(input, tool, args, response);
      return undefined;
    }
    const result = await router.callTool(tool.name, args);
    response.toolCalls.push(result.trace);
    return result.data;
  }

  private requestConfirmation(
    input: AgentInput, tool: DiscoveredTool, args: Record<string, unknown>, response: AgentReply,
  ): void {
    const cleanArgs = { ...args };
    delete cleanArgs.tenant_id;
    const pending: PendingConfirmation = { id: randomUUID(), toolName: tool.name, arguments: cleanArgs };
    this.confirmations.set(pending.id, {
      ...structuredClone(pending), tenantId: input.tenantId, sessionId: input.sessionId, expiresAt: Date.now() + CONFIRMATION_TTL,
    });
    response.pendingConfirmation = pending;
    response.toolCalls.push({ name: tool.name, serverId: tool.serverId, status: "confirmation_required", arguments: cleanArgs });
    response.reply = `Please confirm ${tool.name} with these details: ${JSON.stringify(cleanArgs)}. This action has not run yet.`;
  }

  private async confirm(input: AgentInput, router: McpRouter, response: AgentReply): Promise<void> {
    const pending = this.confirmations.get(input.confirmationId ?? "");
    if (!pending || pending.tenantId !== input.tenantId || pending.sessionId !== input.sessionId || pending.expiresAt <= Date.now()) {
      response.reply = "That confirmation is invalid, expired, or belongs to another conversation. Request the action again.";
      return;
    }
    // Consume before awaiting: a concurrent request cannot execute the action twice.
    this.confirmations.delete(pending.id);
    const result = await router.callTool(pending.toolName, pending.arguments, { confirmationGranted: true });
    response.toolCalls.push(result.trace);
    const lead = asRecord(result.data.lead);
    response.reply = pending.toolName.endsWith(".create_lead")
      ? `Created lead for ${String(lead.name ?? pending.arguments.name ?? "the customer")} (${String(lead.email ?? pending.arguments.email ?? "")}).`
      : `Confirmed: ${pending.toolName} completed successfully.`;
    response.vehicles = readVehicles(result.data);
  }

  private requireTool(tools: DiscoveredTool[], originalName: string): DiscoveredTool {
    const tool = tools.find((entry) => entry.originalName === originalName);
    if (!tool) throw new Error(`The ${originalName} tool is not available for this tenant.`);
    return tool;
  }

  private historyKey(input: AgentInput): string { return JSON.stringify([input.tenantId, input.sessionId]); }

  private remember(input: AgentInput, reply: string): void {
    const key = this.historyKey(input);
    const messages = this.history.get(key) ?? [];
    messages.push({ role: "user", content: input.prompt }, { role: "assistant", content: reply });
    this.history.delete(key);
    this.history.set(key, messages.slice(-MAX_HISTORY_MESSAGES));
    if (this.history.size > MAX_SESSIONS) {
      const oldest = this.history.keys().next().value;
      if (oldest) this.history.delete(oldest);
    }
  }

  private pruneConfirmations(): void {
    for (const [id, pending] of this.confirmations) {
      if (pending.expiresAt <= Date.now()) this.confirmations.delete(id);
    }
    while (this.confirmations.size >= MAX_SESSIONS) {
      const oldest = this.confirmations.keys().next().value;
      if (oldest) this.confirmations.delete(oldest);
      else break;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asRecord(value: unknown): Record<string, unknown> { return isRecord(value) ? value : {}; }
function readVehicles(data: Record<string, unknown>): Vehicle[] {
  const candidates = Array.isArray(data.vehicles) ? data.vehicles : data.vehicle ? [data.vehicle] : [];
  return candidates.filter((candidate): candidate is Vehicle => {
    const record = asRecord(candidate);
    return typeof record.id === "string" && typeof record.brand === "string" && typeof record.model === "string"
      && typeof record.price === "number" && Number.isFinite(record.price)
      && typeof record.mileage === "number" && typeof record.year === "number"
      && (record.transmission === "automatic" || record.transmission === "manual")
      && typeof record.fuel === "string" && typeof record.url === "string";
  }).map((vehicle) => ({ ...vehicle }));
}
