export interface Vehicle {
  id: string;
  brand: string;
  model: string;
  price: number;
  mileage: number;
  transmission: "automatic" | "manual";
  fuel: string;
  year: number;
  url: string;
}

export interface ToolPermission {
  name: string;
  enabled: boolean;
  requiresConfirmation: boolean;
}

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  tools: ToolPermission[];
}

export interface TenantConfig {
  id: string;
  name: string;
  brandName: string;
  primaryColor: string;
  systemPrompt: string;
  model: string;
  mcpServers: McpServerConfig[];
}

export interface DiscoveredTool {
  name: string;
  serverId: string;
  originalName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiresConfirmation: boolean;
}

export interface ToolTrace {
  name: string;
  serverId: string;
  status: "success" | "confirmation_required" | "error";
  arguments?: Record<string, unknown>;
}

export interface AgentInput {
  prompt: string;
  tenantId: string;
  sessionId: string;
  confirmationId?: string;
}

export interface PendingConfirmation {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface AgentReply {
  reply: string;
  mode: "demo" | "openai";
  sessionId: string;
  tenantId: string;
  vehicles: Vehicle[];
  toolCalls: ToolTrace[];
  pendingConfirmation?: PendingConfirmation;
}
