# Local demo MCP services

These are actual Model Context Protocol Streamable HTTP servers. Run commands from the repository root so source, compiled output, and Docker share the four JSON sources in `fixtures`:

```sh
node --import tsx mcp/vehicle-inventory/src/server.ts
node --import tsx mcp/pricing/src/server.ts
node --import tsx mcp/crm/src/server.ts
```

The services default to `127.0.0.1` at ports 8001, 8002, and 8003. Each serves `GET /health` and stateless `POST /mcp`; GET streams and DELETE sessions return 405. The API connects with the SDK Streamable HTTP client and prefixes discovered tool names with their configured server ID.

`HOST`, `INVENTORY_PORT`, `PRICING_PORT`, and `CRM_PORT` override binding. Each service uses its own port variable so a shared process environment cannot bind all services to the same port. `LIONETTA_FIXTURES_DIR` overrides the fixture directory. Docker can use `HOST=0.0.0.0` and service DNS names `inventory`, `pricing`, and `crm`. Extra host-header values can be explicitly added with comma-separated `MCP_ALLOWED_HOSTS`; loopback and service hosts are allowed by default. DNS rebinding protection remains enabled.

Every tool requires `tenant_id`, validated against the union of configured fixture keys: `delta-motors`, `northside-motors`, `haven-estates`, and `atlas-wholesale`. Inventory/pricing resolve only records inside that tenant; CRM state is partitioned by tenant. Add a tenant to `config/tenants.json` and its fixture sources, then restart. The API supplies the selected local tenant and enforces its explicit tool permissions and confirmation before a write. These demo MCP endpoints have no production authentication, so keep them within a trusted local/Docker network. Tenant IDs represent a local demo selection, not verified identity.

| Service | Tools | Behavior |
| --- | --- | --- |
| Inventory | `search_vehicles`, `get_vehicle`, `search_properties`, `get_property`, `search_products`, `get_product`, `search_knowledge` | Tenant-specific vehicle/property/product data and policy articles. Searches filter budget, features, stock, MOQ and other domain fields. |
| Pricing | `get_price`, `quote_lease`, `estimate_property_costs`, `quote_bulk_order` | Fixture prices, 6% demo financing, property costs, quantity tiers, 20% demo VAT and EUR 125 wholesale delivery. |
| CRM | `create_lead`, `list_leads`, `request_viewing`, `request_quote`, `list_requests` | In-memory lead/request state, gated by host confirmation. Restarting CRM clears records. |

Tool inputs and fixture records use Zod schemas. Text and `structuredContent` carry the same data. Unknown IDs do not expose another tenant's data. Each tenant's allowlist exposes only its domain tools. [The playbook](../docs/demo-playbook.md) describes records and representative calculations. None of the tools contacts a real dealer, property owner, CRM, calendar or supplier.
