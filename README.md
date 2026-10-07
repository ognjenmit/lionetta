# Lionetta

One conversation, every system.

A local assistant platform built with **TypeScript, npm, Next.js, Anthropic Claude, and real MCP connections**. Explore cars, real estate, and B2B wholesale through configurable business tenants, inventory/pricing/CRM MCP services, and a separate Terraform scaffold for future AWS Bedrock AgentCore deployment.

The demo pairs Lionetta's dark green-and-purple lioness identity with a light Rivermore client website and embedded assistant. The simple lioness logo has subtle feminine facial contours and is used consistently in the header, hero, integration diagram, assistant, footer, and browser icons. The transparent logo lives at `apps/web/public/brand/lionetta-lioness-logo.png`; illustrative vehicle images are also served locally from `apps/web/public`. Vehicle specifications and prices still come from the MCP fixture data.

## Start locally

Use Node **24.19.0** and npm **11.9.0**. If you use nvm, run `nvm install && nvm use` first.

```sh
npm ci
npm run dev
```

This starts the whole stack: Next.js on port **3000**, the API on **8080**, and the inventory, pricing, and CRM MCP services on **8001–8003**. Open your laptop's browser at `127.0.0.1:3000`. Ctrl+C stops the services. TypeScript backends restart after source changes; Next.js updates the UI during development.

No credentials or AWS resources are needed in default demo mode. Optional settings can go in `.env`, based on `.env.example`; this file is ignored by Git. Keep the ports and MCP endpoint overrides consistent when changing the defaults.

Try the sample request:

> I want a BMW 3 Series under €25,000, automatic and below 50,000 km.

For Rivermore, this discovers `inventory.search_vehicles`, searches fixture data, retrieves prices through `pricing.get_price`, and displays three matching BMWs. Switch to Northside Motors to use a different inventory and tool policy. Rivermore retains the `delta-motors` demo identifier in configuration and fixtures.

The demo section also offers **Haven Estates** (`haven-estates`) and **Atlas Wholesale** (`atlas-wholesale`). Each example has an extended starting prompt and follow-up actions. Fixtures include **22 vehicles, 12 properties, 12 products, and 16 business-policy articles**. [The demo playbook](docs/demo-playbook.md) includes prompts, expected calculations, and instructions for extending the data.

Try `integrations`, `list leads`, and `create lead: Alex | alex@example.com | bmw-320d-001`. Leads, viewing requests, and B2B quote requests show the exact proposed action and require explicit confirmation. Confirmation tokens belong to one tenant and conversation, expire after ten minutes, and can be used once. Northside's CRM writes are disabled.

## Connect Claude

The application and its MCP services run locally; Claude reasoning uses Anthropic's hosted API. Put your own API key in **`.env`**, which is ignored by Git, rather than in TypeScript source. Copy `.env.example` to `.env` if it does not exist, then set:

```dotenv
LIONETTA_AGENT_MODE=anthropic
ANTHROPIC_API_KEY=your-key-entered-locally
ANTHROPIC_MODEL=claude-sonnet-4-6
```

Restart `npm run dev` (or restart Compose) after changing the file. `ANTHROPIC_MODEL` is configurable; `ANTHROPIC_BASE_URL` optionally changes the endpoint and defaults to `https://api.anthropic.com`. The browser never receives the key. Claude discovers each tenant's permitted tools and uses native Anthropic `tool_use` / `tool_result` messages. It retains complete turns and source results for follow-up questions, with histories separated by tenant and session and bounded to eight turns. CRM actions still require host confirmation.

Without a key, leave `LIONETTA_AGENT_MODE=demo` to use the three deterministic demo workflows. The Claude adapter was validated against a local fake Anthropic endpoint; live Anthropic calls require your key and were not made during credential-free validation.

## Optional API model

OpenAI remains an alternative provider. Set these values in your ignored `.env`:

```dotenv
LIONETTA_AGENT_MODE=openai
LIONETTA_MODEL_API_KEY=your-key-entered-locally
LIONETTA_MODEL=gpt-4.1-mini
```

Restart the services after changing `.env`. The OpenAI adapter discovers the same permitted tools and enforces the same confirmation gate. `LIONETTA_MODEL_BASE_URL` supports a compatible endpoint, with default `https://api.openai.com/v1`. Provider settings stay on the backend.

## Docker Compose

With Docker and the Compose plugin installed:

```sh
docker compose up --build
docker compose down
```

Compose runs the same five services, binds exposed ports to your laptop's loopback interface, and waits for backend health checks. It uses `.env` for Claude or OpenAI settings. Fixture sources are stored in JSON; demo leads/viewing/quote requests, conversation history, and pending confirmations are in memory and reset on restart. PostgreSQL and real system adapters belong to the next phase.

## Validate

```sh
npm run verify
```

This checks backend/frontend types, runs meaningful agent and policy tests plus a real HTTP/MCP integration suite, builds both applications, and exercises the compiled five-service stack through the Next.js API proxy. Tests cover all three domains, stock/MOQ/quantity pricing, property costs, tool discovery, tenant scoping, confirmation and replay denial, malformed requests, and both provider protocols using fake local endpoints.

For the compiled stack, run `npm run build && npm start`. The app intentionally has no login or billing in this phase. Selecting a demo tenant and supplying a session ID are **not authentication**; use fixture data until trusted user identity and authorization are implemented.

With either the npm or Compose stack already running, `npm run check:running` checks every service and the car, real estate, and B2B examples through the UI proxy.

### Troubleshoot an unavailable API

If `/api/tenants` returns 503, Next.js cannot reach the Lionetta API; this happens before a model request. The web terminal logs a transport code such as `ECONNREFUSED`. Check the earlier `[api]` startup/error lines. Keep each `.env` setting on its own line and place the file beside the root `package.json`.

After pulling dependency changes, run `npm ci` from the repository root before restarting. An `ERR_MODULE_NOT_FOUND` error for `@anthropic-ai/sdk` means the local dependency installation is incomplete or outdated. The shared agent imports both provider SDKs at startup, including when OpenAI mode is selected.

To expose an API startup failure directly, stop `npm run dev` with Ctrl+C, then run this from the repository root:

```sh
node --env-file=.env --import tsx apps/api/src/server.ts
```

The API should announce its configured mode and listening address. With the default ports, `http://127.0.0.1:8080/ping` should return a healthy status. After diagnosing the error, stop the direct API process and use `npm run dev` again to start all five services. Use the pinned Node 24 runtime. If the API is healthy but the web proxy fails, check `API_ORIGIN`; for local development with default ports it is `http://127.0.0.1:8080`.

If a chat reaches OpenAI but returns HTTP 429, the assistant distinguishes known provider codes: `insufficient_quota` means API credits/quota or spending limits need attention; `billing_hard_limit_reached` points to a billing/spending limit; `rate_limit_exceeded` means wait and retry or review API rate limits. Check your API project's [billing](https://platform.openai.com/settings/organization/billing/overview) and [limits](https://platform.openai.com/settings/organization/limits). ChatGPT subscriptions and API billing are separate. Unknown 429 responses show general guidance; raw provider error text and unknown codes are not exposed.

## Layout and configuration

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js chat UI and fixed API proxy routes |
| `apps/api` | Node HTTP API with `/ping`, `/tenants`, and `/invocations` |
| `packages/agent` | Claude/OpenAI adapters, demo parsers, history and confirmations |
| `packages/mcp-client` | MCP discovery, namespaced tool routing and permissions |
| `packages/shared` | Shared TypeScript contracts |
| `mcp` | Inventory, pricing/leasing, and CRM Streamable HTTP servers |
| `config/tenants.json` | Branding, prompts, models, MCP URLs and per-tool policy |
| `fixtures/vehicles.json` | Separate inventory per demo tenant |
| `fixtures/properties.json` | Property locations, features, prices, rental charges |
| `fixtures/products.json` | Product specs, MOQ, stock, lead times and quantity price tiers |
| `fixtures/knowledge.json` | Tenant-specific warranties, policies and business terms |
| `infrastructure/local` | Local runtime contract; no cloud resources |
| `infrastructure/aws` | Future AgentCore Terraform scaffold |

MCP tools are prefixed by server ID, such as `inventory.search_vehicles`. The router overwrites `tenant_id` from the selected tenant configuration, excludes disabled tools from discovery, and checks permissions again before execution. Adding demo tenants means adding configuration and fixture entries, then restarting the stack. This local policy boundary will later need authenticated tenant resolution at the API and MCP layers.

## Terraform and future AWS

Use Terraform **1.16.5**. Local validation does not require AWS credentials:

```sh
npm run tf:local -- init -input=false
npm run tf:local -- validate
npm run tf:local -- plan -input=false
npm run tf:aws -- init -backend=false -input=false -lockfile=readonly
npm run tf:aws -- validate
```

The local root documents the runtime contract; it does not launch the services. The AWS root uses a locked AWS provider and requires an existing ARM64 ECR image pinned by digest. No AWS resources have been deployed. [The migration plan](docs/agentcore.md) covers Terraform ownership, API image packaging, web/MCP deployment, real adapters, durable storage and authenticated client access.

## Codex cloud setup

Use the existing `/workspace/lionetta` checkout. Each cloud task is isolated; a Git worktree is unnecessary.

`bash scripts/setup-cloud.sh` reproduces the Linux x86_64 environment with checksum-verified Terraform, `npm ci`, builds, functional checks and Terraform validation. The npm cache and Terraform binary are kept under writable workspace paths. Startup is separate because live processes do not survive environment snapshots:

```sh
export PATH=/workspace/.lionetta-tools/bin:$PATH
export NPM_CONFIG_CACHE=/workspace/.cache/npm
cd /workspace/lionetta
npm run dev
```

Verify API health and make the BMW invocation after starting. The reusable cloud installation and startup instructions are saved in environment settings for review; publishing the environment is a separate user action.

Docker builds inside this cloud host need its proxy DNS mapping and trusted CA; `bash scripts/build-docker-cloud.sh` supplies these without retaining proxy credentials or the certificate in the image. Then use `DOCKER_CONFIG=/workspace/.cache/docker docker compose -p lionetta-onboarding up --no-build --wait`, with the npm stack stopped to free its ports. Ordinary laptop builds use the standard Compose command above.
