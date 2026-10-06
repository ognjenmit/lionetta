# Lionetta

One conversation, every system.

A local car-advisor MVP built with **TypeScript, npm, Next.js, and real MCP connections**. It includes configurable demo dealerships, vehicle cards, inventory/pricing/CRM MCP services, and a separate Terraform scaffold for future AWS Bedrock AgentCore deployment.

The demo pairs Lionetta's dark green-and-violet lion identity with a light Rivermore client website and embedded assistant. Generated lion artwork and illustrative vehicle images are served locally from `apps/web/public`; vehicle specifications and prices still come from the MCP fixture data.

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

Try `integrations`, `list leads`, and `create lead: Alex | alex@example.com | bmw-320d-001`. Creating a lead shows the exact proposed action and requires an explicit confirmation. Confirmation tokens belong to one tenant and conversation, expire after ten minutes, and can be used once. Northside's CRM writes are disabled.

## Optional API model

The default agent is a small deterministic parser that proves the local MCP workflow. For broader conversations, set these values in your ignored `.env`:

```dotenv
LIONETTA_AGENT_MODE=openai
LIONETTA_MODEL_API_KEY=your-key-entered-locally
LIONETTA_MODEL=gpt-4.1-mini
```

Restart the services after changing `.env`. The OpenAI adapter discovers the same permitted tools and enforces the same confirmation gate; only model reasoning leaves your machine. `LIONETTA_MODEL_BASE_URL` supports a compatible endpoint, with default `https://api.openai.com/v1`. Live provider calls require your credentials and were not part of credential-free validation. No secret values belong in source code, Terraform files, logs, or chat.

## Docker Compose

With Docker and the Compose plugin installed:

```sh
docker compose up --build
docker compose down
```

Compose runs the same five services, binds exposed ports to your laptop's loopback interface, and waits for backend health checks. It uses `.env` for the optional model settings. Fixture inventory is stored in JSON; demo leads, conversation history, and pending confirmations are in memory and reset on restart. PostgreSQL and real system adapters belong to the next phase.

## Validate

```sh
npm run verify
```

This checks backend/frontend types, runs meaningful agent and policy tests plus a real HTTP/MCP integration suite, builds both applications, and exercises the compiled five-service stack through the Next.js API proxy. Tests cover the BMW example, tool discovery, tenant scoping, disabled tools, confirmation and replay denial, malformed requests, and the optional model loop using a fake local model endpoint.

For the compiled stack, run `npm run build && npm start`. The app intentionally has no login or billing in this phase. Selecting a demo tenant and supplying a session ID are **not authentication**; use fixture data until trusted user identity and authorization are implemented.

With either the npm or Compose stack already running, `npm run check:running` checks every service and the representative BMW request through the UI proxy.

## Layout and configuration

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js chat UI and fixed API proxy routes |
| `apps/api` | Node HTTP API with `/ping`, `/tenants`, and `/invocations` |
| `packages/agent` | Demo parser, optional model loop, history and confirmations |
| `packages/mcp-client` | MCP discovery, namespaced tool routing and permissions |
| `packages/shared` | Shared TypeScript contracts |
| `mcp` | Inventory, pricing/leasing, and CRM Streamable HTTP servers |
| `config/tenants.json` | Branding, prompts, models, MCP URLs and per-tool policy |
| `fixtures/vehicles.json` | Separate inventory per demo tenant |
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
