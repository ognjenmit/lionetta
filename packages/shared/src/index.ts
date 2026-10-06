export type AgentMode = "demo" | "openai" | "anthropic";
export type Domain = "cars" | "real-estate" | "b2b";

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
  bodyType?: string;
  color?: string;
  seats?: number;
  features?: string[];
  description?: string;
  serviceHistory?: string;
}

export interface Property {
  id: string; title: string; listingType: "sale" | "rent"; propertyType: "apartment" | "house" | "office";
  city: string; neighborhood: string; price: number; bedrooms: number; bathrooms: number; area: number;
  features: string[]; description: string; energyRating: string; availability: string; serviceCharges: number; url: string;
}

export interface Product {
  id: string; sku: string; name: string; category: string; unitPrice: number; stock: number;
  minimumOrderQuantity: number; leadTimeDays: number; description: string; specifications: Record<string, string>;
  priceBreaks: { minQuantity: number; unitPrice: number }[]; warrantyMonths: number; url: string;
}

export interface PublicTenant {
  id: string; name: string; brandName: string; primaryColor: string; domain: Domain;
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
  domain?: Domain;
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
  mode: AgentMode;
  sessionId: string;
  tenantId: string;
  vehicles: Vehicle[];
  properties: Property[];
  products: Product[];
  quotes: Record<string, unknown>[];
  toolCalls: ToolTrace[];
  pendingConfirmation?: PendingConfirmation;
}
