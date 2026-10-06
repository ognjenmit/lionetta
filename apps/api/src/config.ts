import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { TenantConfig } from "../../../packages/shared/src/index.js";

const permissionSchema = z.object({ name: z.string().min(1), enabled: z.boolean(), requiresConfirmation: z.boolean() });
const tenantSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), name: z.string().min(1), brandName: z.string().min(1),
  primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i), systemPrompt: z.string().min(1), model: z.string().min(1),
  domain: z.enum(["cars", "real-estate", "b2b"]).default("cars"),
  mcpServers: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]+$/), name: z.string(), url: z.url(), enabled: z.boolean(), tools: z.array(permissionSchema),
  })),
});

export async function loadTenants(): Promise<TenantConfig[]> {
  const file = process.env.LIONETTA_TENANTS_FILE ?? resolve("config/tenants.json");
  const tenants = z.array(tenantSchema).min(1).parse(JSON.parse(await readFile(file, "utf8")));
  if (new Set(tenants.map((tenant) => tenant.id)).size !== tenants.length) throw new Error("Duplicate tenant IDs in configuration.");
  const overrides: Record<string, string | undefined> = {
    inventory: process.env.LIONETTA_INVENTORY_URL,
    pricing: process.env.LIONETTA_PRICING_URL,
    crm: process.env.LIONETTA_CRM_URL,
  };
  for (const tenant of tenants) {
    if (new Set(tenant.mcpServers.map((server) => server.id)).size !== tenant.mcpServers.length) throw new Error("Duplicate MCP server IDs in configuration.");
    for (const server of tenant.mcpServers) {
      const override = overrides[server.id];
      if (override) server.url = z.url().parse(override);
    }
  }
  return tenants;
}
