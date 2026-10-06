import type { Property, Product } from "../lib/contracts";
import { Icon } from "./brand";
const eur = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const precise = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });

export function PropertyCard({ property }: { property: Property }) {
  return <article className="vehicle-card property-card">
    <div className="vehicle-visual property-visual" aria-hidden="true"><Icon name="home" /><span>Demo listing</span></div>
    <div className="vehicle-body"><p className="vehicle-year">{property.city} · {property.neighborhood}</p><h3>{property.title}</h3>
      <div className="vehicle-price">{eur.format(property.price)}<small>{property.listingType === "rent" ? " / month" : ""}</small></div>
      <div className="vehicle-specs"><span>{property.area} m²</span><span>{property.bedrooms} bedrooms</span><span>{property.listingType}</span></div>
      <details className="vehicle-details"><summary>View property <span aria-hidden="true">＋</span></summary><p>{property.description}</p>
        <dl><div><dt>Features</dt><dd>{property.features.join(", ")}</dd></div><div><dt>Energy rating</dt><dd>{property.energyRating}</dd></div>
          <div><dt>Monthly charges</dt><dd>{eur.format(property.serviceCharges)}</dd></div><div><dt>Listing ID</dt><dd>{property.id}</dd></div></dl><p>{property.availability}</p></details>
    </div>
  </article>;
}
export function ProductCard({ product }: { product: Product }) {
  return <article className="vehicle-card product-card">
    <div className="vehicle-visual product-visual" aria-hidden="true"><Icon name="inventory" /><span>{product.sku}</span></div>
    <div className="vehicle-body"><p className="vehicle-year">{product.category} · {product.sku}</p><h3>{product.name}</h3>
      <div className="vehicle-price">{eur.format(product.unitPrice)}<small> / unit</small></div><p className="catalog-price-note">Base price, excluding VAT</p>
      <div className="vehicle-specs"><span>{product.stock.toLocaleString("en-IE")} in stock</span><span>MOQ {product.minimumOrderQuantity}</span><span>{product.leadTimeDays} days</span></div>
      <details className="vehicle-details"><summary>Specs & tiers <span aria-hidden="true">＋</span></summary><p>{product.description}</p><dl>
        {Object.entries(product.specifications).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}
        {product.priceBreaks.map(tier => <div key={tier.minQuantity}><dt>{tier.minQuantity}+ units</dt><dd>{eur.format(tier.unitPrice)} each</dd></div>)}
        <div><dt>Warranty</dt><dd>{product.warrantyMonths} months</dd></div><div><dt>Product ID</dt><dd>{product.id}</dd></div></dl></details>
    </div>
  </article>;
}
export function QuoteCards({ quotes }: { quotes: Record<string, unknown>[] }) {
  return <div className="quote-results">{quotes.map((quote, index) => {
    const amount = quote.estimated_upfront_total ?? quote.monthly_payment ?? quote.total;
    const title = quote.property_id ? "Estimated upfront costs" : quote.vehicle_id ? "Monthly financing illustration" : `${String(quote.quantity)} units · volume quote`;
    return <article className="quote-card" key={index}><span>{title}</span><strong>{typeof amount === "number" ? precise.format(amount) : "Estimate unavailable"}</strong>
      <small>{String(quote.product_name ?? quote.property_id ?? quote.vehicle_id ?? "")}</small>
      {!!quote.unit_price && <p>{precise.format(Number(quote.unit_price))} per unit · VAT {precise.format(Number(quote.vat))} · delivery {precise.format(Number(quote.shipping))}</p>}
      {!!quote.months && <p>{String(quote.months)} months · deposit {precise.format(Number(quote.down_payment))}</p>}
      <p>{String(quote.note ?? "Fictional estimate only.")}</p>
    </article>;
  })}</div>;
}
