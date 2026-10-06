import type { AgentMode, PublicTenant } from "../../../packages/shared/src/index";
export type {
  AgentMode as Mode, AgentReply as ChatResponse, Domain, PublicTenant as Tenant,
  PendingConfirmation, Property, Product, ToolTrace as ToolCall, Vehicle,
} from "../../../packages/shared/src/index";
export interface TenantsResponse { tenants: PublicTenant[]; mode: AgentMode }
