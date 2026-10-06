# Local demo MCP services

These are actual Model Context Protocol Streamable HTTP servers, not REST tool simulators. Run commands from the repository root so source, compiled output, and Docker share the same `fixtures/vehicles.json`:

```sh
node --import tsx mcp/vehicle-inventory/src/server.ts
node --import tsx mcp/pricing/src/server.ts
node --import tsx mcp/crm/src/server.ts
```

The services default to `127.0.0.1` at ports 8001, 8002, and 8003. Each serves `GET /health` and stateless `POST /mcp`; GET streams and DELETE sessions return 405. The API connects with the SDK Streamable HTTP client and prefixes discovered tool names with their configured server ID.

`HOST`, `INVENTORY_PORT`, `PRICING_PORT`, and `CRM_PORT` override binding. Each service uses its own port variable so a shared process environment cannot bind all services to the same port. `LIONETTA_FIXTURES_DIR` overrides the fixture directory. Docker can use `HOST=0.0.0.0` and service DNS names `inventory`, `pricing`, and `crm`. Extra host-header values can be explicitly added with comma-separated `MCP_ALLOWED_HOSTS`; loopback and service hosts are allowed by default. DNS rebinding protection remains enabled.

Every tool requires `tenant_id`, validated against the configured fixture keys (defaults: `delta-motors` and `northside-motors`). Inventory and pricing only resolve vehicles inside that tenant; CRM state is partitioned by tenant. Add a tenant to `config/tenants.json` and `fixtures/vehicles.json`, then restart, to extend the demo without changing server code. The API supplies the selected local tenant and enforces its tool permissions and confirmation before executing a CRM write. These demo MCP endpoints have no production authentication, so keep them within a trusted local/Docker network. Tenant IDs represent a local demo selection, not verified identity.

| Service | Tools | Behavior |
| --- | --- | --- |
| Inventory | `search_vehicles`, `get_vehicle` | Case-insensitive brand/model matching, maximum EUR price and kilometre mileage, transmission filter. |
| Pricing | `get_price`, `quote_lease` | Fixture price; deterministic demo financing illustration at 6% annual rate. |
| CRM | `create_lead`, `list_leads` | In-memory lead state; restarting CRM clears leads. |

All tool inputs, fixture records, and successful structured outputs use Zod schemas. Text and `structuredContent` carry the same data. Unknown vehicles do not expose data from the other tenant. The delta fixture contains three automatic BMW 3 Series cars under €25,000 with less than 50,000 km, plus contrasting inventory records for filter validation.
