import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { findVehicle, tenantIdSchema, toolResult, vehicleSchema, vehiclesForTenant } from '../../shared/data.js';
import { startMcpHttpServer } from '../../shared/http.js';

function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'lionetta-vehicle-inventory', version: '0.1.0' });
  server.registerTool('search_vehicles', {
    description: 'Search the selected tenant\'s mock vehicle inventory. Prices are EUR and mileage is kilometres.',
    inputSchema: {
      tenant_id: tenantIdSchema,
      brand: z.string().trim().min(1).max(80).optional(),
      model: z.string().trim().min(1).max(120).optional(),
      max_price: z.number().nonnegative().optional(),
      max_mileage: z.number().int().nonnegative().optional(),
      transmission: z.enum(['automatic', 'manual']).optional(),
    },
    outputSchema: { vehicles: z.array(vehicleSchema) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ tenant_id, brand, model, max_price, max_mileage, transmission }) => {
    const vehicles = vehiclesForTenant(tenant_id).filter(vehicle =>
      (brand === undefined || vehicle.brand.toLowerCase().includes(brand.toLowerCase())) &&
      (model === undefined || vehicle.model.toLowerCase().includes(model.toLowerCase())) &&
      (max_price === undefined || vehicle.price <= max_price) &&
      (max_mileage === undefined || vehicle.mileage <= max_mileage) &&
      (transmission === undefined || vehicle.transmission === transmission),
    );
    return toolResult({ vehicles });
  });
  server.registerTool('get_vehicle', {
    description: 'Get one demo vehicle belonging to the selected tenant. Returns null if it is not in that inventory.',
    inputSchema: { tenant_id: tenantIdSchema, vehicle_id: z.string().min(1).max(100) },
    outputSchema: { vehicle: vehicleSchema.nullable() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ tenant_id, vehicle_id }) => toolResult({ vehicle: findVehicle(tenant_id, vehicle_id) ?? null }));
  return server;
}

startMcpHttpServer({ name: 'inventory', defaultPort: 8001, portVariable: 'INVENTORY_PORT', createMcpServer });
