#!/usr/bin/env bash
# Build, apply both Terraform stacks, publish the UI. Used by CI and by hand.
# Needs AWS credentials (CI: OIDC role; laptop: `source scripts/aws-env.sh`)
# and CLOUDFLARE_API_TOKEN. Optional: RISEUP_PAT + PAT_EXPIRES_AT to store or
# rotate the RiseUp token, TF_VAR_google_client_secret for Google sign-in.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Identity of this deployment (names, account, domain) comes from the
# environment, never from the repo: see scripts/config.sh and .env.example.
if [ -z "${CI:-}" ]; then source scripts/aws-env.sh; else source scripts/config.sh; fi
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${HUB_DOMAIN:?HUB_DOMAIN is required}"
: "${ACCESS_TEAM_DOMAIN:?ACCESS_TEAM_DOMAIN is required}"
export TF_IN_AUTOMATION=1 TF_INPUT=0

# Run logs of a public repo are public. GitHub masks whole secrets only, so the
# addresses inside the JSON lists are masked one by one.
if [ -n "${GITHUB_ACTIONS:-}" ]; then
  for v in "${TF_VAR_allowed_emails:-}" "${TF_VAR_alert_email:-}"; do
    for e in $(printf '%s' "$v" | grep -oE '[^"[:space:],]+@[^"[:space:],]+' || true); do echo "::add-mask::$e"; done
  done
fi

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
[ "$ACCOUNT" = "$AWS_ACCOUNT_ID" ] || { echo "Refusing: AWS account $ACCOUNT is not the configured one" >&2; exit 1; }

npm ci
npm test
npm run typecheck
npm run bundle -w @hub/backend
VITE_DATA_SOURCE=api npm run build -w @hub/web

# The token is written, never read back. With one in place the schedule turns on.
if [ -n "${RISEUP_PAT:-}" ]; then
  case "$RISEUP_PAT" in riseup_pat_*) ;; *) echo "RISEUP_PAT does not look like a RiseUp token" >&2; exit 1 ;; esac
  aws ssm put-parameter --name "/$PROJECT_NAME/riseup-pat" --type SecureString --overwrite --value "$RISEUP_PAT" >/dev/null
  export TF_VAR_sync_enabled=true TF_VAR_pat_expires_at="${PAT_EXPIRES_AT:-}"
  echo "RiseUp token stored"
fi

CF="terraform -chdir=infra/cloudflare"
AW="terraform -chdir=infra/aws"
$CF init -backend-config="bucket=$TF_STATE_BUCKET" >/dev/null
$AW init -backend-config="bucket=$TF_STATE_BUCKET" >/dev/null

# The two stacks need one value from each other: the API needs the Access
# audience, the Pages project needs the API's URL. On the very first run the
# URL does not exist yet, so Cloudflare is applied twice; afterwards once.
ORIGIN="$($AW output -raw api_url 2>/dev/null || true)"
case "$ORIGIN" in https://*) ;; *) ORIGIN="" ;; esac
TF_VAR_api_origin="$ORIGIN" $CF apply -auto-approve
TF_VAR_access_aud="$($CF output -raw access_aud)" $AW apply -auto-approve
NEW_ORIGIN="$($AW output -raw api_url)"
if [ "$NEW_ORIGIN" != "$ORIGIN" ]; then
  TF_VAR_api_origin="$NEW_ORIGIN" $CF apply -auto-approve
fi

CLOUDFLARE_ACCOUNT_ID="$($CF output -raw cloudflare_account_id)" \
  npx --yes wrangler@4 pages deploy dist --cwd apps/web --project-name "$PROJECT_NAME" --branch main --commit-dirty=true
echo "Deployed"
