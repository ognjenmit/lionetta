import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { findVehicle, tenantIdSchema, toolError, toolResult } from '../../shared/data.js';
import { startMcpHttpServer } from '../../shared/http.js';

function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'lionetta-pricing', version: '0.1.0' });
  server.registerTool('get_price', {
    description: 'Get the mock EUR cash price of a vehicle in the selected tenant\'s inventory.',
    inputSchema: { tenant_id: tenantIdSchema, vehicle_id: z.string().min(1).max(100) },
    outputSchema: { vehicle_id: z.string(), price: z.number().nonnegative(), currency: z.literal('EUR') },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ tenant_id, vehicle_id }) => {
    const vehicle = findVehicle(tenant_id, vehicle_id);
    if (!vehicle) return toolError('Vehicle not found in this tenant\'s inventory.');
    return toolResult({ vehicle_id, price: vehicle.price, currency: 'EUR' as const });
  });
  server.registerTool('quote_lease', {
    description: 'Calculate a deterministic DEMO financing illustration. This is not a real lender offer or a binding lease quote.',
    inputSchema: {
      tenant_id: tenantIdSchema,
      vehicle_id: z.string().min(1).max(100),
      months: z.number().int().min(12).max(84),
      down_payment: z.number().nonnegative().optional(),
    },
    outputSchema: {
      vehicle_id: z.string(),
      currency: z.literal('EUR'),
      months: z.number().int(),
      down_payment: z.number().nonnegative(),
      monthly_payment: z.number().nonnegative(),
      total_payment: z.number().nonnegative(),
      demo: z.literal(true),
      note: z.string(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ tenant_id, vehicle_id, months, down_payment = 0 }) => {
    const vehicle = findVehicle(tenant_id, vehicle_id);
    if (!vehicle) return toolError('Vehicle not found in this tenant\'s inventory.');
    if (down_payment > vehicle.price) return toolError('Down payment cannot exceed the vehicle price.');
    const financed = vehicle.price - down_payment;
    const monthlyRate = 0.06 / 12;
    const monthly = financed === 0 ? 0 : financed * monthlyRate / (1 - Math.pow(1 + monthlyRate, -months));
    const monthlyPayment = Math.round(monthly * 100) / 100;
    return toolResult({
      vehicle_id,
      currency: 'EUR' as const,
      months,
      down_payment,
      monthly_payment: monthlyPayment,
      total_payment: Math.round((down_payment + monthlyPayment * months) * 100) / 100,
      demo: true as const,
      note: 'Demo financing illustration at a fixed 6% annual rate, no fees or residual value. Not a binding lease offer.',
    });
  });
  return server;
}

startMcpHttpServer({ name: 'pricing', defaultPort: 8002, portVariable: 'PRICING_PORT', createMcpServer });
