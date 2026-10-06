export interface Tenant {
  id: string;
  name: string;
  brandName: string;
  primaryColor: string;
}

export interface Vehicle {
  id: string;
  brand: string;
  model: string;
  price: number;
  mileage: number;
  transmission: string;
  fuel: string;
  year: number;
  url: string;
}

export interface ToolCall {
  name: string;
  serverId: string;
  status: string;
}

export interface PendingConfirmation {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export type Mode = "demo" | "openai";

export interface ChatResponse {
  reply: string;
  mode: Mode;
  sessionId: string;
  tenantId: string;
  vehicles: Vehicle[];
  toolCalls: ToolCall[];
  pendingConfirmation?: PendingConfirmation;
}

export interface TenantsResponse {
  tenants: Tenant[];
  mode: Mode;
}
