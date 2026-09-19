#!/usr/bin/env bash
# Source this. Everything that identifies one deployment lives outside the repo:
# in `.env` on a laptop, in the `production` environment's secrets in CI.
_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
if [ -z "${CI:-}" ] && [ -f "$_ROOT/.env" ]; then set -a; source "$_ROOT/.env"; set +a; fi
: "${PROJECT_NAME:?PROJECT_NAME is required (prefix of every resource name)}"
: "${AWS_ACCOUNT_ID:?AWS_ACCOUNT_ID is required}"
export AWS_REGION="${AWS_REGION:-il-central-1}"
export AWS_DEFAULT_REGION="$AWS_REGION"
export TF_STATE_BUCKET="${TF_STATE_BUCKET:-$PROJECT_NAME-tfstate-$AWS_ACCOUNT_ID}"
export TF_VAR_project_name="$PROJECT_NAME" TF_VAR_aws_account_id="$AWS_ACCOUNT_ID"
[ -z "${HUB_DOMAIN:-}" ] || export TF_VAR_domain="$HUB_DOMAIN"
[ -z "${ACCESS_TEAM_DOMAIN:-}" ] || export TF_VAR_access_team_domain="$ACCESS_TEAM_DOMAIN"
