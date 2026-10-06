# Explore the local demo

Select an example in the demo section or use the business dropdown. All sources are fictional JSON fixtures, not real listings or customer records. Claude can handle natural follow-up questions after you enable it in `.env`; credential-free demo mode supports the displayed examples and structured commands below.

## Cars: Rivermore

Start with:

> I want a BMW 3 Series under €25,000, automatic and below 50,000 km. Compare their features and service histories.

Expected: three matching BMWs, with prices confirmed through the pricing MCP. Open the cards to compare equipment and service history. With Claude, ask: “Which is best for long motorway trips?”, “What does the warranty include?”, or “Compare payments over 48 and 60 months with a €3,000 deposit.” The answers should use fixture facts, policy articles, and the financing tool rather than invented offers.

Demo commands:

```text
lease quote: bmw-320d-001 | 48 | 3000
knowledge: warranty inspection
Show electric cars under €35,000
create lead: Alex | alex@example.com | bmw-320d-001
list leads
```

Financing uses a fictional 6% annual rate with no fees or residual value. A lead remains pending until you click the confirmation button. Try Northside Motors to see separate inventory and disabled CRM writes.

## Real estate: Haven Estates

Start with:

> Find apartments for sale in Belgrade under €250,000 with at least 2 bedrooms and parking. Compare neighborhoods and estimate upfront buying costs.

Expected: three fictional matches. The EUR 219,000 Riverside apartment has an estimated upfront total of EUR 229,655: asking price + 2.5% demo transfer tax + 2% agency fee + EUR 800 legal allowance. Asking-price budget and total purchase cost are different; the EUR 239,000 apartment's estimated total is EUR 250,555. The model should make this difference clear.

With Claude, ask: “Which has the lowest monthly charges?”, “Can you compare New Belgrade and Zvezdara?”, “Show rentals under €1,000 with parking”, or “What documents should I check before buying?”

Demo commands:

```text
property costs: belgrade-riverside-201
Find apartments for rent in Belgrade under €1,000 with parking
knowledge: rental terms deposit pets
request viewing: Maya | maya@example.com | belgrade-riverside-201 | 2026-11-12 14:00 Europe/Belgrade
list requests
```

A viewing request saves only an in-memory demo record after confirmation. It does not contact an owner or book a real appointment. Dates in examples are sample text; change them to your preferred date and timezone.

## B2B: Atlas Wholesale

Start with:

> We need 500 office chairs for a workplace rollout. Compare suitable products, volume discounts, lead times, and total prices including VAT and delivery.

Expected: two products meet MOQ and stock requirements; the executive chair has only 320 units and is excluded. Chair Pro's 500-unit tier is EUR 105 per unit, giving EUR 52,500 subtotal + EUR 125 delivery + EUR 10,525 demo VAT = **EUR 63,150** total. Task Chair Lite totals EUR 45,150. Product cards show base prices excluding VAT; quote cards show the discounted order total.

With Claude, ask: “How does the price change at 250 versus 500 units?”, “What if we need 2,000 units?”, “Compare warranties and lead times”, “What are the payment terms?”, or “Build a separate quote for 500 monitors.”

Demo commands:

```text
bulk quote: ergonomic-chair-pro | 500
bulk quote: ergonomic-chair-pro | 250
knowledge: payment terms delivery warranty
request quote: Acme Studio | Maya | maya@example.com | ergonomic-chair-pro | 500
list requests
```

Quotes enforce stock and minimum order quantity, choose the highest eligible price tier, add fictional 20% VAT and EUR 125 delivery, and are non-binding. A confirmed quote request does not place an order, reserve stock, or send a message.

## Extend the sources

| Source | Records | Useful fields |
| --- | --- | --- |
| `fixtures/vehicles.json` | 22 | Budget, mileage, fuel, transmission, body type, equipment, service history |
| `fixtures/properties.json` | 12 | Sale/rent, city, neighborhood, area, bedrooms, amenities, service charges |
| `fixtures/products.json` | 12 | SKU, specs, stock, MOQ, lead time, warranty, quantity-price breaks |
| `fixtures/knowledge.json` | 16 | Tenant policies, financing, purchase costs, delivery and payment terms |

Each file is keyed by tenant ID. Edit JSON, keep IDs unique within the tenant, and restart the services so changes load. Add tenants through `config/tenants.json`, with a `domain` of `cars`, `real-estate`, or `b2b`, the appropriate source records, and explicit tool permissions. The new domain tools use the existing inventory/pricing/CRM services on ports 8001–8003. `LIONETTA_FIXTURES_DIR` selects an alternative folder containing all four JSON files.

Chat history, leads, viewings, quote requests, and confirmation tokens reset when their owning process restarts. There is no durable production database or authentication yet. For a future real client, replace these sources behind the same MCP contracts, authenticate tenant selection, persist business records, and inject provider/integration credentials through managed secret storage.
