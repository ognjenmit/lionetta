#!/usr/bin/env bash
set -euo pipefail

# Cloud onboarding only; ordinary local development uses npm ci.
cd /workspace/lionetta
test "$(node -p 'process.versions.node.split(".")[0]')" = 24
export NPM_CONFIG_CACHE=/workspace/.cache/npm
export NEXT_TELEMETRY_DISABLED=1
export PATH=/workspace/.lionetta-tools/bin:$PATH

terraform_version=1.16.5
terraform_sha=2bc2fcfff033265c9e02ca0351f01794eb122f62a9b2a49a3294b9e49eaab5e4
test "$(uname -s)" = Linux
test "$(uname -m)" = x86_64
download_dir=$(mktemp -d /tmp/lionetta-terraform.XXXXXX)
trap 'rm -rf "$download_dir"' EXIT
artifact="terraform_${terraform_version}_linux_amd64.zip"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "https://releases.hashicorp.com/terraform/${terraform_version}/${artifact}" \
  --output "$download_dir/$artifact"
(
  cd "$download_dir"
  printf '%s  %s\n' "$terraform_sha" "$artifact" | sha256sum --check
)
mkdir -p /workspace/.lionetta-tools/bin
unzip -o "$download_dir/$artifact" terraform -d /workspace/.lionetta-tools/bin
terraform version
npm ci --no-audit --no-fund
npm run verify
terraform -chdir=infrastructure/local init -input=false
terraform -chdir=infrastructure/local validate
terraform -chdir=infrastructure/local plan -input=false
terraform -chdir=infrastructure/aws init -backend=false -input=false -lockfile=readonly
terraform -chdir=infrastructure/aws validate
terraform fmt -check -recursive infrastructure
