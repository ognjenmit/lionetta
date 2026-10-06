import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { findVehicle, tenantIdSchema, toolError, toolResult, type TenantId } from '../../shared/data.js';
import { startMcpHttpServer } from '../../shared/http.js';
import { findProperty, findProduct } from '../../shared/catalog.js';

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
const requestSchema = z.object({ id: z.string(), tenant_id: tenantIdSchema, type: z.enum(['viewing', 'quote']),
  name: z.string(), email: z.email(), created_at: z.iso.datetime(), property_id: z.string().optional(),
  preferred_at: z.string().optional(), product_id: z.string().optional(), quantity: z.number().int().positive().optional(), company: z.string().optional() });
const requestsByTenant = new Map<TenantId, z.infer<typeof requestSchema>[]>();
function saveRequest(tenant: TenantId, fields: Omit<z.infer<typeof requestSchema>, 'id' | 'tenant_id' | 'created_at'>) {
  const request = { ...fields, id: randomUUID(), tenant_id: tenant, created_at: new Date().toISOString() };
  const entries = requestsByTenant.get(tenant) ?? [];
  entries.push(request); requestsByTenant.set(tenant, entries);
  return toolResult({ request });
}

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
  server.registerTool('request_viewing', {
    description: 'Store an in-memory fictional viewing request AFTER explicit confirmation. No calendar, owner or email is contacted. Provide preferred date/time/timezone as text.',
    inputSchema: { tenant_id: tenantIdSchema, property_id: z.string(), name: z.string().trim().min(2).max(100), email: z.email(), preferred_at: z.string().min(5).max(120) },
    outputSchema: { request: requestSchema }, annotations: { readOnlyHint: false, openWorldHint: false },
  }, async ({ tenant_id, property_id, name, email, preferred_at }) => {
    if (!findProperty(tenant_id, property_id)) return toolError('Property not found in this tenant.');
    return saveRequest(tenant_id, { type: 'viewing', property_id, name, email, preferred_at });
  });
  server.registerTool('request_quote', {
    description: 'Store an in-memory fictional B2B quote request AFTER explicit confirmation. Enforces MOQ/stock; creates no order, reservation or outgoing message.',
    inputSchema: { tenant_id: tenantIdSchema, product_id: z.string(), quantity: z.number().int().positive(), company: z.string().trim().min(2).max(120), name: z.string().trim().min(2).max(100), email: z.email() },
    outputSchema: { request: requestSchema }, annotations: { readOnlyHint: false, openWorldHint: false },
  }, async ({ tenant_id, product_id, quantity, company, name, email }) => {
    const product = findProduct(tenant_id, product_id);
    if (!product) return toolError('Product not found in this tenant.');
    if (quantity < product.minimumOrderQuantity || quantity > product.stock) return toolError('Quantity must satisfy the demo minimum order and available stock.');
    return saveRequest(tenant_id, { type: 'quote', product_id, quantity, company, name, email });
  });
  server.registerTool('list_requests', {
    description: 'Read this tenant’s in-memory viewing or quote requests. State resets on restart.',
    inputSchema: { tenant_id: tenantIdSchema }, outputSchema: { requests: z.array(requestSchema) }, annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ tenant_id }) => toolResult({ requests: requestsByTenant.get(tenant_id) ?? [] }));
  return server;
}

startMcpHttpServer({ name: 'crm', defaultPort: 8003, portVariable: 'CRM_PORT', createMcpServer });
