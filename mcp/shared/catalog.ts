import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { Property, Product } from "../../packages/shared/src/index.js";

export const propertySchema = z.object({
  id: z.string().min(1), title: z.string().min(1), listingType: z.enum(["sale", "rent"]),
  propertyType: z.enum(["apartment", "house", "office"]), city: z.string(), neighborhood: z.string(),
  price: z.number().positive(), bedrooms: z.number().int().nonnegative(), bathrooms: z.number().int().positive(),
  area: z.number().positive(), features: z.array(z.string()), description: z.string(), energyRating: z.string(),
  availability: z.string(), serviceCharges: z.number().nonnegative(), url: z.string(),
});
export const productSchema = z.object({
  id: z.string().min(1), sku: z.string(), name: z.string(), category: z.string(), unitPrice: z.number().positive(),
  stock: z.number().int().nonnegative(), minimumOrderQuantity: z.number().int().positive(), leadTimeDays: z.number().int().nonnegative(),
  description: z.string(), specifications: z.record(z.string(), z.string()),
  priceBreaks: z.array(z.object({ minQuantity: z.number().int().positive(), unitPrice: z.number().positive() })),
  warrantyMonths: z.number().int().nonnegative(), url: z.string(),
});
export const knowledgeSchema = z.object({ id: z.string(), title: z.string(), content: z.string(), tags: z.array(z.string()) });
const directory = process.env.LIONETTA_FIXTURES_DIR ?? resolve("fixtures");

function load<T extends { id: string }>(file: string, schema: z.ZodType<T>): Record<string, T[]> {
  const parsed = z.record(z.string().regex(/^[a-z0-9-]+$/), z.array(schema)).parse(JSON.parse(readFileSync(resolve(directory, file), "utf8")));
  for (const records of Object.values(parsed)) {
    if (new Set(records.map(record => record.id)).size !== records.length) throw new Error(`Duplicate record IDs in ${file}.`);
  }
  return parsed;
}
const properties = load("properties.json", propertySchema);
const products = load("products.json", productSchema);
const knowledge = load("knowledge.json", knowledgeSchema);
export const catalogTenantIds = [...new Set([...Object.keys(properties), ...Object.keys(products), ...Object.keys(knowledge)])];
export const propertiesForTenant = (tenant: string): readonly Property[] => properties[tenant] ?? [];
export const productsForTenant = (tenant: string): readonly Product[] => products[tenant] ?? [];
export const knowledgeForTenant = (tenant: string) => knowledge[tenant] ?? [];
export const findProperty = (tenant: string, id: string) => propertiesForTenant(tenant).find(record => record.id === id);
export const findProduct = (tenant: string, id: string) => productsForTenant(tenant).find(record => record.id === id);
