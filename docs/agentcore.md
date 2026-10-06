# Future AWS AgentCore migration

Lionetta runs locally through npm. `infrastructure/aws` is an optional Terraform sandbox scaffold for a later deployment. It creates an execution role and an HTTP AgentCore Runtime from an image that has already been published to ECR. No AWS resources are needed for local development, and this scaffold does not deploy the web application or the inventory, pricing and CRM MCP services.

The local agent now supports native Anthropic Claude through `LIONETTA_AGENT_MODE=anthropic`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_MODEL`. For a future runtime, inject the key from managed secret storage rather than baking `.env` into the image or Terraform state. The three-domain tools and provider adapter remain behind the same invocation contract; durable data, authenticated tenants and real integrations are still migration work.

The cloud path uses Terraform `~> 1.16.0` and the HashiCorp AWS provider `~> 6.67.0`, with a committed provider lockfile. Keep Terraform as the infrastructure owner: the npm AgentCore CLI also supports TypeScript, but its deployment workflow uses CDK and would create a separate infrastructure state.

## Runtime contract

The API container must listen on `0.0.0.0:8080`. AgentCore checks `GET /ping` and forwards invocation payloads to `POST /invocations`. The health response uses `status: "Healthy"` and a Unix-seconds `time_of_last_update`; active work can report `HealthyBusy`. Invocation responses may use JSON or server-sent events. AgentCore supplies the session header `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id`.

These routes keep the local API aligned with the HTTP runtime contract. They do not establish cloud readiness. Session IDs identify conversations; authenticated user and tenant claims must establish authorization before any real inventory, pricing or CRM operation. Keep the browser app as a separate deployment and call AgentCore from an authenticated backend.

The official TypeScript SDK exposes `BedrockAgentCoreApp` from `bedrock-agentcore/runtime` and can supply the HTTP wrapper when useful. A Node HTTP implementation can also implement the same contract. Container deployment allows the repository's pinned Node runtime rather than relying on a Python-only direct-code deployment option.

## Image publication is a separate step

AgentCore's standard container deployment uses Linux ARM64. The ECR repository and its first image must exist before a future Terraform deployment; this scaffold deliberately accepts the existing repository ARN and immutable image URI as inputs. Publish to the same AWS account and region selected for the runtime. A CI publication pipeline can own ECR separately and pass the resolved digest to this Terraform root.

The following is a local image build, run from the repository root on a machine with Docker Buildx:

```bash
docker buildx build --platform linux/arm64 --target backend --load -t lionetta-api:agentcore .
```

Check the resulting image architecture and run the container's health and representative invocation checks. When a cloud sandbox is explicitly approved, authenticate Docker to the chosen ECR registry with the supported AWS CLI workflow, tag and push the release image, and resolve its ECR SHA256 digest. Pass `registry/repository@sha256:<64 hexadecimal characters>` to Terraform. Image tags are rejected by this scaffold. Publishing, cloud invocation and resource creation are separate actions; none are part of local setup.

Before publishing the API image, configure how its MCP clients reach inventory, pricing and CRM. Local child-process transports or loopback URLs need either the required server executables and data bundled in the API image, or reachable authenticated MCP server endpoints with network and credential configuration. The scaffold supplies neither deployment automatically.

## Terraform checks

The AWS root can be initialized and validated without invoking AWS APIs:

```bash
terraform -chdir=infrastructure/aws init -backend=false -input=false
terraform -chdir=infrastructure/aws fmt -check
terraform -chdir=infrastructure/aws validate
```

For a later sandbox deployment, supply these non-secret values in an ignored `.tfvars` file or through `TF_VAR_` variables:

| Input | Requirement |
| --- | --- |
| `aws_region` | Region offering the AgentCore capabilities selected for deployment. |
| `ecr_repository_arn` | Existing repository ARN in that region and deployment account. |
| `container_image_uri` | Matching published ARM64 image URI pinned by SHA256 digest. |
| `agent_runtime_name` | Optional sandbox runtime name; defaults to `lionetta_sandbox`. |

Future planning reads the AWS caller identity. Use your organization's approved AWS authentication flow; keep credentials out of Terraform input files and application source. Configure an appropriate encrypted remote state backend before team deployments. Validation checks provider schema and Terraform configuration, while a later approved deployment must verify IAM behavior, image startup, network access, health and representative requests.

The execution role restricts service assumption using the source account and a region-specific AgentCore Runtime ARN pattern. It scopes image reads to the supplied ECR repository and log writes to this runtime's log-group prefix. Its logging, X-Ray and namespace-restricted CloudWatch metrics permissions follow AWS's runtime telemetry baseline. ECR authentication and X-Ray actions require wildcard resources. Model access and integration permissions must be added for their selected resources when those adapters are implemented.

`PUBLIC` is the runtime network mode. AgentCore's default inbound invocation authorization remains IAM; a client-facing deployment must select and verify its intended IAM or JWT authorization path. Add VPC configuration if integrations require private connectivity.

## Before real clients

- Add authenticated tenant resolution, user permissions, ownership checks and tests for cross-tenant denial at the API and every MCP tool boundary.
- Replace fixture inventory and pricing with real adapters and durable CRM storage. Keep authoritative offers, leads, consents and appointments outside runtime-local memory; add managed conversation memory only where appropriate.
- Configure OAuth or service credentials through approved secret storage or AgentCore Identity. Grant each adapter only the access it needs and verify refresh, expiry and failure behavior.
- Add model selection and its resource-scoped Bedrock permissions, or the selected external provider credentials. Verify tool input validation and confirmation requirements for writes.
- Add application logs, traces, correlation IDs, metrics, retention, alarms and appropriate handling of client data. IAM telemetry permissions alone do not instrument the app.
- Complete image scanning, dependency checks, cloud smoke tests, infrastructure state management and operational deployment review.

Additional Terraform resources exist for AgentCore Memory, Gateway, Gateway Targets, Workload Identity and versioned Runtime Endpoints. Add each when its purpose and integrations are concrete rather than deploying unused services now.

## Official references

- [AWS TypeScript SDK HTTP runtime contract](https://github.com/aws/bedrock-agentcore-sdk-typescript/blob/main/src/runtime/README.md)
- [AWS container build requirements](https://github.com/aws/agentcore-cli/blob/main/src/assets/README.md)
- [AWS runtime trust-policy example](https://github.com/awslabs/amazon-bedrock-agentcore-samples/blob/d3d00ccb8dec918e10a79d2a85006d467d159648/06-workshops/02-AgentCore-gateway/12-agents-as-tools-using-mcp/lab_helpers/lab_03/agentcore_runtime_deployer.py#L152-L164)
- [AWS runtime logging, tracing and metrics policy](https://github.com/awslabs/amazon-bedrock-agentcore-samples/blob/d3d00ccb8dec918e10a79d2a85006d467d159648/01-features/02-host-your-agent/01-runtime/01-hosting-agents/01-http-protocol/01-strands-bedrock/deploy.py#L81-L127)
- [HashiCorp AgentCore Runtime resource at AWS provider v6.67.0](https://github.com/hashicorp/terraform-provider-aws/blob/v6.67.0/website/docs/r/bedrockagentcore_agent_runtime.html.markdown)
- [HashiCorp AgentCore Runtime Endpoint resource](https://github.com/hashicorp/terraform-provider-aws/blob/v6.67.0/website/docs/r/bedrockagentcore_agent_runtime_endpoint.html.markdown)
