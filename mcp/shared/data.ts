import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Vehicle } from '../../packages/shared/src/index.js';

export type { Vehicle } from '../../packages/shared/src/index.js';

export const vehicleSchema = z.object({
  id: z.string().min(1),
  brand: z.string().min(1),
  model: z.string().min(1),
  price: z.number().nonnegative(),
  mileage: z.number().int().nonnegative(),
  transmission: z.enum(['automatic', 'manual']),
  fuel: z.string().min(1),
  year: z.number().int().min(1900).max(2100),
  url: z.string().min(1),
});

const fixtureSchema = z.record(
  z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  z.array(vehicleSchema),
);
const fixtureDirectory = process.env['LIONETTA_FIXTURES_DIR'] ?? resolve(process.cwd(), 'fixtures');
const inventory = new Map<string, Vehicle[]>(Object.entries(
  fixtureSchema.parse(JSON.parse(readFileSync(resolve(fixtureDirectory, 'vehicles.json'), 'utf8'))),
));
const tenantIds = [...inventory.keys()];
if (tenantIds.length === 0) throw new Error('Vehicle fixtures must define at least one tenant inventory');

// Expose only configured tenants in the MCP input schema without source edits.
export const tenantIdSchema = z.enum(tenantIds);
export type TenantId = z.infer<typeof tenantIdSchema>;

for (const [tenantId, vehicles] of inventory) {
  if (new Set(vehicles.map(vehicle => vehicle.id)).size !== vehicles.length) {
    throw new Error(`Duplicate vehicle IDs in ${tenantId} fixtures`);
  }
}

export function vehiclesForTenant(tenantId: TenantId): readonly Vehicle[] {
  const vehicles = inventory.get(tenantId);
  if (vehicles === undefined) throw new Error('Unknown tenant inventory');
  return vehicles;
}

export function findVehicle(tenantId: TenantId, vehicleId: string): Vehicle | undefined {
  return vehiclesForTenant(tenantId).find(vehicle => vehicle.id === vehicleId);
}

export function toolResult<T extends Record<string, unknown>>(data: T) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

export function toolError(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}
