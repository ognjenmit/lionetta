#!/usr/bin/env bash
set -euo pipefail
cd /workspace/lionetta
: "${HTTPS_PROXY:?The cloud HTTPS proxy binding is required}"
: "${NODE_EXTRA_CA_CERTS:?The cloud trusted CA binding is required}"
export DOCKER_CONFIG=${DOCKER_CONFIG:-/workspace/.cache/docker}
mkdir -p "$DOCKER_CONFIG"
lionetta_proxy_host=$(python3 - <<'PY'
import os,urllib.parse
host=urllib.parse.urlsplit(os.environ['HTTPS_PROXY']).hostname
if not host: raise SystemExit('Cloud proxy hostname is missing')
print(host)
PY
)
lionetta_proxy_address=$(getent ahostsv4 "$lionetta_proxy_host" | awk 'NR == 1 { address=$1 } END { print address }')
test -n "$lionetta_proxy_address"
lionetta_project=${LIONETTA_COMPOSE_PROJECT:-lionetta-onboarding}
build_options=(--network=host --add-host "$lionetta_proxy_host:$lionetta_proxy_address"
  --secret "id=cloud_ca,src=$NODE_EXTRA_CA_CERTS"
  --build-arg HTTP_PROXY --build-arg HTTPS_PROXY --build-arg NO_PROXY)
docker build "${build_options[@]}" --target backend \
  --tag "$lionetta_project-api" --tag "$lionetta_project-inventory" \
  --tag "$lionetta_project-pricing" --tag "$lionetta_project-crm" .
docker build "${build_options[@]}" --target web --tag "$lionetta_project-web" .
