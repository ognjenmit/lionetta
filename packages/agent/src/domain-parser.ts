function amount(value: string): number { return Number(value.replace(/[,\s]/g, "")); }
function budget(prompt: string): number | undefined {
  const match = prompt.match(/(?:under|below|up to|budget(?: of)?|maximum)\s*€?\s*([\d,]+)(?:\s*(k))?/i);
  return match ? amount(match[1]!) * (match[2] ? 1000 : 1) : undefined;
}
export function parsePropertySearch(prompt: string): Record<string, unknown> {
  const args: Record<string, unknown> = { listing_type: /\brent(?:al|ing)?\b/i.test(prompt) ? "rent" : "sale" };
  if (/\bbelgrade|beograd\b/i.test(prompt)) args.city = "Belgrade";
  else if (/novi sad/i.test(prompt)) args.city = "Novi Sad";
  const beds = prompt.match(/(\d+)[ -]?(?:bedroom|bed)\b/i);
  if (beds) args.min_bedrooms = Number(beds[1]);
  const price = budget(prompt); if (price !== undefined) args.max_price = price;
  const area = prompt.match(/(?:at least|min(?:imum)?)\s*(\d+)\s*(?:m²|m2|sqm)/i); if (area) args.min_area = Number(area[1]);
  const features = ["Parking", "Balcony", "Garden", "Elevator", "Garage", "Furnished"].filter(feature => prompt.toLowerCase().includes(feature.toLowerCase()));
  if (features.length) args.required_features = features;
  if (/\bhouse\b/i.test(prompt)) args.property_type = "house";
  else if (/\bapartment\b/i.test(prompt)) args.property_type = "apartment";
  else if (/\boffice\b/i.test(prompt)) args.property_type = "office";
  return args;
}
export function parseProductSearch(prompt: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const [pattern, category] of [[/chairs?/i, "office chairs"], [/desks?/i, "desks"], [/monitors?/i, "monitors"], [/laptops?/i, "laptops"], [/rack|warehouse/i, "warehouse"], [/gloves|safety/i, "safety equipment"]] as const) {
    if (pattern.test(prompt)) { args.category = category; break; }
  }
  const quantity = prompt.match(/(\d[\d,]*)\s*(?:office\s+)?(?:units?|chairs?|desks?|monitors?|laptops?|racks?|packs?|products?)\b/i);
  if (quantity) args.quantity = amount(quantity[1]!);
  const unitPrice = prompt.match(/(?:under|below|up to)\s*€?\s*([\d,]+)\s*(?:per|each|a unit)/i);
  if (unitPrice) args.max_unit_price = amount(unitPrice[1]!);
  return args;
}
