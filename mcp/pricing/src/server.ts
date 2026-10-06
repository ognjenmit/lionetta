import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { findVehicle, tenantIdSchema, toolError, toolResult } from '../../shared/data.js';
import { startMcpHttpServer } from '../../shared/http.js';
import { findProperty, findProduct } from '../../shared/catalog.js';

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
  server.registerTool('estimate_property_costs', {
    description: 'Estimate fictional property purchase/rental costs. Resale: 2.5% transfer tax, 2% agency fee and EUR 800 notary/legal allowance. Rental: first month, one-month deposit/fee and service charges. Not legal/tax advice.',
    inputSchema: { tenant_id: tenantIdSchema, property_id: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ tenant_id, property_id }) => {
    const property = findProperty(tenant_id, property_id);
    if (!property) return toolError('Property not found in this tenant.');
    const purchase = property.listingType === 'sale';
    const tax = purchase ? Math.round(property.price * .025 * 100) / 100 : 0;
    const agency = purchase ? Math.round(property.price * .02 * 100) / 100 : property.price;
    const legal = purchase ? 800 : 0;
    const deposit = purchase ? 0 : property.price;
    return toolResult({ property_id, currency: 'EUR', demo: true, listing_type: property.listingType,
      asking_price: property.price, transfer_tax: tax, agency_fee: agency, legal_allowance: legal, refundable_deposit: deposit,
      estimated_upfront_total: Math.round((property.price + tax + agency + legal + deposit + (purchase ? 0 : property.serviceCharges)) * 100) / 100,
      monthly_service_charges: property.serviceCharges, note: purchase ? 'Illustrative resale costs; excludes mortgage, renovations, exemptions and new-build VAT.' : 'First month plus deposit/agency fee and service charges. Utilities excluded.' });
  });
  server.registerTool('quote_bulk_order', {
    description: 'Calculate a non-binding demo wholesale quotation for one product and quantity. Enforces MOQ/stock, applies the highest eligible volume tier, adds 20% demo VAT and EUR 125 delivery. No order or stock reservation.',
    inputSchema: { tenant_id: tenantIdSchema, product_id: z.string(), quantity: z.number().int().min(1).max(100000) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ tenant_id, product_id, quantity }) => {
    const product = findProduct(tenant_id, product_id);
    if (!product) return toolError('Product not found in this tenant.');
    if (quantity < product.minimumOrderQuantity) return toolError(`Minimum order quantity is ${product.minimumOrderQuantity}.`);
    if (quantity > product.stock) return toolError(`Only ${product.stock} units are available in the demo stock.`);
    const unitPrice = product.priceBreaks.filter(tier => quantity >= tier.minQuantity).sort((a, b) => b.minQuantity - a.minQuantity)[0]?.unitPrice ?? product.unitPrice;
    const subtotal = Math.round(unitPrice * quantity * 100) / 100;
    const shipping = 125;
    const vat = Math.round((subtotal + shipping) * .2 * 100) / 100;
    return toolResult({ product_id, sku: product.sku, product_name: product.name, quantity, unit_price: unitPrice, subtotal,
      shipping, vat, vat_rate: .2, total: Math.round((subtotal + shipping + vat) * 100) / 100,
      savings_ex_vat: Math.round((product.unitPrice - unitPrice) * quantity * 100) / 100,
      lead_time_days: product.leadTimeDays, currency: 'EUR', valid_days: 14, demo: true,
      note: 'Non-binding demo quote. No stock is reserved and no order is placed.' });
  });
  return server;
}

startMcpHttpServer({ name: 'pricing', defaultPort: 8002, portVariable: 'PRICING_PORT', createMcpServer });
