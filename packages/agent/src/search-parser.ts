/** A deliberately small parser for the credential-free local demonstration. */
export function parseVehicleSearch(prompt: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const normalized = prompt.toLowerCase();
  const brands: Array<[RegExp, string]> = [
    [/\bbmw\b/i, "BMW"],
    [/\baudi\b/i, "Audi"],
    [/\bmercedes(?:-benz)?\b/i, "Mercedes-Benz"],
    [/\btoyota\b/i, "Toyota"],
    [/\b(?:volkswagen|vw)\b/i, "Volkswagen"],
    [/\bvolvo\b/i, "Volvo"],
    [/\bskoda\b/i, "Skoda"],
  ];
  const brand = brands.find(([pattern]) => pattern.test(prompt));
  if (brand) args.brand = brand[1];

  if (/\b3\s*(?:series|serija)\b|\b320[di]\b|\b318[di]\b/i.test(prompt)) args.model = "3 Series";
  else if (/\b5\s*series\b|\b520[di]\b/i.test(prompt)) args.model = "5 Series";
  else {
    const model = prompt.match(/\b(a[1-8]|q[2-8]|x[1-7]|golf|passat|corolla|octavia)\b/i)?.[1];
    if (model) args.model = model;
  }

  if (/\bautomatic\b|\bauto\b/.test(normalized)) args.transmission = "automatic";
  else if (/\bmanual\b/.test(normalized)) args.transmission = "manual";

  // Mileage takes precedence over budget when both amounts use "under".
  const mileage = prompt.match(/(?:under|below|max(?:imum)?|up to|less than)\s*(?:mileage\s*(?:of|:)?\s*)?(\d+(?:[.,\s]\d+)*(?:\s*k\b)?)\s*(?:km|kilomet(?:er|re)s?)\b/i)
    ?? prompt.match(/\bmileage\s*(?:under|below|max(?:imum)?|up to|less than|:)?\s*(\d+(?:[.,\s]\d+)*(?:\s*k\b)?)\s*(?:km)?\b/i);
  if (mileage?.[1]) args.max_mileage = parseAmount(mileage[1]);

  const budget = prompt.match(/(?:under|below|max(?:imum)?|up to|less than|budget(?:\s+of)?|price(?:\s+of)?)\s*(?:price\s*(?:of|:)?\s*)?[€$]\s*(\d+(?:[.,\s]\d+)*(?:\s*k\b)?)/i)
    ?? prompt.match(/(?:under|below|max(?:imum)?|up to|less than|budget(?:\s+of)?|price(?:\s+of)?)\s*(\d+(?:[.,\s]\d+)*(?:\s*k\b)?)\s*(?:eur\b|euros?\b|€)/i)
    ?? [...prompt.matchAll(/(?:under|below|max(?:imum)?|up to|less than)\s*(\d+(?:[.,\s]\d+)*(?:\s*k\b)?)/gi)]
      .find((match) => !/^\s*(?:km|kilomet)/i.test(prompt.slice((match.index ?? 0) + match[0].length)));
  if (budget?.[1]) args.max_price = parseAmount(budget[1]);
  return args;
}

function parseAmount(value: string): number {
  const clean = value.trim().toLowerCase().replace(/\s/g, "");
  const multiplier = clean.endsWith("k") ? 1000 : 1;
  const raw = clean.replace(/k$/, "");
  const digits = multiplier === 1000
    ? raw.replace(",", ".")
    : raw.replace(/[,.](?=\d{3}(?:[,.]|$))/g, "").replace(",", ".");
  return Math.round(Number(digits) * multiplier);
}
