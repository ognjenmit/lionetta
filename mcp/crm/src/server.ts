import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { findVehicle, tenantIdSchema, toolError, toolResult, type TenantId } from '../../shared/data.js';
import { startMcpHttpServer } from '../../shared/http.js';

const leadSchema = z.object({
  id: z.string(),
  tenant_id: tenantIdSchema,
  name: z.string(),
  email: z.email(),
  vehicle_id: z.string(),
  created_at: z.iso.datetime(),
});
type Lead = z.infer<typeof leadSchema>;
const leadsByTenant = new Map<TenantId, Lead[]>();

function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'lionetta-crm', version: '0.1.0' });
  server.registerTool('create_lead', {
    description: 'Create an IN-MEMORY demo CRM lead for a vehicle. The caller must first obtain explicit user confirmation. No real CRM is contacted; leads disappear on restart.',
    inputSchema: {
      tenant_id: tenantIdSchema,
      name: z.string().trim().min(2).max(100),
      email: z.email().max(254),
      vehicle_id: z.string().min(1).max(100),
    },
    outputSchema: { lead: leadSchema },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ tenant_id, name, email, vehicle_id }) => {
    if (!findVehicle(tenant_id, vehicle_id)) return toolError('Vehicle not found in this tenant\'s inventory.');
    const lead: Lead = { id: randomUUID(), tenant_id, name, email, vehicle_id, created_at: new Date().toISOString() };
    const leads = leadsByTenant.get(tenant_id) ?? [];
    leads.push(lead);
    leadsByTenant.set(tenant_id, leads);
    return toolResult({ lead });
  });
  server.registerTool('list_leads', {
    description: 'List IN-MEMORY demo leads for the selected tenant only. No real CRM is contacted.',
    inputSchema: { tenant_id: tenantIdSchema },
    outputSchema: { leads: z.array(leadSchema) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ tenant_id }) => toolResult({ leads: leadsByTenant.get(tenant_id) ?? [] }));
  return server;
}

startMcpHttpServer({ name: 'crm', defaultPort: 8003, portVariable: 'CRM_PORT', createMcpServer });
