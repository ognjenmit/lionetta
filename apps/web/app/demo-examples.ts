import type { Domain } from "../lib/contracts";

export const demoExperiences: Record<Domain, {
  tenantId: string; title: string; description: string; prompt: string; journey: string[];
  icon: "car" | "home" | "inventory"; tagline: string; headline: string; subhead: string;
  inventoryLabel: string; emptyLabel: string; placeholder: string; browse: string;
  examples: { title: string; prompt: string }[];
}> = {
  cars: {
    tenantId: "delta-motors", title: "Cars & mobility", description: "Search vehicles, compare equipment and history, explore financing, then save a customer lead.",
    prompt: "I want a BMW 3 Series under €25,000, automatic and below 50,000 km. Compare their features and service histories.",
    journey: ["Inventory & specifications", "Financing & warranty", "Confirmed customer lead"], icon: "car", tagline: "Premium motoring",
    headline: "Find your next chapter.", subhead: "The right car starts with a conversation.", inventoryLabel: "Your matching vehicles", emptyLabel: "A car that fits your life",
    placeholder: "Ask about cars, budget, or mileage…", browse: "Show me available cars.",
    examples: [{ title: "Find my next BMW", prompt: "I want a BMW 3 Series under €25,000, automatic and below 50,000 km. Compare their features and service histories." },
      { title: "Compare financing", prompt: "lease quote: bmw-320d-001 | 48 | 3000" },
      { title: "Try a CRM action", prompt: "create lead: Alex | alex@example.com | bmw-320d-001" }],
  },
  "real-estate": {
    tenantId: "haven-estates", title: "Real estate", description: "Compare homes by location, budget and features, estimate buying costs, then request a viewing.",
    prompt: "Find apartments for sale in Belgrade under €250,000 with at least 2 bedrooms and parking. Compare neighborhoods and estimate upfront buying costs.",
    journey: ["Listings & neighborhood details", "Purchase or rental costs", "Confirmed viewing request"], icon: "home", tagline: "Thoughtful real estate",
    headline: "Find a place to call home.", subhead: "Your next address starts with what matters to you.", inventoryLabel: "Your matching properties", emptyLabel: "A place that fits your life",
    placeholder: "Ask about location, budget, or bedrooms…", browse: "Show apartments for sale in Belgrade.",
    examples: [{ title: "Find a home", prompt: "Find apartments for sale in Belgrade under €250,000 with at least 2 bedrooms and parking. Compare neighborhoods and estimate upfront buying costs." },
      { title: "Explore rental terms", prompt: "knowledge: rental terms deposit pets" },
      { title: "Request a viewing", prompt: "request viewing: Maya | maya@example.com | belgrade-riverside-201 | 2026-11-12 14:00 Europe/Belgrade" }],
  },
  b2b: {
    tenantId: "atlas-wholesale", title: "B2B wholesale", description: "Source products at scale, check stock and specifications, calculate volume discounts, then request a quote.",
    prompt: "We need 500 office chairs for a workplace rollout. Compare suitable products, volume discounts, lead times, and total prices including VAT and delivery.",
    journey: ["Catalog, MOQ & stock", "Volume pricing & delivery", "Confirmed quote request"], icon: "inventory", tagline: "Supply for ambitious businesses",
    headline: "Equip your next big move.", subhead: "From a product shortlist to a clear volume quote.", inventoryLabel: "Your matching products", emptyLabel: "Products for your next project",
    placeholder: "Ask about products, quantities, or delivery…", browse: "Show wholesale products.",
    examples: [{ title: "Compare 500 chairs", prompt: "We need 500 office chairs for a workplace rollout. Compare suitable products, volume discounts, lead times, and total prices including VAT and delivery." },
      { title: "Check payment terms", prompt: "knowledge: payment terms warranty delivery" },
      { title: "Request a quote", prompt: "request quote: Acme Studio | Maya | maya@example.com | ergonomic-chair-pro | 500" }],
  },
};
